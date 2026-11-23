import { describe, expect, it } from "vitest";
import { auftragEinfuegen, ereignisEinfuegen, serverEinfuegen } from "../testhilfen/betrieb.ts";
import { installationEinfuegen, kundeUndServer } from "../testhilfen/bewertung.ts";
import { testServer } from "../testhilfen/server.ts";

/*
 * No operator reads another's overview, jobs, events or audit log (CLAUDE.md, "Project specifics": a
 * test per endpoint; BAULISTE.md Z-406). The partner's rows carry the same ids as the owner's, so a
 * filter by id alone would let them through.
 */
const zwei = async () => {
  const server = testServer();
  const teufel = await server.inhaber();
  const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  for (const [b, name] of [
    [partner.betreiberId, "fremd"],
    [teufel.betreiberId, "eigen"],
  ] as const) {
    serverEinfuegen(server.schreibDb, b, "s1", { name: `${name}-server`, beigetretenAm: 1 });
    auftragEinfuegen(server.schreibDb, b, "s1", { angelegtAm: 5, zustand: "gescheitert" });
    ereignisEinfuegen(server.schreibDb, b, {
      zeitpunkt: server.jetzt(),
      schwere: "warn",
      ziel: "server:s1",
      text: `${name}-ereignis`,
    });
  }
  // a red installation of the partner only
  kundeUndServer(server.schreibDb, partner.betreiberId, []);
  installationEinfuegen(server.schreibDb, partner.betreiberId, "i1", "s1");
  return { server, teufel, partner };
};

const text = async (person: { json: (p: string) => Promise<{ daten: unknown }> }, pfad: string) =>
  JSON.stringify((await person.json(pfad)).daten);

describe("no operator reaches another's operations", () => {
  it("GET /api/v1/uebersicht names one's own servers, jobs and events only", async () => {
    const { teufel } = await zwei();
    const eigen = await text(teufel, "/api/v1/uebersicht");
    expect(eigen).toContain("eigen-server");
    expect(eigen).not.toMatch(/fremd|i1\.kanzlei/);
  });

  it("GET /api/v1/auftraege lists one's own jobs only, also filtered by the other's server id", async () => {
    const { teufel, partner } = await zwei();
    for (const pfad of ["/api/v1/auftraege", "/api/v1/auftraege?serverId=s1"]) {
      const { daten } = await teufel.json(pfad);
      const eintraege = (daten as { eintraege: { server: { name: string } }[] }).eintraege;
      expect(eintraege.map((a) => a.server.name)).toEqual(["eigen-server"]);
    }
    expect(await text(partner, "/api/v1/auftraege")).not.toContain("eigen-server");
  });

  it("GET /api/v1/ereignisse lists one's own events only, also filtered by target", async () => {
    const { teufel, partner } = await zwei();
    for (const pfad of ["/api/v1/ereignisse", "/api/v1/ereignisse?ziel=server:s1"]) {
      const { daten } = await partner.json(pfad);
      const eintraege = (daten as { eintraege: { text: string }[] }).eintraege;
      expect(eintraege.map((e) => e.text)).toEqual(["fremd-ereignis"]);
    }
    expect(await text(teufel, "/api/v1/ereignisse")).not.toContain("fremd");
    // the target's name comes from one's own server of that id, not the other's
    const { daten } = await teufel.json("/api/v1/ereignisse");
    expect((daten as { eintraege: { verweis: unknown }[] }).eintraege[0]?.verweis).toEqual({
      art: "server",
      id: "s1",
      name: "eigen-server",
    });
  });

  it("GET /api/v1/audit lists one's own entries only", async () => {
    const { teufel, partner } = await zwei();
    const { daten } = await teufel.json("/api/v1/audit?anzahl=200");
    const eintraege = (daten as { eintraege: { inhalt: unknown }[] }).eintraege;
    expect(eintraege.length).toBeGreaterThan(0);
    const alles = JSON.stringify(eintraege);
    expect(alles).not.toMatch(/fremd|Partner GmbH|pia@partner/);
    expect(alles).not.toContain(partner.betreiberId);
  });
});
