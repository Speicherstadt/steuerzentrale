import { describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema.ts";
import { testDatenbank, testSchluessel } from "../../db/test-db.ts";
import { schreiben } from "../audit/index.ts";
import { agentCa } from "../server/ca.ts";
import { pforteKonfiguration, vorneArgumente } from "./index.ts";

/*
 * BAULISTE.md Z-1004: `steuerzentrale pforte <netz>…` reads the Pforte's configuration on stdin and
 * prints it with the Zentrale's routes (docs/installation.md); the CAs of all operators go in,
 * made where one is missing, so an agent that joins later connects without another run.
 */

const bund = { aktuell: testSchluessel(), alt: [] };
const mitBetreibern = (...ids: string[]) => {
  const d = testDatenbank(bund);
  for (const betreiberId of ids)
    schreiben(d.schreibDb, { betreiberId, akteur: "test", jetzt: 1, grund: "Test" }, "test", (w) =>
      w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: 1 }),
    );
  return d;
};
const env = {
  url: "https://zentrale.example.de",
  agentUrl: "https://agent.example.de",
  port: 8300,
};
type Server = { routes: { "@id": string }[]; tls_connection_policies: unknown[] };
const server = (k: unknown) =>
  (k as { apps: { http: { servers: { pforte: Server } } } }).apps.http.servers.pforte;

describe("the Pforte's configuration with the Zentrale", () => {
  it("trusts the CA of every operator, made where it was missing, in each one's audit log", async () => {
    const d = mitBetreibern("b1", "b2");
    const vorhanden = await agentCa(d.db, d.schreibDb, bund, {
      betreiberId: "b1",
      akteur: "test",
      jetzt: 1,
    });
    const r = await pforteKonfiguration({ ...d, schluessel: bund, env, jetzt: 5 }, null, {
      uiNetze: ["10.8.0.0/24"],
      zertifikate: "acme",
    });
    if (!r.ok) throw new Error(r.grund);
    const politik = server(r.konfiguration).tls_connection_policies[0] as {
      client_authentication: { ca: { trusted_ca_certs: string[] } };
    };
    const cas = politik.client_authentication.ca.trusted_ca_certs;
    expect(cas).toHaveLength(2);
    expect(cas[0]).toBe(Buffer.from(vorhanden.zertifikat.rawData).toString("base64"));
    const angelegt = d.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "agent-ca.anlegen");
    expect(angelegt.map((e) => [e.betreiberId, e.akteur])).toEqual([
      ["b1", "test"],
      ["b2", "befehl"],
    ]);
  });

  it("takes the hosts from STEUERZENTRALE_URL and STEUERZENTRALE_AGENT_URL", async () => {
    const d = mitBetreibern("b1");
    const r = await pforteKonfiguration({ ...d, schluessel: bund, env, jetzt: 5 }, null, {
      uiNetze: ["10.8.0.0/24"],
      zertifikate: "acme",
    });
    expect(JSON.stringify(r)).toContain('"host":["zentrale.example.de"]');
    expect(JSON.stringify(r)).toContain('"host":["agent.example.de"]');
    expect(JSON.stringify(r)).toContain('"dial":"127.0.0.1:8300"');
  });

  it("refuses a Zentrale whose interface and agents share a host", async () => {
    const d = mitBetreibern("b1");
    const r = await pforteKonfiguration(
      { ...d, schluessel: bund, env: { ...env, agentUrl: env.url }, jetzt: 5 },
      null,
      { uiNetze: ["10.8.0.0/24"], zertifikate: "acme" },
    );
    expect(r.ok).toBe(false);
  });
});

describe("the arguments of steuerzentrale pforte", () => {
  it("takes networks and --intern, nothing else", () => {
    expect(vorneArgumente(["10.8.0.0/24", "fd00::/64"])).toEqual({
      ok: true,
      uiNetze: ["10.8.0.0/24", "fd00::/64"],
      zertifikate: "acme",
    });
    expect(vorneArgumente(["--intern", "127.0.0.1/32"])).toMatchObject({
      ok: true,
      zertifikate: "intern",
    });
    expect(vorneArgumente([]).ok).toBe(false);
    expect(vorneArgumente(["--irgendwas", "10.8.0.0/24"]).ok).toBe(false);
  });
});
