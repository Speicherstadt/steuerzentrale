import { instantVon, ortszeit } from "./zeit.ts";

/*
 * Quiet hours of an operator's notifications (BAULISTE.md Z-703; docs/plan.md, "Ruhezeit der
 * Benachrichtigungen"): every day from `von` to `bis`, Berlin time "HH:MM"; `bis` before `von` ends
 * on the next day. Within them only a fault (`fehler`) goes out; a warning or a notice waits for
 * their end. A wall time that does not exist moves forward as in `instantVon`.
 */
export type Ruhezeit = { von: string; bis: string };

/** The severities of events, lowest first */
export const SCHWEREN = ["info", "warn", "fehler"] as const;
export type Schwere = (typeof SCHWEREN)[number];

/** The rank of a severity; one the Zentrale does not know counts as `info` */
const rang = (schwere: string): number => Math.max(0, SCHWEREN.indexOf(schwere as Schwere));

/** Whether an event of `schwere` reaches a recipient that wants `ab` and above */
export const schwereReicht = (schwere: string, ab: Schwere): boolean => rang(schwere) >= rang(ab);

/**
 * The severity a message goes out with: a fix (`…_behoben`, always `info`) takes that of the event
 * it fixes, so whoever heard of a fault also hears of its end
 */
export const meldeSchwere = (
  ereignis: { schwere: string },
  behebt: { schwere: string } | undefined,
): Schwere =>
  SCHWEREN[Math.max(rang(ereignis.schwere), behebt ? rang(behebt.schwere) : 0)] ?? "info";

const uhrzeit = (text: string): [number, number] => {
  const [h, m] = text.split(":").map(Number);
  return [h ?? 0, m ?? 0];
};

/** The end of the quiet hours `instant` lies in, or undefined outside them */
export const ruhezeitEnde = (ruhezeit: Ruhezeit | null, instant: number): number | undefined => {
  if (!ruhezeit) return undefined;
  const [vh, vm] = uhrzeit(ruhezeit.von);
  const [bh, bm] = uhrzeit(ruhezeit.bis);
  const ueberMitternacht = bh * 60 + bm <= vh * 60 + vm;
  const o = ortszeit(instant);
  // the window that began yesterday (over midnight) or begins today
  for (const tag of [o.tag - 1, o.tag]) {
    const start = instantVon(o.jahr, o.monat, tag, vh, vm);
    const ende = instantVon(o.jahr, o.monat, tag + (ueberMitternacht ? 1 : 0), bh, bm);
    if (start <= instant && instant < ende) return ende;
  }
  return undefined;
};

/** When a message of `schwere` may go out: at once for a fault, else after the quiet hours */
export const zustellbarAb = (ruhezeit: Ruhezeit | null, schwere: Schwere, jetzt: number): number =>
  schwere === "fehler" ? jetzt : (ruhezeitEnde(ruhezeit, jetzt) ?? jetzt);
