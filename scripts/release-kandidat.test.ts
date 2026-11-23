import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMAGE, PODMAN_4_9_SCHLUESSEL, unitLesen } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import {
  ARCHITEKTUREN,
  BASIS_IMAGE,
  kontextAnlegen,
  ZENTRALE_DATEN,
  zentraleUnit,
} from "./release-kandidat.ts";

/*
 * BAULISTE.md Z-1004: the release candidate's image context and the Quadlet unit of the Zentrale.
 * That the image builds for amd64 and arm64 and the unit runs under Podman 4.9 proves CI's job
 * `release-kandidat` in an Incus VM.
 */

const IMAGE_REF = `ghcr.io/speicherstadt/steuerzentrale@sha256:${"a".repeat(64)}`;

describe("the Quadlet unit of the Zentrale", () => {
  const unit = zentraleUnit(IMAGE_REF);
  const abschnitte = unitLesen(unit);
  const container = abschnitte.find((a) => a.name === "Container")?.zeilen ?? [];
  const werte = (schluessel: string) =>
    container.filter(([k]) => k === schluessel).map(([, w]) => w);

  it("names the image by digest only", () => {
    expect(werte("Image")).toEqual([IMAGE_REF]);
    expect(() => zentraleUnit("ghcr.io/speicherstadt/steuerzentrale:0.1.0")).toThrow();
    expect(IMAGE.test(BASIS_IMAGE)).toBe(true);
  });

  it("uses only keys Podman 4.9 knows, and never AutoUpdate", () => {
    for (const [k] of container) expect(PODMAN_4_9_SCHLUESSEL.Container).toContain(k);
    expect(werte("AutoUpdate")).toEqual([]);
  });

  it("keeps the key in a Podman secret, never in the unit or its environment file", () => {
    expect(werte("Secret")).toEqual([
      "steuerzentrale-secret-key,type=env,target=STEUERZENTRALE_SECRET_KEY",
    ]);
    expect(unit).not.toMatch(/STEUERZENTRALE_SECRET_KEY=/);
  });

  it("runs in the host's network, so the Pforte reaches it and it sees loopback as loopback", () => {
    expect(werte("Network")).toEqual(["host"]);
    expect(werte("NoNewPrivileges")).toEqual(["true"]);
    expect(werte("PublishPort")).toEqual([]);
  });

  it("keeps its data in a volume and reads the agent files read-only", () => {
    expect(werte("Volume")).toEqual([
      `steuerzentrale-daten:${ZENTRALE_DATEN}`,
      "%h/agent-dateien:/agent-dateien:ro",
    ]);
    expect(werte("Environment")).toContain("STEUERZENTRALE_AGENT_DATEIEN=/agent-dateien");
    expect(werte("EnvironmentFile")).toEqual(["%h/steuerzentrale.env"]);
  });

  it("starts at boot and again after a crash", () => {
    const service = abschnitte.find((a) => a.name === "Service")?.zeilen ?? [];
    expect(service).toContainEqual(["Restart", "always"]);
    expect(abschnitte.find((a) => a.name === "Install")?.zeilen).toEqual([
      ["WantedBy", "default.target"],
    ]);
  });
});

describe("the context of the image", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "sz-test-kontext-"));
  afterAll(() => rmSync(wurzel, { recursive: true, force: true }));

  it("lays out one binary per architecture as the Containerfile reads it, the interface and an empty data folder", () => {
    const quelle = join(wurzel, "quelle");
    mkdirSync(join(quelle, "zentrale"), { recursive: true });
    mkdirSync(join(quelle, "web", "assets"), { recursive: true });
    writeFileSync(join(quelle, "zentrale", "steuerzentrale-linux-x64"), "x64");
    writeFileSync(join(quelle, "zentrale", "steuerzentrale-linux-arm64"), "arm64");
    writeFileSync(join(quelle, "web", "index.html"), "<!doctype html>");
    const ziel = join(wurzel, "kontext");
    kontextAnlegen({ zentrale: join(quelle, "zentrale"), web: join(quelle, "web") }, ziel);
    expect(ARCHITEKTUREN).toEqual({ amd64: "linux-x64", arm64: "linux-arm64" });
    expect(existsSync(join(ziel, "amd64", "steuerzentrale"))).toBe(true);
    expect(existsSync(join(ziel, "arm64", "steuerzentrale"))).toBe(true);
    expect(existsSync(join(ziel, "web", "index.html"))).toBe(true);
    expect(readdirSync(join(ziel, "daten"))).toEqual([]);
    expect(existsSync(join(ziel, "Containerfile"))).toBe(true);
  });

  it("refuses a context without both binaries", () => {
    const quelle = join(wurzel, "halb");
    mkdirSync(join(quelle, "zentrale"), { recursive: true });
    mkdirSync(join(quelle, "web"), { recursive: true });
    writeFileSync(join(quelle, "zentrale", "steuerzentrale-linux-x64"), "x64");
    writeFileSync(join(quelle, "web", "index.html"), "<!doctype html>");
    expect(() =>
      kontextAnlegen(
        { zentrale: join(quelle, "zentrale"), web: join(quelle, "web") },
        join(wurzel, "k2"),
      ),
    ).toThrow(/linux-arm64/);
  });
});
