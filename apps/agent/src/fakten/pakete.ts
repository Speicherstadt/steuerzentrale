import type { FaktenQuellen } from "./quellen.ts";

/*
 * Software facts (BAULISTE.md Z-304): pending package updates and the Podman version, each from one
 * command with a fixed argv. Neither touches the system: `apt-get -s` only simulates, from the
 * package lists the system's apt timers keep fresh.
 */

export const APT_SIMULIEREN = ["apt-get", "-s", "-q", "upgrade"] as const;
export const PODMAN_VERSION = ["podman", "--version"] as const;

/** The packages `apt-get -s upgrade` would install: one `Inst` line each (apt-get(8), -s) */
export const updatesAusstehend = async (q: FaktenQuellen): Promise<number | null> => {
  const lauf = await q.ausfuehren(APT_SIMULIEREN, 60_000);
  if (lauf?.code !== 0) return null;
  return lauf.aus.split("\n").filter((zeile) => zeile.startsWith("Inst ")).length;
};

export const podmanVersion = async (q: FaktenQuellen): Promise<string | null> => {
  const lauf = await q.ausfuehren(PODMAN_VERSION, 10_000);
  if (lauf?.code !== 0) return null;
  return /^podman version (\S+)/m.exec(lauf.aus)?.[1] ?? null;
};
