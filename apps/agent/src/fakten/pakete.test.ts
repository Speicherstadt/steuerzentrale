import { describe, expect, it } from "vitest";
import { APT_SIMULIEREN, PODMAN_VERSION, podmanVersion, updatesAusstehend } from "./pakete.ts";
import { testQuellen } from "./testquellen.ts";

// `apt-get -s upgrade` on Ubuntu 24.04 with two pending updates (apt 2.7, shortened)
const APT = [
  "Reading package lists...",
  "Building dependency tree...",
  "Calculating upgrade...",
  "The following packages will be upgraded:",
  "  libssl3t64 openssl",
  "2 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.",
  "Inst libssl3t64 [3.0.13-0ubuntu3.4] (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
  "Inst openssl [3.0.13-0ubuntu3.4] (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
  "Conf libssl3t64 (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
  "Conf openssl (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
].join("\n");

describe("pending updates", () => {
  it("counts the packages apt would install, with a fixed argv", async () => {
    const q = testQuellen({ befehle: { [APT_SIMULIEREN.join(" ")]: { code: 0, aus: APT } } });
    expect(await updatesAusstehend(q)).toBe(2);
    expect(q.aufrufe).toEqual([[...APT_SIMULIEREN]]);
    expect(APT_SIMULIEREN).toEqual(["apt-get", "-s", "-q", "upgrade"]);
  });

  it("counts the updates apt keeps back too, such as a new kernel", async () => {
    // `apt-get -s upgrade` installs no new packages, so a kernel with a new ABI is kept back
    // (apt-get(8), upgrade); it is a pending update all the same
    const zurueck = [
      "Reading package lists...",
      "Calculating upgrade...",
      "The following packages have been kept back:",
      "  linux-generic linux-image-generic",
      "The following packages will be upgraded:",
      "  openssl",
      "1 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.",
      "Inst openssl [3.0.13-0ubuntu3.4] (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
      "Conf openssl (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-updates [amd64])",
    ].join("\n");
    const q = testQuellen({ befehle: { [APT_SIMULIEREN.join(" ")]: { code: 0, aus: zurueck } } });
    expect(await updatesAusstehend(q)).toBe(3);
  });

  it("is 0 when apt has nothing, null without apt or when it fails", async () => {
    const leer =
      "Reading package lists...\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.";
    const befehl = APT_SIMULIEREN.join(" ");
    expect(
      await updatesAusstehend(testQuellen({ befehle: { [befehl]: { code: 0, aus: leer } } })),
    ).toBe(0);
    expect(
      await updatesAusstehend(testQuellen({ befehle: { [befehl]: { code: 100, aus: "" } } })),
    ).toBeNull();
    expect(await updatesAusstehend(testQuellen())).toBeNull();
  });
});

describe("Podman", () => {
  it("reads the version of `podman --version`", async () => {
    const q = testQuellen({
      befehle: { [PODMAN_VERSION.join(" ")]: { code: 0, aus: "podman version 4.9.3\n" } },
    });
    expect(await podmanVersion(q)).toBe("4.9.3");
  });

  it("is null without Podman or with output it does not know", async () => {
    expect(await podmanVersion(testQuellen())).toBeNull();
    const fremd = { [PODMAN_VERSION.join(" ")]: { code: 0, aus: "docker 27\n" } };
    expect(await podmanVersion(testQuellen({ befehle: fremd }))).toBeNull();
  });
});
