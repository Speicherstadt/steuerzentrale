import { readFileSync } from "node:fs";
import { EINRICHTUNG_AKTIONEN, PFORTE_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  appEinstellungen,
  auditLog,
  auftraege,
  installationen,
  installationsPorts,
} from "../../db/schema.ts";
import {
  installationsUmgebung,
  KENNWORT,
  LIZENZ,
  neueInstallation,
  signiert,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { offeneZustellen } from "../auftraege/zustellen.ts";
import { installationAnlegen } from "./anlegen.ts";

/*
 * BAULISTE.md Z-402, the Zentrale's side: an installation is made from a signed manifest that fits
 * its server, with its name, ports and generated values, and the setup job with the route of the
 * Pforte waiting for it, in one transaction with the audit log; no secret in plain text anywhere
 * but in the job the agent gets.
 */

type U = ReturnType<typeof installationsUmgebung>;

const anlegen = (u: U, teil: Parameters<typeof neueInstallation>[0] = {}, betreiberId = "b1") =>
  installationAnlegen(u.deps, u.kontext(betreiberId), TEST_SCHLUESSEL, neueInstallation(teil));

const angelegt = (u: U, teil: Parameters<typeof neueInstallation>[0] = {}) => {
  const a = anlegen(u, teil);
  if (!a.ok) throw new Error(`${a.grund} ${a.detail ?? ""} ${JSON.stringify(a.gruende ?? [])}`);
  return a.installation;
};

const jobs = (u: U) => u.db.select().from(auftraege).all();

const ergebnis = (auftragId: string, ok: boolean): AuftragsMeldung => ({
  typ: "ergebnis",
  protokoll: 1,
  auftragId,
  zeit: 1,
  ergebnis: ok ? { ok: true, daten: {} } : { ok: false, fehler: "migrieren: exit 1" },
});

/** The agent acknowledges and reports a result for a job of server s1 */
const melden = (u: U, auftragId: string, ok: boolean, betreiberId = "b1") => {
  const server = { betreiberId, serverId: "s1" } as Parameters<typeof auftragMelden>[1];
  auftragMelden(u.deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
  return auftragMelden(u.deps, server, ergebnis(auftragId, ok), u.uhr.ms);
};

const einrichtenJob = (u: U, installationId: string) =>
  jobs(u).find(
    (a) => a.installationId === installationId && a.aktion === EINRICHTUNG_AKTIONEN.einrichten,
  );

/** The database file and its write-ahead log, as bytes an attacker with the disk would read */
const dateiInhalt = (pfad: string): string =>
  [pfad, `${pfad}-wal`]
    .map((datei) => {
      try {
        return readFileSync(datei).toString("latin1");
      } catch {
        return "";
      }
    })
    .join("");

describe("a new installation", () => {
  it("gets its name, ports and a setup job with the Pforte's route waiting for it", () => {
    const u = installationsUmgebung();
    const agent = u.bereit();
    const i = angelegt(u);
    expect(i).toMatchObject({
      installationId: expect.stringMatching(/^probe-[a-z0-9]{6}$/),
      kundeId: "k1",
      serverId: "s1",
      app: "probe",
      version: "1.0.0",
      host: "probe.kunde.example",
      ipv4: "203.0.113.10",
      httpPort: 20_000,
      ports: JSON.stringify({ "app:9000": 20_001 }),
      zustand: "wird_eingerichtet",
    });
    expect(JSON.parse(i.einstellungen)).toEqual({
      betreiber: {},
      installation: { PROBE_TITEL: "Kanzlei" },
    });
    const [einrichten, route] = jobs(u);
    expect(einrichten).toMatchObject({
      aktion: EINRICHTUNG_AKTIONEN.einrichten,
      installationId: i.installationId,
      zeitlimitS: 1800,
      zustand: "zugestellt",
      argumente: "{}",
    });
    expect(route).toMatchObject({
      aktion: PFORTE_AKTIONEN.setzen,
      installationId: i.installationId,
      zustand: "wartend",
      wartetAuf: JSON.stringify([einrichten?.auftragId]),
      argumente: JSON.stringify({ host: "probe.kunde.example", port: 20_000 }),
    });
    expect(agent.map((n) => n.aktion)).toEqual([EINRICHTUNG_AKTIONEN.einrichten]);
  });

  it("stands in the audit log in one change, without manifest, signature or secrets", () => {
    const u = installationsUmgebung();
    u.bereit();
    const vorher = u.db.select().from(auditLog).all().length;
    const i = angelegt(u);
    const neu = u.db.select().from(auditLog).all().slice(vorher);
    const anlage = neu.filter((e) => e.aktion === "installation.anlegen");
    expect(anlage.map((e) => e.ziel.split(":")[0])).toEqual([
      "installationen",
      "installationsPorts",
      "installationsPorts",
      "auftraege",
      "auftraege",
    ]);
    expect(new Set(anlage.map((e) => e.grund))).toEqual(new Set(["Test"]));
    expect(JSON.parse(anlage[0]?.inhalt ?? "{}").zeile).toMatchObject({
      installationId: i.installationId,
      geheim: "[verschlüsselt]",
      manifest: "[ausgelassen]",
      signatur: "[ausgelassen]",
    });
  });

  it("sends its setup job with the installation's data and the generated values only to the agent", () => {
    const u = installationsUmgebung();
    const agent = u.bereit();
    const i = angelegt(u);
    const nachricht = agent[0] as { einrichtung: Record<string, Record<string, unknown>> };
    expect(nachricht.einrichtung).toEqual({
      installation: {
        kundeId: "k1",
        optionen: [],
        httpPort: 20_000,
        ports: { "app:9000": 20_001 },
        host: "probe.kunde.example",
        ipv4: "203.0.113.10",
      },
      einstellungen: {
        betreiber: { PROBE_LIZENZ: LIZENZ },
        installation: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
        auto: {
          PROBE_SCHLUESSEL: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
          PROBE_PASSWORT: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
    });
    // again on the next connection, the same values: generated once, kept encrypted
    offeneZustellen(u.deps, "b1", "s1");
    expect(agent[1]).toEqual(agent[0]);
    expect(einrichtenJob(u, i.installationId)).not.toHaveProperty("einrichtung");
  });

  it("keeps no secret in plain text in the database file, the audit log included", () => {
    const u = installationsUmgebung();
    const agent = u.bereit();
    angelegt(u);
    const { auto } = (
      agent[0] as { einrichtung: { einstellungen: { auto: Record<string, string> } } }
    ).einrichtung.einstellungen;
    const geheimnisse = [LIZENZ, KENNWORT, ...Object.values(auto)];
    u.sqlite.run("PRAGMA wal_checkpoint(FULL)");
    const datei = dateiInhalt(u.pfad);
    const tabellen = JSON.stringify([
      u.db.select().from(installationen).all(),
      u.db.select().from(auftraege).all(),
      u.db.select().from(auditLog).all(),
      u.db.select().from(appEinstellungen).all(),
    ]);
    for (const g of geheimnisse) {
      expect(datei).not.toContain(g);
      expect(datei).not.toContain(Buffer.from(g).toString("base64"));
      expect(tabellen).not.toContain(g);
    }
    expect(u.log.join("\n")).not.toContain(KENNWORT);
  });

  it("never shares a name or a port with another installation on its server", () => {
    const u = installationsUmgebung();
    u.bereit();
    const liste = [1, 2, 3, 4].map((n) => angelegt(u, { host: `probe${n}.kunde.example` }));
    expect(new Set(liste.map((i) => i.installationId)).size).toBe(4);
    const ports = u.db.select().from(installationsPorts).all();
    expect(ports.map((p) => p.port).sort()).toEqual([
      20_000, 20_001, 20_002, 20_003, 20_004, 20_005, 20_006, 20_007,
    ]);
    // the primary key refuses a port taken twice, whoever writes it
    expect(() =>
      schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
        w.einfuegen("installationsPorts", {
          betreiberId: "b1",
          serverId: "s1",
          port: 20_000,
          installationId: liste[1]?.installationId ?? "",
          zweck: "http",
        }),
      ),
    ).toThrow();
  });

  it("leaves out the ports the server already uses", () => {
    const u = installationsUmgebung();
    u.bereit();
    u.fakten("b1", "s1", {
      portsBelegt: [
        { port: 20_000, proto: "tcp" },
        { port: 20_001, proto: "udp" },
      ],
    });
    expect(angelegt(u)).toMatchObject({ httpPort: 20_002 });
  });

  it("gets a new name when the first one drawn is taken", () => {
    const u = installationsUmgebung();
    u.bereit();
    const erste = angelegt(u);
    const teil = erste.installationId.slice("probe-".length);
    const bytes = [...teil].map((z) => "abcdefghijklmnopqrstuvwxyz0123456789".indexOf(z));
    let zug = 0;
    u.deps.zufall = (n) => {
      zug++;
      // the first draw repeats the taken name, every later one is random
      return zug === 1
        ? new Uint8Array([...bytes, ...bytes]).slice(0, n)
        : crypto.getRandomValues(new Uint8Array(n));
    };
    const zweite = angelegt(u, { host: "zwei.kunde.example" });
    expect(zweite.installationId).not.toBe(erste.installationId);
  });

  it("has no route in the Pforte when the app brings its own proxy", () => {
    const u = installationsUmgebung();
    u.bereit();
    const i = angelegt(u, { ...signiert("stumm"), einstellungen: {} });
    expect(jobs(u).map((a) => [a.installationId, a.aktion])).toEqual([
      [i.installationId, EINRICHTUNG_AKTIONEN.einrichten],
    ]);
  });
});

describe("a new installation is refused, and nothing is written", () => {
  const nichtsGeschrieben = (u: U) => {
    expect(u.db.select().from(installationen).all()).toEqual([]);
    expect(u.db.select().from(installationsPorts).all()).toEqual([]);
    expect(jobs(u)).toEqual([]);
  };

  it.each([
    ["a manifest changed by one byte", { manifest: `${signiert("probe").manifest} ` }],
    ["the signature of another manifest", { signatur: signiert("stumm").signatur }],
    ["no signature", { signatur: "kein minisign" }],
  ])("with %s", (_fall, teil) => {
    const u = installationsUmgebung();
    u.bereit();
    expect(anlegen(u, teil)).toMatchObject({ ok: false, grund: "signatur_ungueltig" });
    nichtsGeschrieben(u);
  });

  it("on a server it does not fit, with every reason", () => {
    const u = installationsUmgebung();
    u.bereit();
    u.fakten("b1", "s1", { ramMb: 128 });
    expect(anlegen(u)).toMatchObject({
      ok: false,
      grund: "passt_nicht",
      gruende: [{ code: "ram", werte: { bedarf: 256, verfuegbar: 128 } }],
    });
    nichtsGeschrieben(u);
  });

  it("on a server without facts or agent", () => {
    const u = installationsUmgebung();
    u.betreiber("b1", "s1");
    u.kunde("b1", "k1");
    u.betreiberWert("b1", "probe", "PROBE_LIZENZ", LIZENZ, true);
    expect(anlegen(u)).toMatchObject({
      grund: "passt_nicht",
      gruende: [{ code: "fakten_fehlen" }],
    });
    u.fakten("b1", "s1");
    expect(anlegen(u)).toMatchObject({
      grund: "passt_nicht",
      gruende: [{ code: "agent_getrennt" }],
    });
    nichtsGeschrieben(u);
  });

  it("without the operator's required value, naming it", () => {
    const u = installationsUmgebung();
    u.betreiber("b1", "s1");
    u.kunde("b1", "k1");
    u.fakten("b1", "s1");
    u.verbinden("b1", "s1");
    expect(anlegen(u)).toMatchObject({
      ok: false,
      grund: "passt_nicht",
      gruende: [{ code: "betreiberwert_fehlt", werte: { name: "PROBE_LIZENZ" } }],
    });
    nichtsGeschrieben(u);
  });

  it.each([
    ["an unknown setting", { einstellungen: { UNBEKANNT: "x" } }, "einstellung_ungueltig"],
    [
      "a setting of the operator",
      { einstellungen: { PROBE_LIZENZ: "x" } },
      "einstellung_ungueltig",
    ],
    ["a generated setting", { einstellungen: { PROBE_SCHLUESSEL: "x" } }, "einstellung_ungueltig"],
    ["a value of the wrong type", { einstellungen: { PROBE_TITEL: 3 } }, "einstellung_ungueltig"],
    ["an unknown option", { optionen: ["gibt-es-nicht"] }, "passt_nicht"],
    ["a customer of nobody", { kundeId: "k9" }, "kein_kunde"],
    ["a server of nobody", { serverId: "s9" }, "kein_server"],
  ])("with %s", (_fall, teil, grund) => {
    const u = installationsUmgebung();
    u.bereit();
    expect(anlegen(u, teil)).toMatchObject({ ok: false, grund });
    nichtsGeschrieben(u);
  });

  it("with a host another installation of the operator answers on, until that one is removed", () => {
    const u = installationsUmgebung();
    u.bereit();
    const erste = angelegt(u);
    expect(anlegen(u)).toMatchObject({ ok: false, grund: "host_vergeben" });
    schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
      w.aendern(
        "installationen",
        { installationId: erste.installationId },
        { zustand: "entfernt" },
      ),
    );
    expect(anlegen(u)).toMatchObject({ ok: true });
  });

  it("for another operator's customer or server", () => {
    const u = installationsUmgebung();
    u.bereit("b1");
    u.betreiber("b2");
    expect(anlegen(u, {}, "b2")).toMatchObject({ ok: false, grund: "kein_kunde" });
    u.kunde("b2", "k1");
    expect(anlegen(u, {}, "b2")).toMatchObject({ ok: false, grund: "kein_server" });
    nichtsGeschrieben(u);
  });
});

describe("the end of the setup job", () => {
  it("runs the installation and sends the route on success", () => {
    const u = installationsUmgebung();
    const agent = u.bereit();
    const i = angelegt(u);
    expect(melden(u, einrichtenJob(u, i.installationId)?.auftragId ?? "", true)).toEqual({
      ok: true,
      geaendert: true,
    });
    expect(u.db.select().from(installationen).get()?.zustand).toBe("laeuft");
    expect(agent.map((n) => n.aktion)).toEqual([
      EINRICHTUNG_AKTIONEN.einrichten,
      PFORTE_AKTIONEN.setzen,
    ]);
    const eintrag = u.db
      .select()
      .from(auditLog)
      .all()
      .find(
        (e) => e.ziel === `installationen:${i.installationId}` && e.aktion === "auftrag.ergebnis",
      );
    expect(JSON.parse(eintrag?.inhalt ?? "{}")).toEqual({
      art: "aendern",
      werte: { zustand: "laeuft", geaendertAm: u.uhr.ms },
    });
  });

  it("fails the installation and cancels the route when the setup failed", () => {
    const u = installationsUmgebung();
    const agent = u.bereit();
    const i = angelegt(u);
    melden(u, einrichtenJob(u, i.installationId)?.auftragId ?? "", false);
    expect(u.db.select().from(installationen).get()?.zustand).toBe("gescheitert");
    expect(jobs(u).find((a) => a.aktion === PFORTE_AKTIONEN.setzen)?.zustand).toBe("abgebrochen");
    expect(agent.map((n) => n.aktion)).toEqual([EINRICHTUNG_AKTIONEN.einrichten]);
  });
});
