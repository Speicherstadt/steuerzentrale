import { describe, expect, it } from "vitest";
import type { Gedaechtnis } from "../einrichtung/gedaechtnis.ts";
import { faktenMitLast } from "./mit-last.ts";
import { testQuellen } from "./testquellen.ts";

/*
 * BAULISTE.md Z-1106: the facts carry `last`, with a value per Linux user of each installation in
 * the agent's record; a user the system does not know is left out.
 */
describe("faktenMitLast", () => {
  it("adds the server's values and those of each installation's user", async () => {
    const q = testQuellen({
      dateien: {
        "/proc/stat": "cpu  100 0 50 800 50 0 0 0 0 0\n",
        "/proc/loadavg": "0.20 0.1 0.1 1/1 1\n",
        "/sys/fs/cgroup/user.slice/user-1001.slice/memory.current": String(256 * 1024 * 1024),
      },
    });
    const gedaechtnis = {
      lesen: async () => ({
        ok: true,
        stand: new Map([
          ["haben", { zustand: "fertig" }],
          ["fehlt", { zustand: "fertig" }],
        ]),
      }),
    } as unknown as Gedaechtnis;
    const nutzer = async (name: string) =>
      name === "sz-haben" ? { name, uid: 1001, gid: 1001, home: "/home/sz-haben" } : undefined;
    const fakten = await faktenMitLast(q, gedaechtnis, nutzer)(null, 1);
    expect(fakten.last).toEqual({
      cpuProzent: null,
      last1: 0.2,
      ramBelegtMb: null,
      nutzer: [{ name: "sz-haben", cpuProzent: null, ramMb: 256 }],
    });
  });
});
