import type { Dateien } from "../dateien.ts";
import type { Pfade } from "../pfade.ts";

/*
 * Keeping a rotated certificate (BAULISTE.md Z-303) so key and certificate always belong together,
 * even if the agent stops halfway: both land beside the old ones first; the certificate written
 * there is the point of no return; then key and certificate are renamed into place. On the next
 * start a certificate waiting there finishes the swap; a key alone there was never committed and is
 * ignored. The Zentrale accepts the old certificate until the agent connects with the new one.
 */
export type Neu = { schluessel: string; zertifikat: string; ca: string };

/** Finishes a swap that was committed (the rotated certificate is there); does nothing otherwise */
export const rotationAbschliessen = async (dateien: Dateien, pfade: Pfade): Promise<void> => {
  if ((await dateien.lesen(pfade.zertifikatNeu)) === undefined) return;
  if ((await dateien.lesen(pfade.schluesselNeu)) !== undefined)
    await dateien.umbenennen(pfade.schluesselNeu, pfade.schluessel);
  await dateien.umbenennen(pfade.zertifikatNeu, pfade.zertifikat);
};

export const rotationSpeichern = async (
  dateien: Dateien,
  pfade: Pfade,
  neu: Neu,
): Promise<void> => {
  await dateien.schreiben(pfade.schluesselNeu, neu.schluessel, 0o600);
  await dateien.schreiben(pfade.ca, neu.ca, 0o644);
  await dateien.schreiben(pfade.zertifikatNeu, neu.zertifikat, 0o644);
  await rotationAbschliessen(dateien, pfade);
};
