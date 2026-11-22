import { z } from "zod";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import { alsNutzer, type Nutzer } from "./nutzer.ts";

/*
 * The old Podman secrets of an installation, read back before it is reconfigured (Z-404;
 * docs/plan.md, "Neu konfigurieren"), so that a failure can bring them back. Rootless Podman keeps
 * them in the user's home; the agent asks Podman as that user, `podman secret ls` for the names and
 * `podman secret inspect --showsecret` for the values (Podman 4.5 and later, cmd/podman/secrets/
 * inspect.go), each a fixed argv without a shell, the output read from a pipe into memory only. The
 * values are never written to a file, a record, a log or a result; a reason here never holds what
 * Podman wrote. The user belongs to the installation alone, so every secret it has is one of the
 * installation's.
 */

/** A secret's name as the agent makes them (quadlet/container.ts, secretName); never an option */
const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** What `podman secret inspect --showsecret` reports of a secret (Podman 4.9, JSON) */
const Bericht = z.array(z.object({ Spec: z.object({ Name: z.string() }), SecretData: z.string() }));

export type SecretsGelesen =
  | { ok: true; werte: ReadonlyMap<string, string> }
  | { ok: false; grund: string };

const nein = (grund: string): SecretsGelesen => ({ ok: false, grund });

const code = (c: number | null) => `endete mit Code ${c ?? "–"}`;

/** The values of the reports, if they are exactly the secrets asked for */
const werteAus = (aus: string, namen: readonly string[]): Map<string, string> | undefined => {
  try {
    const geparst = Bericht.safeParse(JSON.parse(aus));
    if (!geparst.success) return undefined;
    const werte = new Map(geparst.data.map((b) => [b.Spec.Name, b.SecretData]));
    return namen.every((n) => werte.has(n)) && werte.size === namen.length ? werte : undefined;
  } catch {
    // not JSON; the parser's message may quote it, so it is dropped
    return undefined;
  }
};

export const secretsLesen = async (
  lesen: SpawnMitAusgabe,
  n: Nutzer,
  signal: AbortSignal,
): Promise<SecretsGelesen> => {
  const ls = await lesen(alsNutzer(n, ["podman", "secret", "ls", "--format", "{{.Name}}"]), signal);
  if (ls.code !== 0) return nein(`podman secret ls: ${code(ls.code)}`);
  const namen = ls.aus
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean);
  if (!namen.every((name) => SECRET_NAME.test(name)))
    return nein("podman secret ls: ein Name, den der Agent nicht vergibt");
  if (namen.length === 0) return { ok: true, werte: new Map() };
  const inspect = await lesen(
    alsNutzer(n, ["podman", "secret", "inspect", "--showsecret", ...namen]),
    signal,
  );
  if (inspect.code !== 0) return nein(`podman secret inspect: ${code(inspect.code)}`);
  const werte = werteAus(inspect.aus, namen);
  return werte ? { ok: true, werte } : nein("podman secret inspect: keine lesbare Antwort");
};
