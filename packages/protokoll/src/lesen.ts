import type { z } from "zod";
import {
  type NachrichtVomAgenten,
  type NachrichtVonDerZentrale,
  VomAgenten,
  VonDerZentrale,
} from "./nachrichten.ts";

/** The protocol version of this build; the Zentrale also understands the version before it (Z-504) */
export const PROTOKOLL_VERSION = 1;

/** The oldest version the Zentrale reads: an agent one update behind still talks to it */
export const AELTESTE_VERSION = Math.max(1, PROTOKOLL_VERSION - 1);

/**
 * Upgrades a message of an older version to the next one, by version it comes from. Versions only
 * add: a field new in version n gets its value here for a message of n-1. Empty while version 1 is
 * the only one.
 */
export type Aufwertung = (nachricht: Record<string, unknown>) => Record<string, unknown>;
export const AUFWERTUNGEN: Readonly<Record<number, Aufwertung>> = {};

export type Gelesen<T> = { ok: true; nachricht: T } | { ok: false; grund: string };

type Optionen = {
  version: number;
  aelteste: number;
  aufwertungen: Readonly<Record<number, Aufwertung>>;
};
const STANDARD: Optionen = {
  version: PROTOKOLL_VERSION,
  aelteste: AELTESTE_VERSION,
  aufwertungen: AUFWERTUNGEN,
};

const lesen = <S extends z.ZodType>(
  schema: S,
  text: string,
  optionen: Optionen,
): Gelesen<z.output<S>> => {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return { ok: false, grund: "no JSON" };
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh))
    return { ok: false, grund: "no JSON object" };
  let nachricht = roh as Record<string, unknown>;
  const version = nachricht.protokoll;
  if (typeof version !== "number" || !Number.isInteger(version))
    return { ok: false, grund: "protokoll: missing" };
  if (version > optionen.version)
    return { ok: false, grund: `protokoll ${version} is newer than ${optionen.version}` };
  if (version < optionen.aelteste)
    return { ok: false, grund: `protokoll ${version} is older than ${optionen.aelteste}` };
  for (let v = version; v < optionen.version; v++) {
    const aufwerten = optionen.aufwertungen[v];
    if (!aufwerten) return { ok: false, grund: `no upgrade from protokoll ${v}` };
    nachricht = { ...aufwerten(nachricht), protokoll: v + 1 };
  }
  const geprueft = schema.safeParse(nachricht);
  if (!geprueft.success) {
    const issue = geprueft.error.issues[0];
    return {
      ok: false,
      grund: `${issue?.path.join(".") || "(message)"}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true, nachricht: geprueft.data };
};

/** A message of an agent, as the Zentrale reads it: this version or the one before */
export const vomAgentenLesen = (
  text: string,
  optionen: Optionen = STANDARD,
): Gelesen<NachrichtVomAgenten> => lesen(VomAgenten, text, optionen);

/** A message of the Zentrale, as the agent reads it: the agent is never newer than its Zentrale */
export const vonDerZentraleLesen = (text: string): Gelesen<NachrichtVonDerZentrale> =>
  lesen(VonDerZentrale, text, { ...STANDARD, aelteste: PROTOKOLL_VERSION });

/** The text sent over the WebSocket, checked against the schema before it leaves */
export const schreiben = <S extends z.ZodType>(schema: S, nachricht: z.input<S>): string =>
  JSON.stringify(schema.parse(nachricht));
