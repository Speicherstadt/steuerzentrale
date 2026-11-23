import { describe, expect, it } from "vitest";
import {
  angeboteneVersionen,
  istVorabversion,
  tagAlsVersion,
  versionAngeboten,
  versionVergleichen,
} from "./versionen.ts";

describe("versionVergleichen", () => {
  it("orders by major, minor and patch as numbers", () => {
    const sortiert = ["1.10.0", "1.2.0", "2.0.0", "1.2.10", "1.2.9"].sort(versionVergleichen);
    expect(sortiert).toEqual(["1.2.0", "1.2.9", "1.2.10", "1.10.0", "2.0.0"]);
  });

  it("puts a pre-release before its release, numeric parts as numbers", () => {
    const sortiert = ["2.0.0", "2.0.0-rc.10", "2.0.0-rc.2", "1.9.9"].sort(versionVergleichen);
    expect(sortiert).toEqual(["1.9.9", "2.0.0-rc.2", "2.0.0-rc.10", "2.0.0"]);
  });

  it("finds equal versions equal", () => {
    expect(versionVergleichen("1.0.0", "1.0.0")).toBe(0);
    expect(versionVergleichen("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });
});

describe("tagAlsVersion", () => {
  it.each([
    ["1.2.3", "1.2.3"],
    ["v1.2.3", "1.2.3"],
    ["2.0.0-rc.1", "2.0.0-rc.1"],
    ["v0.10.0-beta.2", "0.10.0-beta.2"],
  ])("reads %s as %s", (tag, version) => {
    expect(tagAlsVersion(tag)).toBe(version);
  });

  it.each(["latest", "1.2", "main", "1.2.3.4", "V1.2.3", "01.2.3", "1.2.3+build", "sha-abc"])(
    "counts %s as no version",
    (tag) => {
      expect(tagAlsVersion(tag)).toBeUndefined();
    },
  );
});

describe("istVorabversion", () => {
  it("is a version with a pre-release part", () => {
    expect(istVorabversion("2.0.0-rc.1")).toBe(true);
    expect(istVorabversion("2.0.0")).toBe(false);
  });
});

describe("versionAngeboten (docs/plan.md, Interne Kunden und Vorabversionen)", () => {
  it("offers a release to every installation", () => {
    expect(versionAngeboten("2.0.0", false)).toBe(true);
    expect(versionAngeboten("2.0.0", true)).toBe(true);
  });

  it("offers a pre-release only to an installation of an internal customer, never to others", () => {
    expect(versionAngeboten("2.0.0-rc.1", true)).toBe(true);
    expect(versionAngeboten("2.0.0-rc.1", false)).toBe(false);
  });
});

describe("angeboteneVersionen", () => {
  const manifeste = [
    { version: "1.0.0", dringend: false },
    { version: "1.1.0", dringend: false },
    { version: "2.0.0-rc.1", dringend: false },
    { version: "1.2.0", dringend: true },
  ];

  it("offers the newer versions with a manifest, newest first, with their marks", () => {
    expect(angeboteneVersionen({ version: "1.0.0", intern: false }, manifeste)).toEqual([
      { version: "1.2.0", dringend: true, vorabversion: false },
      { version: "1.1.0", dringend: false, vorabversion: false },
    ]);
  });

  it("adds the pre-release for an installation of an internal customer", () => {
    expect(
      angeboteneVersionen({ version: "1.1.0", intern: true }, manifeste).map((v) => v.version),
    ).toEqual(["2.0.0-rc.1", "1.2.0"]);
  });

  it("offers nothing to an installation on the newest version", () => {
    expect(angeboteneVersionen({ version: "1.2.0", intern: false }, manifeste)).toEqual([]);
  });

  it("offers the release after a pre-release an internal installation runs", () => {
    const mitRelease = [...manifeste, { version: "2.0.0", dringend: false }];
    expect(
      angeboteneVersionen({ version: "2.0.0-rc.1", intern: true }, mitRelease).map(
        (v) => v.version,
      ),
    ).toEqual(["2.0.0"]);
  });
});
