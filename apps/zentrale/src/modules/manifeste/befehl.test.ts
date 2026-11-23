import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { auditLog } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { signiert, TEST_SCHLUESSEL } from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { befehlImportieren } from "./befehl.ts";
import { manifestLesen } from "./lesen.ts";

/*
 * BAULISTE.md Z-501: `steuerzentrale manifest importieren <pfad>` reads the manifest and its
 * .minisig beside it and imports them like the interface; the compiled binary runs it in
 * src/binary.test.ts.
 */

const dateien = (eingabe: { manifest: string; signatur: string }) => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-manifest-"));
  onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
  const pfad = join(ordner, "manifest.yml");
  writeFileSync(pfad, eingabe.manifest);
  writeFileSync(`${pfad}.minisig`, eingabe.signatur);
  return pfad;
};

const mitBetreibern = (...ids: string[]) => {
  const d = testDatenbank();
  for (const betreiberId of ids)
    schreiben(d.schreibDb, { betreiberId, akteur: "test", jetzt: 1, grund: "Test" }, "test", (w) =>
      w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: 1 }),
    );
  return d;
};

describe("the command manifest importieren", () => {
  it("imports the manifest beside its .minisig, in every operator's audit log", () => {
    const d = mitBetreibern("b1", "b2");
    const r = befehlImportieren(d, TEST_SCHLUESSEL, dateien(signiert("probe")), 5);
    expect(r).toMatchObject({ ok: true, neu: true });
    expect(manifestLesen(d.db, "probe", "1.0.0")?.importiertVon).toBe("befehl");
    const eintraege = d.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "manifest.importieren");
    expect(eintraege.map((e) => [e.betreiberId, e.akteur])).toEqual([
      ["b1", "befehl"],
      ["b2", "befehl"],
    ]);
  });

  it("changes nothing for the same text and refuses other content for the version", () => {
    const d = mitBetreibern("b1");
    befehlImportieren(d, TEST_SCHLUESSEL, dateien(signiert("probe")), 5);
    expect(befehlImportieren(d, TEST_SCHLUESSEL, dateien(signiert("probe")), 6)).toMatchObject({
      ok: true,
      neu: false,
    });
    expect(befehlImportieren(d, TEST_SCHLUESSEL, dateien(signiert("probe-anders")), 7)).toEqual({
      ok: false,
      grund: "version_vergeben",
    });
  });

  it("refuses a manifest without a valid signature", () => {
    const d = mitBetreibern("b1");
    const falsch = { ...signiert("probe"), signatur: signiert("stumm").signatur };
    expect(befehlImportieren(d, TEST_SCHLUESSEL, dateien(falsch), 5)).toMatchObject({
      ok: false,
      grund: "signatur_ungueltig",
    });
    expect(manifestLesen(d.db, "probe", "1.0.0")).toBeUndefined();
  });

  it("names what is missing: the signature file, the key, an operator", () => {
    const d = mitBetreibern("b1");
    expect(befehlImportieren(d, TEST_SCHLUESSEL, "/gibt/es/nicht.yml", 5)).toMatchObject({
      ok: false,
      grund: "datei_fehlt",
    });
    const pfad = dateien(signiert("probe"));
    expect(befehlImportieren(d, undefined, pfad, 5)).toEqual({
      ok: false,
      grund: "kein_schluessel",
    });
    expect(befehlImportieren(mitBetreibern(), TEST_SCHLUESSEL, pfad, 5)).toEqual({
      ok: false,
      grund: "kein_betreiber",
    });
  });
});
