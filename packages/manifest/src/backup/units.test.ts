import { describe, expect, it } from "vitest";
import { unitLesen } from "../quadlet/systemd.ts";
import { BACKUP_ZEITLIMIT_S } from "./auftraege.ts";
import { AGENT_BINARY, BACKUP_SERVICE, BACKUP_TIMER, backupUnits } from "./units.ts";

/*
 * BAULISTE.md Z-601 (docs/plan.md, "Backup auf dem Server"): the timer of the installation's user
 * (daily, a random delay of up to an hour, a missed run caught up) and the service it starts, which
 * runs the agent's binary as that user with `sichern <installation>`, without a shell.
 */
const werte = (text: string, abschnitt: string, schluessel: string) =>
  (unitLesen(text).find((a) => a.name === abschnitt)?.zeilen ?? [])
    .filter(([k]) => k === schluessel)
    .map(([, w]) => w);

describe("backupUnits", () => {
  const units = backupUnits("beispiel-x7k2p9");
  const service = units[BACKUP_SERVICE] ?? "";
  const timer = units[BACKUP_TIMER] ?? "";

  it("names units no container of an installation can have: a container unit has no underscore", () => {
    expect(Object.keys(units).sort()).toEqual(["sz_backup.service", "sz_backup.timer"]);
  });

  it("runs the agent's binary once, with the installation as one word", () => {
    expect(AGENT_BINARY).toBe("/usr/local/bin/steuerzentrale-agent");
    expect(werte(service, "Service", "Type")).toEqual(["oneshot"]);
    expect(werte(service, "Service", "ExecStart")).toEqual([
      "/usr/local/bin/steuerzentrale-agent sichern beispiel-x7k2p9",
    ]);
    expect(werte(service, "Service", "TimeoutStartSec")).toEqual([String(BACKUP_ZEITLIMIT_S)]);
  });

  it("starts it daily with a random delay of up to an hour and catches up a missed run", () => {
    expect(werte(timer, "Timer", "OnCalendar")).toEqual(["daily"]);
    expect(werte(timer, "Timer", "RandomizedDelaySec")).toEqual(["3600"]);
    expect(werte(timer, "Timer", "Persistent")).toEqual(["true"]);
    expect(werte(timer, "Timer", "Unit")).toEqual([BACKUP_SERVICE]);
    expect(werte(timer, "Install", "WantedBy")).toEqual(["timers.target"]);
  });

  it("takes another binary, for the agent tests", () => {
    const test = backupUnits("test-x", "/usr/local/bin/sz-test-agent");
    expect(werte(test[BACKUP_SERVICE] ?? "", "Service", "ExecStart")).toEqual([
      "/usr/local/bin/sz-test-agent sichern test-x",
    ]);
  });

  it("refuses a name that is no installation's", () => {
    expect(() => backupUnits("-x")).toThrow();
    expect(() => backupUnits("a b")).toThrow();
  });
});
