import { tagesbeginn } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import { auditLog, server as serverTabelle, tokens } from "../db/schema.ts";
import { BEITRITT_GUELTIG_MS } from "../modules/server/index.ts";
import { NEUER_SERVER, serverHinzufuegen } from "../testhilfen/agent.ts";
import { TEST_AGENT_URL, testServer } from "../testhilfen/server.ts";

/** A customer of the person's operator, through the API of Z-801; its id */
const kundeAnlegen = async (person: { json: (pfad: string, init?: never) => Promise<unknown> }) => {
  const { status, daten } = (await person.json("/api/v1/kunden", {
    body: {
      name: "Kanzlei Berger",
      kontakt: { name: "Bea Berger", email: "bea@berger.test" },
      vertrag: { sla: "basis", beginn: tagesbeginn(1_800_000_000_000) },
      grund: "Vertrag",
    },
  } as never)) as { status: number; daten: { id: string } };
  if (status !== 201) throw new Error(`kunde ${status}`);
  return daten.id;
};

// BAULISTE.md Z-302: adding a server makes a one-time token, valid 24 hours, kept only as a hash
describe("adding a server", () => {
  it("answers the install command with a one-time token once, keeping only its hash", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId, befehl, token, gueltigBis } = await serverHinzufuegen(inhaber);
    expect(befehl).toBe(`curl -fsSL ${TEST_AGENT_URL}/install.sh | sudo sh -s -- --token ${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gueltigBis).toBe(server.jetzt() + BEITRITT_GUELTIG_MS);
    expect(server.db.select().from(serverTabelle).all()).toEqual([
      expect.objectContaining({
        betreiberId: inhaber.betreiberId,
        serverId,
        name: NEUER_SERVER.name,
        art: "gemeinsam",
        kundeId: null,
        fingerabdruck: null,
        wartungsfenster: JSON.stringify(NEUER_SERVER.wartungsfenster),
        angelegtVon: inhaber.nutzerId,
      }),
    ]);
    const gespeichert = JSON.stringify([
      server.db.select().from(tokens).all(),
      server.db.select().from(serverTabelle).all(),
      server.db.select().from(auditLog).all(),
    ]);
    expect(gespeichert).not.toContain(token);
  });

  it("writes the audit log with the reason", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "server.anlegen");
    expect(eintraege.map((e) => e.ziel)).toEqual([`server:${serverId}`, `tokens:${serverId}`]);
    expect(
      eintraege.every((e) => e.grund === "neuer Server" && e.akteur === inhaber.nutzerId),
    ).toBe(true);
  });

  it("takes the customer of a server of its own or at the customer", async () => {
    const server = testServer();
    const technik = await server.eingeladen(await server.inhaber(), "technik");
    const kundeId = await kundeAnlegen(technik);
    await serverHinzufuegen(technik, { ...NEUER_SERVER, art: "beim_kunden", kundeId } as never);
    expect(server.db.select().from(serverTabelle).all()).toEqual([
      expect.objectContaining({ art: "beim_kunden", kundeId }),
    ]);
  });

  it("refuses a customer that does not exist or is another operator's", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
    const fremderKunde = await kundeAnlegen(partner);
    for (const kundeId of ["gibt-es-nicht", fremderKunde]) {
      const { status, daten } = await inhaber.json("/api/v1/server", {
        body: { ...NEUER_SERVER, art: "eigen", kundeId },
      });
      expect({ status, daten }, kundeId).toEqual({ status: 404, daten: { fehler: "kein_kunde" } });
    }
    expect(server.db.select().from(serverTabelle).all()).toEqual([]);
  });

  it.each([
    ["a shared server with a customer", { kundeId: "kanzlei-berger" }],
    ["a server of its own without one", { art: "eigen" }],
    ["no name", { name: " " }],
    ["no reason", { grund: "" }],
    ["an unknown kind", { art: "fremd" }],
    ["a time that is none", { wartungsfenster: { tage: [1], von: "24:00", bis: "01:00" } }],
    ["no weekday", { wartungsfenster: { tage: [], von: "03:30", bis: "04:30" } }],
    ["a weekday twice", { wartungsfenster: { tage: [1, 1], von: "03:30", bis: "04:30" } }],
    ["an unknown field", { port: 22 }],
  ])("refuses %s", async (_fall, aenderung) => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { status, daten } = await inhaber.json("/api/v1/server", {
      body: { ...NEUER_SERVER, ...aenderung },
    });
    expect({ status, daten }).toEqual({ status: 400, daten: { fehler: "ungueltig" } });
    expect(server.db.select().from(serverTabelle).all()).toEqual([]);
  });
});
