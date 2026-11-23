import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import {
  ABWICKLUNG_AKTIONEN,
  abwicklungAuftragPruefen,
  archivDatei,
  istAbwicklungAktion,
} from "./abwicklung.ts";
import type { BackupAnfrage } from "./auftraege.ts";

/*
 * BAULISTE.md Z-604 (docs/plan.md, "Kündigung und Löschung"): the archive and the deletion are
 * built-in jobs with a fixed shape, checked by Zentrale and agent with one function; neither
 * carries an argv, installation data or a secret, only the archive its S3 region.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);
const NAME = "beispiel-x7k2p9";

const anfrage = (teil: Partial<BackupAnfrage>): BackupAnfrage => ({
  aktion: ABWICKLUNG_AKTIONEN.archiv,
  installationId: NAME,
  argumente: { region: "eu-central-1" },
  ...teil,
});

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("the jobs after a contract ended", () => {
  it("knows its two actions, which no manifest can name", () => {
    expect(istAbwicklungAktion("installation_archiv")).toBe(true);
    expect(istAbwicklungAktion("installation_loeschen")).toBe(true);
    expect(istAbwicklungAktion("installation_entfernen")).toBe(false);
  });

  it("resolves the archive's parts from the signed manifest", () => {
    const r = abwicklungAuftragPruefen(beispiel, anfrage({}));
    expect(r.ok && r.auftrag).toMatchObject({
      art: "archiv",
      name: NAME,
      region: "eu-central-1",
    });
    const teile = r.ok && r.auftrag.art === "archiv" ? r.auftrag.teile : [];
    expect(teile.length).toBeGreaterThan(0);
    expect(teile.map(archivDatei)).toContain("volume-daten.tar");
  });

  it("takes deleting without any argument", () => {
    const r = abwicklungAuftragPruefen(
      beispiel,
      anfrage({ aktion: ABWICKLUNG_AKTIONEN.loeschen, argumente: {} }),
    );
    expect(r).toEqual({ ok: true, auftrag: { art: "loeschen", name: NAME, mitBackup: true } });
    const ohne = abwicklungAuftragPruefen(
      { ...beispiel, backup: [] },
      anfrage({ aktion: ABWICKLUNG_AKTIONEN.loeschen, argumente: {} }),
    );
    expect(ohne).toEqual({ ok: true, auftrag: { art: "loeschen", name: NAME, mitBackup: false } });
  });

  it("refuses anything else", () => {
    const zugang = {
      repository: "s3:https://s3.example.org/b/x/y",
      zugang: { schluesselId: "abc", geheim: "geheimnis" },
      passwort: "x".repeat(20),
    };
    expect(grund(abwicklungAuftragPruefen(beispiel, anfrage({ installationId: null })))).toMatch(
      /named installation/,
    );
    expect(
      grund(abwicklungAuftragPruefen(beispiel, anfrage({ installationId: "../etc" }))),
    ).toMatch(/named installation/);
    expect(
      grund(abwicklungAuftragPruefen(beispiel, anfrage({ argumente: { region: "EU 1" } }))),
    ).toMatch(/region/);
    expect(
      grund(
        abwicklungAuftragPruefen(beispiel, anfrage({ argumente: { region: "x", argv: "rm" } })),
      ),
    ).toMatch(/unknown argument argv/);
    expect(grund(abwicklungAuftragPruefen(beispiel, anfrage({ backup: zugang })))).toMatch(
      /neither/,
    );
    expect(
      grund(
        abwicklungAuftragPruefen(
          beispiel,
          anfrage({ aktion: ABWICKLUNG_AKTIONEN.loeschen, argumente: { region: "x" } }),
        ),
      ),
    ).toMatch(/region/);
    expect(
      grund(abwicklungAuftragPruefen(beispiel, anfrage({ aktion: "installation_backup" }))),
    ).toMatch(/not a job after a contract/);
    expect(grund(abwicklungAuftragPruefen({ ...beispiel, backup: [] }, anfrage({})))).toMatch(
      /no backup part/,
    );
  });
});
