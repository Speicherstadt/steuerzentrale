import type { FaktenQuellen } from "./quellen.ts";

/*
 * Software facts (BAULISTE.md Z-304): pending package updates and the Podman version, each from one
 * command with a fixed argv. Neither touches the system: `apt-get -s` only simulates, from the
 * package lists the system's apt timers keep fresh.
 */

export const APT_SIMULIEREN = ["apt-get", "-s", "-q", "upgrade"] as const;
export const PODMAN_VERSION = ["podman", "--version"] as const;

// the summary line apt-get prints in the C locale, the agent runs it with LC_ALL=C
const ZUSAMMENFASSUNG =
  /^(\d+) upgraded, \d+ newly installed, \d+ to remove and (\d+) not upgraded/m;

/**
 * The packages with a newer version: those `apt-get -s upgrade` would upgrade and those it keeps
 * back, such as a kernel with a new ABI, which `upgrade` never installs (apt-get(8))
 */
export const updatesAusstehend = async (q: FaktenQuellen): Promise<number | null> => {
  const lauf = await q.ausfuehren(APT_SIMULIEREN, 60_000);
  if (lauf?.code !== 0) return null;
  const treffer = ZUSAMMENFASSUNG.exec(lauf.aus);
  return treffer ? Number(treffer[1]) + Number(treffer[2]) : null;
};

export const podmanVersion = async (q: FaktenQuellen): Promise<string | null> => {
  const lauf = await q.ausfuehren(PODMAN_VERSION, 10_000);
  if (lauf?.code !== 0) return null;
  return /^podman version (\S+)/m.exec(lauf.aus)?.[1] ?? null;
};
