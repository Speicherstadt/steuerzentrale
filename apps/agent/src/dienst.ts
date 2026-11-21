import type { Vertrauen } from "./auftraege/pruefen.ts";
import type { Dateien } from "./dateien.ts";
import { einstellungenLesen, type Geprueft, manifestSchluessel } from "./einstellungen.ts";
import type { Pfade } from "./pfade.ts";

/**
 * The agent as systemd service (`steuerzentrale-agent dienst`): it starts only on a joined server,
 * with its settings, key, certificate and a trusted manifest key in place, and otherwise fails, so
 * systemd shows why. Then it connects to the Zentrale (src/verbindung, WSS with the certificate);
 * the manifest key checks every job it gets (src/auftraege).
 */
export const dienstPruefen = async (
  dateien: Dateien,
  pfade: Pfade,
): Promise<Geprueft<{ zentrale: string; serverId: string; vertrauen: Vertrauen }>> => {
  const einstellungen = await einstellungenLesen(dateien, pfade.einstellungen);
  if (!einstellungen.ok) return einstellungen;
  const schluessel = await manifestSchluessel(
    dateien,
    pfade.manifestSchluessel,
    einstellungen.wert.testmodus,
  );
  if (!schluessel.ok) return schluessel;
  for (const [pfad, art] of [
    [pfade.schluessel, "PRIVATE KEY"],
    [pfade.zertifikat, "CERTIFICATE"],
    [pfade.ca, "CERTIFICATE"],
  ] as const)
    if (!(await dateien.lesen(pfad))?.startsWith(`-----BEGIN ${art}-----`))
      return { ok: false, grund: `${pfad} is missing or no ${art}` };
  const { zentrale, serverId, testmodus } = einstellungen.wert;
  return {
    ok: true,
    wert: {
      zentrale,
      serverId,
      vertrauen: { schluessel: schluessel.wert, zweck: testmodus ? "test" : "release" },
    },
  };
};
