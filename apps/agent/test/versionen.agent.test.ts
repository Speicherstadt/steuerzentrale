import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUSGABE, REGISTRY } from "../../../scripts/beispiel-images.ts";
import { testDatenbank } from "../../zentrale/src/db/test-db.ts";
import { schreiben } from "../../zentrale/src/modules/audit/index.ts";
import { befehlImportieren } from "../../zentrale/src/modules/manifeste/index.ts";
import { appsUebersicht, versionen } from "../../zentrale/src/modules/versionen/index.ts";
import { TEST_SCHLUESSEL } from "../../zentrale/src/testhilfen/installationen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-501, "Fertig, wenn": against the local registry a new version is found. The
 * stand-in of the Zentrale's own tests (testhilfen/registry.ts) answers as the OCI Distribution
 * Spec says; this asks CNCF distribution itself, as the agent tests' globalSetup runs it on
 * localhost:5000 with the example app's 1.0.0, 2.0.0 and 2.1.0 (scripts/beispiel-images.ts), and
 * imports the manifest of 1.0.0 the way `steuerzentrale manifest importieren` does. In this job,
 * since only it has the registry; the Zentrale reaches it over plain HTTP only redirected
 * (STEUERZENTRALE_REGISTRY_HTTP).
 */
const podman = requirePodman(process.env.CI === "true");
const manifest = (version: string) => join(AUSGABE, "manifeste", version, "manifest.yml");

describe.skipIf(podman === null)("the Zentrale's version query against the local registry", () => {
  it("finds 2.0.0 and 2.1.0 beside the imported 1.0.0, their manifests missing until imported", async () => {
    const d = testDatenbank();
    schreiben(
      d.schreibDb,
      { betreiberId: "b1", akteur: "test", jetzt: 1, grund: "Test" },
      "test",
      (w) => w.einfuegen("betreiber", { betreiberId: "b1", name: "Teufel IT", angelegtAm: 1 }),
    );
    expect(befehlImportieren(d, TEST_SCHLUESSEL, manifest("1.0.0"), 1)).toMatchObject({ ok: true });
    const log: string[] = [];
    const v = versionen({
      db: d.db,
      schreibDb: d.schreibDb,
      fetch,
      umleitung: `http://${REGISTRY}`,
      now: Date.now,
      log: (z) => log.push(z),
    });
    await v.abfragen();
    const [beispiel] = appsUebersicht(d.db, v.stand);
    expect(beispiel?.registry).toMatchObject({ image: `${REGISTRY}/beispiel`, fehler: null });
    expect(beispiel?.versionen.map((x) => [x.version, x.zustand])).toEqual([
      ["2.1.0", "manifest_fehlt"],
      ["2.0.0", "manifest_fehlt"],
      ["1.0.0", "verfuegbar"],
    ]);

    expect(befehlImportieren(d, TEST_SCHLUESSEL, manifest("2.0.0"), 2)).toMatchObject({ ok: true });
    expect(appsUebersicht(d.db, v.stand)[0]?.versionen.map((x) => x.zustand)).toEqual([
      "manifest_fehlt",
      "verfuegbar",
      "verfuegbar",
    ]);
    expect(log).toEqual([]);
  });
});
