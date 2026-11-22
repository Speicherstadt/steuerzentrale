import { describe, expect, it } from "vitest";
import {
  installationsUmgebung,
  LIZENZ,
  neueInstallation,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { installationAnlegen } from "../installationen/anlegen.ts";
import { betreiberEinstellungenLesen } from "./betreiber.ts";

/*
 * BAULISTE.md Z-404, the operator's values as the API shows them: a value the newest manifest
 * declares secret never comes back, even one stored in plain text while an older manifest, in which
 * it was not secret, was the newest (docs/plan.md, "Neuestes Manifest einer App"; werte.ts,
 * betreiberWerteFuer, sends such a value to the agent as a secret one too).
 */

describe("the operator's values of an app", () => {
  it("never show a value the form declares secret, even one stored in plain text", () => {
    const u = installationsUmgebung();
    u.bereit();
    const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation());
    if (!a.ok) throw new Error(a.grund);
    // as written under an older manifest in which PROBE_LIZENZ was a text
    schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
      w.aendern(
        "appEinstellungen",
        { app: "probe", name: "PROBE_LIZENZ" },
        { wert: JSON.stringify(LIZENZ), wertVerschluesselt: null },
      ),
    );
    const r = betreiberEinstellungenLesen(u.deps, "b1", "probe");
    if (!r.ok) throw new Error(r.grund);
    expect(r.einstellungen.felder.find((f) => f.name === "PROBE_LIZENZ")?.geheim).toBe(true);
    expect(JSON.stringify(r.einstellungen)).not.toContain(LIZENZ);
    expect(r.einstellungen.gesetzt).toContain("PROBE_LIZENZ");
  });
});
