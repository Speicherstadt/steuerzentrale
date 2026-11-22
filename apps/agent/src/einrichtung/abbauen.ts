import { laeufer } from "./lauf.ts";
import { alsNutzer, homeVon, nutzerName } from "./nutzer.ts";
import { gelungen, gescheitert, type Schrittergebnis, type SystemDeps } from "./typen.ts";

/*
 * Tearing down an installation the agent made and did not finish (docs/plan.md, "Scheitern beim
 * Einrichten"): its units stopped, lingering off, its sessions and processes ended, the user and its
 * home removed (`userdel --remove`; with them its containers, volumes, images and Podman secrets,
 * which all live in the home). Each step goes on when one before failed; done is what counts: no
 * user and no home afterwards. Only for an installation of the agent's record (auftrag.ts); the
 * home is the fixed path useradd was given, never one read from the system. Every step has its own
 * time limit, not the job's: a job that ran out of time is torn down all the same.
 */

const SCHRITT_MS = 60_000;
/** userdel refuses while a process of the user still runs; terminate-user ends them shortly */
const USERDEL_VERSUCHE = 30;
const USERDEL_WARTEN_MS = 1000;

export const abbauen = async (
  deps: SystemDeps,
  installation: string,
  units: readonly string[],
): Promise<Schrittergebnis> => {
  const lauf = laeufer(deps);
  const mit = { zeitlimitMs: SCHRITT_MS };
  const name = nutzerName(installation);
  const n = await deps.nutzer(name);
  let userdel: Schrittergebnis = gelungen;
  if (n) {
    if (units.length > 0)
      await lauf(
        "systemctl --user stop",
        alsNutzer(n, ["systemctl", "--user", "stop", ...units]),
        mit,
      );
    await lauf("loginctl disable-linger", ["loginctl", "disable-linger", name], mit);
    await lauf("loginctl terminate-user", ["loginctl", "terminate-user", name], mit);
    for (let i = 0; i < USERDEL_VERSUCHE; i++) {
      userdel = await lauf("userdel", ["userdel", "--remove", name], mit);
      if ((await deps.nutzer(name)) === undefined) break;
      await deps.warten(USERDEL_WARTEN_MS);
    }
    if ((await deps.nutzer(name)) !== undefined)
      return gescheitert(userdel.ok ? `${name} is still there` : userdel.grund);
  }
  // userdel removes the user even when it cannot remove the home (exit code 12)
  const home = homeVon(installation);
  if (await deps.haus.existiert(home))
    await lauf("rm home", ["rm", "-rf", "--one-file-system", "--", home], mit);
  return (await deps.haus.existiert(home)) ? gescheitert(`${home} is still there`) : gelungen;
};
