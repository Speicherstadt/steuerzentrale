import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { veroeffentlichtePorts } from "./ports.ts";
import { testManifest } from "./quadlet/testeingabe.ts";
import type { Manifest } from "./schema.ts";

/*
 * The ports an installation opens to the network (BAULISTE.md Z-702, the check of open ports): what
 * its Quadlets publish besides the HTTP port on 127.0.0.1 (quadlet/container.ts), from the real
 * manifests in manifeste/.
 */

const MANIFESTE = join(import.meta.dirname, "../../../manifeste");

const appManifest = (app: string): Manifest => {
  const [version] = readdirSync(join(MANIFESTE, app));
  return testManifest(readFileSync(join(MANIFESTE, app, version ?? "", "manifest.yml"), "utf8"));
};

describe("veroeffentlichtePorts", () => {
  it("names the fixed ports, a range port by port, each with its protocol", () => {
    const ports = veroeffentlichtePorts(appManifest("kontext"), [], {});
    expect(ports).toContainEqual({ port: 25, proto: "tcp" });
    expect(ports).toContainEqual({ port: 7882, proto: "udp" });
    expect(ports).toContainEqual({ port: 443, proto: "udp" });
    expect(ports).toContainEqual({ port: 20000, proto: "udp" });
    expect(ports).toContainEqual({ port: 20100, proto: "udp" });
    expect(ports).not.toContainEqual({ port: 20101, proto: "udp" });
    expect(ports).not.toContainEqual({ port: 20000, proto: "tcp" });
  });

  it("names an assigned port by the host port the Zentrale gave it", () => {
    expect(
      veroeffentlichtePorts(appManifest("stellwerk"), [], { "zentrale:22001": 20005 }),
    ).toEqual([{ port: 20005, proto: "tcp" }]);
  });

  it("leaves out an assigned port the installation was never given", () => {
    expect(veroeffentlichtePorts(appManifest("stellwerk"), [], {})).toEqual([]);
  });

  it("names the ports of an option's container only with the option chosen", () => {
    const belegt = appManifest("belegt");
    expect(veroeffentlichtePorts(belegt, [], {})).toEqual([]);
    const mitFtp = veroeffentlichtePorts(belegt, ["ftp"], {});
    expect(mitFtp).toContainEqual({ port: 21, proto: "tcp" });
    expect(mitFtp).toContainEqual({ port: 30009, proto: "tcp" });
    expect(mitFtp).toHaveLength(11);
  });

  it("never names the HTTP port, which is published on 127.0.0.1 only", () => {
    expect(veroeffentlichtePorts(appManifest("haben"), [], { http: 20001 })).toEqual([]);
  });
});
