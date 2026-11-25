import { describe, expect, it } from "vitest";
import {
  Beobachten,
  healthPfadGueltig,
  linuxNutzerGueltig,
  UNITS_MAX,
  unitGueltig,
} from "./beobachten.ts";
import { PROTOKOLL_VERSION } from "./lesen.ts";

// BAULISTE.md Z-1103: the names of user and units are checked against a pattern by the Zentrale and
// the agent with these functions; they never stand in a shell line, and a name starting with `-`
// would be read as an option of systemctl or runuser
describe("names of observed units", () => {
  it.each([
    "haben.service",
    "caddy.service",
    "podman-kube@web.service",
    "backup.timer",
    "a:b.socket",
  ])("takes the unit %s", (name) => expect(unitGueltig(name)).toBe(true));

  it.each([
    "",
    "web service.service",
    "web;reboot.service",
    "../web.service",
    "/etc/systemd/system/web.service",
    "-H.service",
    "--host=x.service",
    "web",
    "web.sh",
    "web\\x2d.service",
    "web\n.service",
    `${"a".repeat(250)}.service`,
  ])("refuses the unit %j", (name) => expect(unitGueltig(name)).toBe(false));

  it.each(["tristan", "www-data", "_caddy", "sz-haben", "a1"])("takes the user %s", (name) =>
    expect(linuxNutzerGueltig(name)).toBe(true),
  );

  it.each(["", "a b", "a;b", "a/b", "-u", "--help", "Root", "a".repeat(33), "ä"])(
    "refuses the user %j",
    (name) => expect(linuxNutzerGueltig(name)).toBe(false),
  );

  it("takes a health path that starts with one slash and nothing that leaves it", () => {
    expect(healthPfadGueltig("/")).toBe(true);
    expect(healthPfadGueltig("/api/health")).toBe(true);
    expect(healthPfadGueltig("//evil.example")).toBe(false);
    expect(healthPfadGueltig("/a b")).toBe(false);
    expect(healthPfadGueltig("/a?b")).toBe(false);
    expect(healthPfadGueltig("health")).toBe(false);
  });
});

describe("the message beobachten", () => {
  const dienst = {
    dienstId: "d1",
    nutzer: "tristan",
    units: ["haben.service"],
    health: { art: "http", port: 3000, pfad: "/health" },
  };
  const nachricht = (d: Record<string, unknown>) => ({
    typ: "beobachten",
    protokoll: PROTOKOLL_VERSION,
    dienste: [d],
  });

  it("takes a service of a user or of the system, with or without a check", () => {
    expect(Beobachten.safeParse(nachricht(dienst)).success).toBe(true);
    expect(Beobachten.safeParse(nachricht({ ...dienst, nutzer: null })).success).toBe(true);
    expect(
      Beobachten.safeParse(nachricht({ ...dienst, health: { art: "tcp", port: 5432 } })).success,
    ).toBe(true);
    expect(Beobachten.safeParse(nachricht({ ...dienst, health: { art: "keine" } })).success).toBe(
      true,
    );
  });

  it("refuses a bad name, no unit, too many units or a check off 127.0.0.1's ports", () => {
    for (const falsch of [
      { ...dienst, nutzer: "-u" },
      { ...dienst, units: ["a;b.service"] },
      { ...dienst, units: [] },
      { ...dienst, units: Array.from({ length: UNITS_MAX + 1 }, (_, i) => `u${i}.service`) },
      { ...dienst, health: { art: "http", port: 0, pfad: "/" } },
      { ...dienst, health: { art: "http", port: 80, pfad: "//x" } },
      { ...dienst, health: { art: "http", host: "10.0.0.1", port: 80, pfad: "/" } },
    ])
      expect(Beobachten.safeParse(nachricht(falsch)).success, JSON.stringify(falsch)).toBe(false);
  });
});
