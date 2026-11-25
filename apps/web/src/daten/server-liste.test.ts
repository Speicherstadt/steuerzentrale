import { describe, expect, it } from "vitest";
import { alsServerDerZentrale } from "../demo/server-quelle.ts";
import { JETZT } from "../demo/zeit.ts";
import { suche } from "./ableitungen.ts";
import type { InstallationAnsicht } from "./installation-ansicht.ts";
import { bestand } from "./quelle.ts";
import { serverAnsicht } from "./server-ansicht.ts";
import { brauchtJemanden, lastGemessen, serverStand, serverZeilen } from "./server-liste.ts";

const b = { ...bestand(), jetzt: JETZT };
const ansichten = b.server.map((sv) =>
  serverAnsicht(alsServerDerZentrale(sv, JETZT), suche(b.server, sv.id)),
);

const inst = (id: string, serverId: string, kundeId: string, zustand = "laeuft") =>
  ({ id, serverId, kundeId, zustand }) as InstallationAnsicht;

describe("the table of the page Server", () => {
  it("puts what needs attention first: a full disk, a silent agent, a reboot, a check, then all well", () => {
    const zeilen = serverZeilen(b, ansichten, []);
    expect(zeilen.map((z) => [z.a.id, z.stand.art])).toEqual([
      ["lind", "platte"],
      ["kraft", "agent"],
      ["shared-2", "neustart"],
      ["holm", "pruefen"],
      ["bestand", "ok"],
      ["shared-1", "ok"],
    ]);
    expect(zeilen.map((z) => brauchtJemanden(z.stand))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("counts the apps not removed and their customers", () => {
    const zeilen = serverZeilen(b, ansichten, [
      inst("a", "shared-1", "k1"),
      inst("b", "shared-1", "k1"),
      inst("c", "shared-1", "k2"),
      inst("d", "shared-1", "k3", "entfernt"),
      inst("e", "holm", "k3"),
    ]);
    const von = (id: string) => zeilen.find((z) => z.a.id === id);
    expect(von("shared-1")).toMatchObject({ apps: 3, kunden: 2 });
    expect(von("holm")).toMatchObject({ apps: 1, kunden: 1 });
    expect(von("lind")).toMatchObject({ apps: 0, kunden: 0 });
  });

  it("names the silent agent with its last report, the disk with its share", () => {
    const kraft = ansichten.find((a) => a.id === "kraft");
    const lind = ansichten.find((a) => a.id === "lind");
    if (!kraft || !lind) throw new Error("demo");
    expect(serverStand(b, kraft)).toEqual({
      art: "agent",
      zustand: "still",
      letzteMeldung: JETZT - 6 * 60_000,
    });
    expect(serverStand(b, lind)).toEqual({ art: "platte", prozent: 91 });
  });

  it("plans the reboot for the start of the next free maintenance window", () => {
    const zwei = ansichten.find((a) => a.id === "shared-2");
    if (!zwei) throw new Error("demo");
    const plan = zwei.neustartStand.plan;
    expect(serverStand(b, zwei)).toEqual({
      art: "neustart",
      ab: plan.art === "warten" ? (plan.ab ?? null) : null,
    });
    expect(
      serverStand(b, {
        ...zwei,
        neustartStand: { ...zwei.neustartStand, plan: { art: "warten", grund: "auftraege" } },
      }),
    ).toEqual({ art: "neustart", ab: null });
  });

  it("shows CPU and RAM only where the agent reported them (Z-1106)", () => {
    const zeilen = serverZeilen(b, ansichten, []);
    expect(lastGemessen(zeilen)).toBe(true);
    expect(zeilen.find((z) => z.a.id === "shared-1")).toMatchObject({ cpu: 23, ram: 48 });
    const ohne = serverZeilen(
      b,
      ansichten.map((a) => ({ ...a, cpu: null, ramProzent: null })),
      [],
    );
    expect(ohne.every((z) => z.cpu === null && z.ram === null)).toBe(true);
    expect(lastGemessen(ohne)).toBe(false);
  });
});
