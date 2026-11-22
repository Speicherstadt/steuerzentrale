import type { Manifest } from "@steuerzentrale/manifest";
import type { Zufall } from "./werte.ts";

/*
 * What the Zentrale assigns to a new installation (docs/plan.md, "Installationen in der Zentrale"):
 * its name `<app>-<6 characters a-z, 0-9>` and its host ports from 20000-29999 on its server, the
 * HTTP port on 127.0.0.1 and each port of `netz.ports` with `fest: false` (a range as consecutive
 * ports). Pure: what is taken and the random bytes are passed in; the primary key of
 * `installations_ports` still refuses a port taken twice.
 */

export const PORT_BEREICH = { von: 20_000, bis: 29_999 } as const;

const ZEICHEN = "abcdefghijklmnopqrstuvwxyz0123456789";
// 252 = 7 · 36: bytes from here on would favour the first characters
const GRENZE = 252;

/** The 6 characters after `<app>-`, uniformly from a-z and 0-9 */
export const namensteil = (zufall: Zufall): string => {
  let teil = "";
  while (teil.length < 6)
    for (const b of zufall(12)) if (b < GRENZE && teil.length < 6) teil += ZEICHEN[b % 36];
  return teil;
};

/** A name not yet taken; after a few tries none (then something else is wrong) */
export const nameErzeugen = (
  app: string,
  zufall: Zufall,
  vergeben: (name: string) => boolean,
): string | undefined => {
  for (let versuch = 0; versuch < 10; versuch++) {
    const name = `${app}-${namensteil(zufall)}`;
    if (!vergeben(name)) return name;
  }
  return undefined;
};

/** A block of ports the installation needs: `http`, or `<dienst>:<port>` with the range's length */
export type Portbedarf = { zweck: string; anzahl: number };

/** The ports to assign for this app with these options: only for containers that run */
export const portbedarf = (m: Manifest, optionen: readonly string[]): Portbedarf[] => {
  const laufen = new Set([
    ...m.container.map((c) => c.name),
    ...m.optionen
      .filter((o) => optionen.includes(o.id))
      .flatMap((o) => o.container.map((c) => c.name)),
  ]);
  return [
    ...(m.netz.http ? [{ zweck: "http", anzahl: 1 }] : []),
    ...m.netz.ports
      .filter((p) => !p.fest && laufen.has(p.dienst))
      .map((p) => ({ zweck: `${p.dienst}:${p.port}`, anzahl: (p.bis ?? p.port) - p.port + 1 })),
  ];
};

export type Vergeben = { zweck: string; von: number; anzahl: number }[];

/** The lowest free block for each need in turn, or undefined when the range is full */
export const portsVergeben = (
  bedarf: readonly Portbedarf[],
  belegt: ReadonlySet<number>,
): Vergeben | undefined => {
  const besetzt = new Set(belegt);
  const vergeben: Vergeben = [];
  for (const b of bedarf) {
    let von = PORT_BEREICH.von;
    const frei = (start: number) =>
      Array.from({ length: b.anzahl }, (_, i) => start + i).every((p) => !besetzt.has(p));
    while (von + b.anzahl - 1 <= PORT_BEREICH.bis && !frei(von)) von++;
    if (von + b.anzahl - 1 > PORT_BEREICH.bis) return undefined;
    for (let i = 0; i < b.anzahl; i++) besetzt.add(von + i);
    vergeben.push({ zweck: b.zweck, von, anzahl: b.anzahl });
  }
  return vergeben;
};
