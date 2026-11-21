import type { LogSink } from "../../log.ts";
import { type AuftragDeps, type AuftragsMeldung, auftragMelden } from "../auftraege/index.ts";
import type { Server } from "../server/index.ts";

/**
 * Steps of a running job closer than this are dropped: they bypass the audit log, and the step
 * shown is the latest anyway (Z-305); acknowledgements and results always count
 */
export const FORTSCHRITT_ABSTAND_MS = 5_000;

/**
 * What one connection does with its agent's reports about jobs (Z-305, src/modules/auftraege):
 * steps thinned out per job, a refused report only logged
 */
export const auftragsEingang = (
  deps: AuftragDeps & { log: LogSink },
  server: () => Server,
): ((n: AuftragsMeldung, jetzt: number) => void) => {
  const letzterSchritt = new Map<string, number>();
  return (n, jetzt) => {
    if (n.typ === "fortschritt") {
      const abstand = jetzt - (letzterSchritt.get(n.auftragId) ?? Number.NEGATIVE_INFINITY);
      if (abstand >= 0 && abstand < FORTSCHRITT_ABSTAND_MS) return;
      letzterSchritt.set(n.auftragId, jetzt);
    }
    if (n.typ === "ergebnis") letzterSchritt.delete(n.auftragId);
    const gemeldet = auftragMelden(deps, server(), n, jetzt);
    if (!gemeldet.ok)
      deps.log(
        JSON.stringify({
          msg: "job report refused",
          serverId: server().serverId,
          auftragId: n.auftragId,
          grund: gemeldet.grund,
        }),
      );
  };
};
