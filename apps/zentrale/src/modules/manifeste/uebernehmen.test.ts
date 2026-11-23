import { describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema.ts";
import {
  installationsUmgebung,
  signiert,
  TEST_SCHLUESSEL,
  type Testmanifest,
} from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { manifesteListe, manifestLesen } from "./lesen.ts";
import { manifesteUebernehmen } from "./uebernehmen.ts";

/*
 * BAULISTE.md Z-501: installations made before keep their manifest; at the start the Zentrale takes
 * each missing version into `manifeste`, the first installation's text when two differ, and only
 * with a signature that holds with its key.
 */

type U = ReturnType<typeof installationsUmgebung>;

/** An installation as Z-402 made it, with the manifest's text and signature in its own row */
const alteInstallation = (
  u: U,
  installationId: string,
  manifest: Testmanifest,
  angelegtAm: number,
  teil: { signatur?: string } = {},
) =>
  schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
    w.einfuegen("installationen", {
      betreiberId: "b1",
      installationId,
      kundeId: "k1",
      serverId: "s1",
      app: "probe",
      version: "1.0.0",
      manifestHash: "0".repeat(64),
      ...signiert(manifest),
      ...teil,
      host: `${installationId}.example`,
      ports: "{}",
      optionen: "[]",
      einstellungen: "{}",
      geheim: "x",
      zustand: "laeuft",
      angelegtVon: "test",
      angelegtAm,
      geaendertAm: angelegtAm,
    }),
  );

describe("the manifests of installations made before Z-501", () => {
  it("go into manifeste once, the first installation's text when two differ", () => {
    const u = installationsUmgebung();
    u.bereit("b1", null);
    alteInstallation(u, "probe-zweite", "probe-anders", 20);
    alteInstallation(u, "probe-erste", "probe", 10);
    expect(manifesteUebernehmen(u, TEST_SCHLUESSEL, 99)).toEqual({
      uebernommen: 1,
      abgelehnt: ["probe-zweite: version_vergeben"],
    });
    expect(manifestLesen(u.db, "probe", "1.0.0")).toMatchObject({
      text: signiert("probe").manifest,
      importiertVon: "uebernommen",
      importiertAm: 99,
    });
    const eintrag = u.db
      .select()
      .from(auditLog)
      .all()
      .find((e) => e.aktion === "manifest.importieren");
    expect(eintrag).toMatchObject({ betreiberId: "b1", akteur: "system" });
    expect(eintrag?.grund).toContain("probe-erste");

    // at the next start nothing is missing; the second text is named again for the log
    expect(manifesteUebernehmen(u, TEST_SCHLUESSEL, 100)).toEqual({
      uebernommen: 0,
      abgelehnt: ["probe-zweite: version_vergeben"],
    });
  });

  it("are not taken over without a valid signature", () => {
    const u = installationsUmgebung();
    u.bereit("b1", null);
    alteInstallation(u, "probe-falsch", "probe", 10, { signatur: signiert("stumm").signatur });
    expect(manifesteUebernehmen(u, TEST_SCHLUESSEL, 99)).toEqual({
      uebernommen: 0,
      abgelehnt: ["probe-falsch: signatur_ungueltig"],
    });
    expect(manifesteListe(u.db)).toEqual([]);
  });
});
