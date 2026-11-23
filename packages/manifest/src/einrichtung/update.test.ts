import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_ZEITLIMIT_S } from "../backup/auftraege.ts";
import { WIEDERHERSTELLEN_ZEITLIMIT_S } from "../backup/wiederherstellen.ts";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import { EINRICHTUNG_ZEITLIMIT_S, type Einrichtung } from "./auftraege.ts";
import {
  UPDATE_AKTION,
  UPDATE_HEALTH_S,
  UPDATE_ZEITLIMIT_S,
  type UpdateAnfrage,
  updateArgumente,
  updateAuftragPruefen,
  updateDatenLesen,
} from "./update.ts";

/*
 * BAULISTE.md Z-503 (docs/plan.md, "Update in der Zentrale (Z-503)", "Update auf dem Server
 * (Z-503)"): the update carries the signed manifest of the new version and the installation's data
 * (`einrichtung`), rendered against the new manifest like reconfiguring, and the snapshots of the
 * backup made just before as `snapshot:<tag>`, which a rollback plays back.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);
const BACKUP = "backup:\n  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }\n";
const mitBackup = (zeilen: string) => {
  if (!VORLAGE.includes(BACKUP)) throw new Error("the template's backup changed");
  return beispielManifest(VORLAGE.replace(BACKUP, zeilen));
};

const A = "a".repeat(64);
const B = "b".repeat(64);

const EINRICHTUNG: Einrichtung = {
  installation: {
    kundeId: "k-1",
    optionen: [],
    httpPort: 20001,
    ports: { "app:9000": 20002 },
    host: "beispiel.kunde.example",
    ipv4: null,
  },
  einstellungen: { betreiber: {}, installation: {}, auto: { BEISPIEL_SCHLUESSEL: "dGVzdA==" } },
};

const anfrage = (teil: Partial<UpdateAnfrage> = {}): UpdateAnfrage => ({
  aktion: UPDATE_AKTION,
  installationId: "beispiel-x7k2p9",
  argumente: { "snapshot:volume:daten": A },
  einrichtung: EINRICHTUNG,
  ...teil,
});

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("the update job", () => {
  it("renders the new manifest's units and keeps the snapshots to roll back to", () => {
    const r = updateAuftragPruefen(beispiel, anfrage());
    if (!r.ok) throw new Error(r.grund);
    const a = r.auftrag;
    expect(a.art).toBe("update");
    expect(a.name).toBe("beispiel-x7k2p9");
    expect(a.units.length).toBeGreaterThan(0);
    expect(a.units.every((u) => u.startsWith("beispiel-x7k2p9-") && u.endsWith(".service"))).toBe(
      true,
    );
    expect(Object.keys(a.quadlets.units).length).toBeGreaterThan(0);
    expect(a.schritte).toEqual(beispiel.schritte.nach_update);
    expect(a.netz).toEqual({
      name: "beispiel-x7k2p9",
      unit: "beispiel-x7k2p9-network.service",
    });
    expect(a.teile.map((t) => t.tag)).toEqual(["volume:daten", "befehl:export"]);
    expect(a.snapshots).toEqual({ "volume:daten": A });
  });

  it("allows pull, restart, steps, health and a rollback with playback", () => {
    expect(UPDATE_HEALTH_S).toBe(300);
    expect(UPDATE_ZEITLIMIT_S).toBe(
      EINRICHTUNG_ZEITLIMIT_S + UPDATE_HEALTH_S + WIEDERHERSTELLEN_ZEITLIMIT_S,
    );
    expect(UPDATE_ZEITLIMIT_S).toBeGreaterThan(BACKUP_ZEITLIMIT_S);
  });

  it.each([
    ["another action", { aktion: "installation_konfigurieren" }, "not an update"],
    ["no installation", { installationId: null }, "named installation"],
    ["a name of another shape", { installationId: "../x" }, "named installation"],
    ["a backup access", { backup: { passwort: "x" } }, "no backup data"],
    ["no installation data", { einrichtung: undefined }, "installation data (einrichtung)"],
    [
      "a port the manifest does not assign",
      {
        einrichtung: {
          ...EINRICHTUNG,
          installation: { ...EINRICHTUNG.installation, httpPort: 22 },
        },
      },
      "httpPort",
    ],
    ["no snapshot", { argumente: {} }, "no snapshot for snapshot:volume:daten"],
    [
      "an unknown argument",
      { argumente: { "snapshot:volume:daten": A, argv: "sh" } },
      "unknown argument argv",
    ],
    [
      "a snapshot for a command's export",
      { argumente: { "snapshot:volume:daten": A, "snapshot:befehl:export": B } },
      "a command's export is not played back",
    ],
    ["a short ID", { argumente: { "snapshot:volume:daten": "a".repeat(8) } }, "64 hex"],
    ["a number", { argumente: { "snapshot:volume:daten": 12 } }, "64 hex"],
  ] as const)("refuses %s", (_, teil, text) => {
    expect(grund(updateAuftragPruefen(beispiel, anfrage(teil)))).toContain(text);
  });

  it("refuses settings the new version does not accept", () => {
    const ohneAuto = { ...EINRICHTUNG, einstellungen: { ...EINRICHTUNG.einstellungen, auto: {} } };
    expect(grund(updateAuftragPruefen(beispiel, anfrage({ einrichtung: ohneAuto })))).not.toBe(
      "ok",
    );
  });

  it("refuses a manifest without a backup to roll back to", () => {
    for (const m of [mitBackup(""), mitBackup("backup:\n  - { art: befehl, befehl: export }\n")])
      expect(grund(updateAuftragPruefen(m, anfrage({ argumente: {} })))).toBe(
        "an update needs a backup to roll back to",
      );
  });
});

describe("the arguments of an update", () => {
  it("name the snapshots of the backup made just before, like a restore's", () => {
    const lauf = [
      { tag: "volume:daten", snapshot: A },
      { tag: "befehl:export", snapshot: B },
    ];
    const r = updateArgumente(beispiel, "beispiel-x7k2p9", lauf);
    expect(r).toEqual({ ok: true, argumente: { "snapshot:volume:daten": A } });
    if (!r.ok) return;
    expect(grund(updateAuftragPruefen(beispiel, anfrage({ argumente: r.argumente })))).toBe("ok");
    expect(grund(updateArgumente(beispiel, "beispiel-x7k2p9", []))).toBe(
      "the run has no snapshot of volume:daten",
    );
  });
});

describe("the agent's data of an update", () => {
  it("read each result with its duration", () => {
    expect(updateDatenLesen({ ergebnis: "aktualisiert", dauerMs: 9_000, fremd: 1 })).toEqual({
      ergebnis: "aktualisiert",
      dauerMs: 9_000,
    });
    expect(updateDatenLesen({ ergebnis: "zurueckgenommen", grund: "health red" })).toEqual({
      ergebnis: "zurueckgenommen",
      grund: "health red",
      dauerMs: null,
    });
    expect(
      updateDatenLesen({ ergebnis: "ruecknahme_unvollstaendig", grund: "x", dauerMs: -1 }),
    ).toEqual({ ergebnis: "ruecknahme_unvollstaendig", grund: "x", dauerMs: null });
  });

  it("cap the reason and name a missing one", () => {
    const lang = updateDatenLesen({ ergebnis: "zurueckgenommen", grund: "x".repeat(2000) });
    expect(lang).toMatchObject({ grund: "x".repeat(500) });
    expect(updateDatenLesen({ ergebnis: "zurueckgenommen" })).toMatchObject({
      grund: "no reason reported",
    });
  });

  it("are nothing for another result or shape", () => {
    for (const d of [null, "aktualisiert", {}, { ergebnis: "gelungen" }, [1]])
      expect(updateDatenLesen(d)).toBeNull();
  });
});
