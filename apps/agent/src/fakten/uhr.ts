import type { FaktenQuellen } from "./quellen.ts";

/*
 * Whether the server's clock is kept in time (BAULISTE.md Z-702): systemd-timedated's
 * NTPSynchronized (timedatectl(1), `show`), true once the kernel's clock is synchronised by
 * whichever time service runs (systemd-timesyncd, chrony). One command with a fixed argv; it
 * changes nothing. The offset itself the agent measures against the Zentrale (lesen.ts).
 */

export const UHR_SYNCHRON = [
  "timedatectl",
  "show",
  "--property=NTPSynchronized",
  "--value",
] as const;

export const uhrSynchron = async (q: FaktenQuellen): Promise<boolean | null> => {
  const lauf = await q.ausfuehren(UHR_SYNCHRON, 10_000);
  if (lauf?.code !== 0) return null;
  const wert = lauf.aus.trim();
  return wert === "yes" ? true : wert === "no" ? false : null;
};
