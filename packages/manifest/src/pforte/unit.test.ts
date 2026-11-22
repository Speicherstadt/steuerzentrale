import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import { quadletsRendern } from "../quadlet/rendern.ts";
import { PODMAN_4_9_SCHLUESSEL } from "../quadlet/schluessel.ts";
import { unitLesen } from "../quadlet/systemd.ts";
import { beispielManifest, testAnfrage } from "../quadlet/testeingabe.ts";
import { PFORTE_IMAGE } from "../system.ts";
import { PFORTE_ADMIN_IM_CONTAINER } from "./grund.ts";
import { PFORTE_ADMIN_VERZEICHNIS, PFORTE_UNIT, pforteUnit } from "./unit.ts";

const abschnitt = (name: string) =>
  unitLesen(pforteUnit()).find((a) => a.name === name)?.zeilen ?? [];
const werte = (a: string, s: string) =>
  abschnitt(a)
    .filter(([k]) => k === s)
    .map(([, w]) => w);

describe("the Pforte's Quadlet unit", () => {
  it("runs Caddy by digest from system.ts on the host's network", () => {
    expect(PFORTE_UNIT).toBe("sz-pforte.container");
    expect(werte("Container", "Image")).toEqual([PFORTE_IMAGE.image]);
    expect(PFORTE_IMAGE.image).toMatch(/^docker\.io\/library\/caddy@sha256:[0-9a-f]{64}$/);
    expect(werte("Container", "Network")).toEqual(["host"]);
    expect(werte("Container", "ContainerName")).toEqual(["sz-pforte"]);
  });

  it("has the admin API on a socket in a folder of the user's home and resumes its last config", () => {
    expect(werte("Container", "Environment")).toEqual([
      `"CADDY_ADMIN=unix/${PFORTE_ADMIN_IM_CONTAINER}"`,
    ]);
    expect(werte("Container", "Volume")).toContain(`%h/${PFORTE_ADMIN_VERZEICHNIS}:/run/pforte`);
    expect(werte("Container", "Exec")).toEqual(['"caddy" "run" "--resume"']);
    expect(werte("Service", "ExecStartPre")).toEqual([
      `/usr/bin/mkdir -p %h/${PFORTE_ADMIN_VERZEICHNIS}`,
    ]);
  });

  it("keeps certificates and the autosaved config in volumes", () => {
    expect(werte("Container", "Volume")).toEqual(
      expect.arrayContaining(["sz-pforte-daten:/data", "sz-pforte-konfig:/config"]),
    );
  });

  it("uses only keys Podman 4.9 knows, never AutoUpdate, and publishes no port", () => {
    const schluessel = abschnitt("Container").map(([k]) => k);
    for (const k of schluessel) expect(PODMAN_4_9_SCHLUESSEL.Container).toContain(k);
    expect(schluessel).not.toContain("AutoUpdate");
    expect(schluessel).not.toContain("PublishPort");
    expect(werte("Container", "NoNewPrivileges")).toEqual(["true"]);
    expect(werte("Service", "Restart")).toEqual(["always"]);
    expect(werte("Install", "WantedBy")).toEqual(["default.target"]);
  });
});

describe("the Pforte's Linux user", () => {
  // An installation runs as sz-<name> (eingabe.ts): one named "pforte" would share the user of the
  // Pforte, its units folder and the owner's access to Caddy's admin socket, and so every route
  it("is no installation's: no installation can be named pforte", () => {
    expect(INSTALLATIONS_NAME.test("pforte")).toBe(false);
    expect(INSTALLATIONS_NAME.test("pforte-k1")).toBe(true);
    const m = beispielManifest(
      readFileSync(
        join(import.meta.dirname, "../../../../manifeste/beispiel/manifest.vorlage.yml"),
        "utf8",
      ),
    );
    const r = quadletsRendern(testAnfrage(m, [], "pforte"));
    expect(r.ok ? [] : r.gruende.map((g) => g.pfad.join("."))).toContain("installation.name");
  });
});
