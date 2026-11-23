import { describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { signiert, TEST_SCHLUESSEL } from "../../testhilfen/installationen.ts";
import { probeVersion } from "../../testhilfen/manifeste.ts";
import { schreiben } from "../audit/index.ts";
import { manifestImportieren } from "./importieren.ts";
import { manifesteListe, manifestLesen, neuestesManifestDerApp } from "./lesen.ts";

/*
 * BAULISTE.md Z-501: a manifest is imported only with a valid signature of the Zentrale's key, a
 * valid schema and rules; a version is imported once, the same text again changes nothing, other
 * text is refused; every import stands in the audit log, the text and signature only as set.
 */

const umgebung = () => {
  const d = testDatenbank();
  for (const betreiberId of ["b1", "b2"])
    schreiben(d.schreibDb, { betreiberId, akteur: "test", jetzt: 1, grund: "Test" }, "test", (w) =>
      w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: 1 }),
    );
  const kontext = { betreiberId: "b1", akteur: "nutzer-1", jetzt: 1_800_000_000_000, grund: "Neu" };
  const importieren = (eingabe = signiert("probe"), k: typeof kontext = kontext) =>
    manifestImportieren(d, k, TEST_SCHLUESSEL, eingabe, "betreiber");
  const audit = () =>
    d.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "manifest.importieren");
  return { ...d, kontext, importieren, audit };
};

describe("importing a manifest", () => {
  it("stores app, version, text, signature, hash and the urgent mark", () => {
    const u = umgebung();
    const r = u.importieren();
    expect(r).toMatchObject({ ok: true, neu: true });
    const m = manifestLesen(u.db, "probe", "1.0.0");
    expect(m).toMatchObject({
      app: "probe",
      version: "1.0.0",
      text: signiert("probe").manifest,
      signatur: signiert("probe").signatur,
      dringend: false,
      importiertAm: u.kontext.jetzt,
      importiertVon: "nutzer-1",
      importiertVonBetreiber: "b1",
    });
    expect(m?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps `dringend` from the manifest", () => {
    const u = umgebung();
    expect(u.importieren(probeVersion("1.2.0"))).toMatchObject({ ok: true });
    expect(manifestLesen(u.db, "probe", "1.2.0")?.dringend).toBe(true);
  });

  it.each([
    [
      "a text changed by one byte",
      { ...signiert("probe"), manifest: `${signiert("probe").manifest} ` },
    ],
    [
      "the signature of another manifest",
      { ...signiert("probe"), signatur: signiert("stumm").signatur },
    ],
    ["no signature", { ...signiert("probe"), signatur: "kein minisign" }],
  ])("refuses %s", (_fall, eingabe) => {
    const u = umgebung();
    expect(u.importieren(eingabe)).toMatchObject({ ok: false, grund: "signatur_ungueltig" });
    expect(manifesteListe(u.db)).toEqual([]);
    expect(u.audit()).toEqual([]);
  });

  it("refuses a signed text that breaks the schema", () => {
    const u = umgebung();
    expect(u.importieren(signiert("kaputt"))).toMatchObject({
      ok: false,
      grund: "manifest_ungueltig",
    });
    expect(manifesteListe(u.db)).toEqual([]);
  });

  it("changes nothing when the same version comes again with the same text", () => {
    const u = umgebung();
    u.importieren();
    expect(u.importieren(signiert("probe"), { ...u.kontext, betreiberId: "b2" })).toMatchObject({
      ok: true,
      neu: false,
    });
    expect(manifestLesen(u.db, "probe", "1.0.0")?.importiertVonBetreiber).toBe("b1");
    expect(u.audit()).toHaveLength(1);
  });

  it("refuses the same version with other content", () => {
    const u = umgebung();
    u.importieren();
    // probe-anders.yml is probe 1.0.0 with more memory
    expect(u.importieren(signiert("probe-anders"))).toMatchObject({
      ok: false,
      grund: "version_vergeben",
    });
    expect(manifestLesen(u.db, "probe", "1.0.0")?.text).toBe(signiert("probe").manifest);
  });

  it("refuses the same version spelled with a leading zero and other content", () => {
    const u = umgebung();
    u.importieren();
    // SemVer 2.0.0 forbids leading zeros; 01.0.0 would be a second 1.0.0 that compares equal
    expect(u.importieren(signiert("probe-01.0.0"))).toMatchObject({ ok: false });
    expect(manifesteListe(u.db).map((k) => k.version)).toEqual(["1.0.0"]);
  });

  it("writes the audit entry with text and signature only as set", () => {
    const u = umgebung();
    u.importieren();
    const [eintrag] = u.audit();
    expect(eintrag).toMatchObject({
      betreiberId: "b1",
      akteur: "nutzer-1",
      ziel: "manifeste:probe:1.0.0",
      grund: "Neu",
    });
    const inhalt = JSON.parse(eintrag?.inhalt ?? "{}") as { zeile: Record<string, unknown> };
    expect(inhalt.zeile).toMatchObject({ text: "[ausgelassen]", signatur: "[ausgelassen]" });
  });

  it("writes the entry into each named operator's audit log for the command", () => {
    const u = umgebung();
    const r = manifestImportieren(
      u,
      { ...u.kontext, akteur: "befehl", auchFuer: ["b2"] },
      TEST_SCHLUESSEL,
      signiert("probe"),
      "befehl",
    );
    expect(r).toMatchObject({ ok: true, neu: true });
    expect(u.audit().map((e) => e.betreiberId)).toEqual(["b1", "b2"]);
    expect(manifestLesen(u.db, "probe", "1.0.0")).toMatchObject({
      importiertVon: "befehl",
      importiertVonBetreiber: null,
    });
  });

  it("is immutable in the database itself", () => {
    const u = umgebung();
    u.importieren();
    expect(() =>
      schreiben(u.schreibDb, u.kontext, "test", (w) =>
        w.aendern("manifeste", { app: "probe", version: "1.0.0" }, { dringend: true }),
      ),
    ).toThrow(/immutable/);
    expect(() =>
      schreiben(u.schreibDb, u.kontext, "test", (w) =>
        w.loeschen("manifeste", { app: "probe", version: "1.0.0" }),
      ),
    ).toThrow(/immutable/);
  });
});

describe("the newest manifest of an app", () => {
  it("is the one of the highest version, a pre-release before its release", () => {
    const u = umgebung();
    for (const version of ["1.2.0", "2.0.0-rc.1", "1.10.0"] as const)
      u.importieren(probeVersion(version));
    expect(neuestesManifestDerApp(u.db, "probe")?.version).toBe("2.0.0-rc.1");
    expect(neuestesManifestDerApp(u.db, "fehlt")).toBeUndefined();
  });
});
