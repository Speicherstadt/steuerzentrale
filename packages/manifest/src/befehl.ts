import { hatSteuerzeichen } from "./quadlet/systemd.ts";
import type { Argument, Befehl, Manifest } from "./schema.ts";

/*
 * A named command as a job runs it (BAULISTE.md Z-305; docs/manifest.md, "Befehle"): the arguments
 * of the job checked against the command's declared ones, each value put into the argv element
 * that names it, as one whole word. Pure, no I/O; the Zentrale checks a job with it when it creates
 * one, the agent again before it runs one.
 */

/** The time limit of a command that names none: as long as a unit may take to start (Quadlet) */
export const STANDARD_ZEITLIMIT_S = 900;

/** An argv element that is a placeholder, and only that */
const PLATZHALTER = /^\$\{arg:([a-z][a-z0-9_]*)\}$/;
const IRGENDEIN_PLATZHALTER = /\$\{arg:/;

export type Wert = string | number | boolean;
export type Gefuellt = { ok: true; argv: string[] } | { ok: false; grund: string };

const musterVon = (muster: string): RegExp | undefined => {
  try {
    return new RegExp(`^(?:${muster})$`, "u");
  } catch {
    return undefined;
  }
};

/** The value as its argv word, or why it does not fit the declaration */
const wortFuer = (name: string, a: Argument, wert: Wert): string | { grund: string } => {
  const falsch = (was: string) => ({ grund: `argument ${name}: ${was}` });
  switch (a.typ) {
    case "text": {
      if (typeof wert !== "string") return falsch("not a text");
      if (wert.length > a.max_laenge) return falsch(`longer than ${a.max_laenge} characters`);
      if (hatSteuerzeichen(wert)) return falsch("has a control character");
      return musterVon(a.muster)?.test(wert) ? wert : falsch("does not match its pattern");
    }
    case "zahl": {
      if (typeof wert !== "number" || !Number.isSafeInteger(wert)) return falsch("not an integer");
      if (a.min !== undefined && wert < a.min) return falsch(`below ${a.min}`);
      if (a.max !== undefined && wert > a.max) return falsch(`above ${a.max}`);
      return String(wert);
    }
    case "ja_nein":
      return typeof wert === "boolean" ? String(wert) : falsch("not true or false");
    case "auswahl":
      return typeof wert === "string" && a.werte.includes(wert)
        ? wert
        : falsch(`not one of ${a.werte.join(", ")}`);
  }
};

/**
 * The argv of `befehl` with the job's `argumente`: every declared argument must be given, no other
 * one may be, and each must fit its declaration
 */
export const befehlFuellen = (
  befehl: Befehl,
  argumente: Readonly<Record<string, Wert>>,
): Gefuellt => {
  const fremd = Object.keys(argumente).filter((name) => !Object.hasOwn(befehl.argumente, name));
  if (fremd.length > 0) return { ok: false, grund: `unknown argument ${fremd.join(", ")}` };
  const woerter: Record<string, string> = {};
  for (const [name, a] of Object.entries(befehl.argumente)) {
    if (!Object.hasOwn(argumente, name)) return { ok: false, grund: `argument ${name} is missing` };
    const wort = wortFuer(name, a, argumente[name] as Wert);
    if (typeof wort !== "string") return { ok: false, ...wort };
    woerter[name] = wort;
  }
  return {
    ok: true,
    argv: befehl.argv.map((element) => {
      const platzhalter = PLATZHALTER.exec(element)?.[1];
      return platzhalter === undefined ? element : (woerter[platzhalter] as string);
    }),
  };
};

/** The command a job names, by its name under `befehle` */
export const befehlZurAktion = (manifest: Manifest, aktion: string): Befehl | undefined =>
  Object.hasOwn(manifest.befehle, aktion) ? manifest.befehle[aktion] : undefined;

type Befund = { pfad: (string | number)[]; grund: string };

/**
 * The rules of a command's arguments: a placeholder stands alone as a whole argv element, never as
 * the program, and names a declared argument; every declared argument is used; a pattern compiles
 */
export const argumentBefunde = (name: string, b: Befehl): Befund[] => {
  const pfad = ["befehle", name];
  const benutzt = new Set<string>();
  const befunde: Befund[] = b.argv.flatMap((element, i): Befund[] => {
    const platzhalter = PLATZHALTER.exec(element)?.[1];
    if (platzhalter === undefined)
      return IRGENDEIN_PLATZHALTER.test(element)
        ? [{ pfad: [...pfad, "argv", i], grund: "a placeholder is a whole argument of its own" }]
        : [];
    benutzt.add(platzhalter);
    if (i === 0)
      return [{ pfad: [...pfad, "argv", 0], grund: "the program is never a placeholder" }];
    return Object.hasOwn(b.argumente, platzhalter)
      ? []
      : [{ pfad: [...pfad, "argv", i], grund: `${platzhalter} is not declared under argumente` }];
  });
  for (const [arg, a] of Object.entries(b.argumente)) {
    if (!benutzt.has(arg))
      befunde.push({ pfad: [...pfad, "argumente", arg], grund: "no argv element uses it" });
    if (a.typ === "text" && !musterVon(a.muster))
      befunde.push({ pfad: [...pfad, "argumente", arg, "muster"], grund: "not a valid pattern" });
    if (a.typ === "zahl" && a.min !== undefined && a.max !== undefined && a.max < a.min)
      befunde.push({ pfad: [...pfad, "argumente", arg, "max"], grund: "max is below min" });
  }
  return befunde;
};
