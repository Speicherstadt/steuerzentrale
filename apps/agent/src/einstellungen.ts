import {
  type OeffentlicherSchluessel,
  schluesselLesen,
  schluesselVertrauen,
} from "@steuerzentrale/manifest";
import { z } from "zod";
import type { Dateien } from "./dateien.ts";

/** What the agent keeps after joining (agent.json): its Zentrale and who it is there */
export const Einstellungen = z.object({
  zentrale: z.url(),
  serverId: z.string().min(1),
  /** Joined with the public test key: only in CI's test servers (docs/plan.md, "Signaturen in Tests") */
  testmodus: z.boolean(),
});
export type Einstellungen = z.infer<typeof Einstellungen>;

export type Geprueft<T> = { ok: true; wert: T } | { ok: false; grund: string };

/**
 * The public key manifests must be signed with, as install.sh left it; the public test key only in
 * test mode (packages/manifest, vertrauen.ts)
 */
export const manifestSchluessel = async (
  dateien: Dateien,
  pfad: string,
  testmodus: boolean,
): Promise<Geprueft<OeffentlicherSchluessel>> => {
  const text = await dateien.lesen(pfad);
  const schluessel = text === undefined ? undefined : schluesselLesen(text);
  if (!schluessel) return { ok: false, grund: `no minisign public key in ${pfad}` };
  const vertrauen = schluesselVertrauen(schluessel, testmodus ? "test" : "release");
  return vertrauen.ok ? { ok: true, wert: schluessel } : vertrauen;
};

export const einstellungenLesen = async (
  dateien: Dateien,
  pfad: string,
): Promise<Geprueft<Einstellungen>> => {
  const text = await dateien.lesen(pfad);
  if (text === undefined)
    return { ok: false, grund: `${pfad} is missing: the server has not joined` };
  try {
    const geparst = Einstellungen.safeParse(JSON.parse(text));
    if (geparst.success) return { ok: true, wert: geparst.data };
  } catch {
    // not JSON: the same answer as a wrong shape
  }
  return { ok: false, grund: `${pfad} is not the agent's settings` };
};
