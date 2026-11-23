import type { FaktenQuellen } from "./quellen.ts";

/**
 * A server in memory for the fact tests: files, directories, commands by their argv joined with
 * spaces, and whatever else a test names. Nothing is there unless the test puts it there.
 */
export const testQuellen = (
  teile: {
    dateien?: Record<string, string>;
    ordner?: Record<string, string[]>;
    befehle?: Record<string, { code: number; aus: string }>;
    /** When a file was last changed */
    zeiten?: Record<string, number>;
  } & Partial<FaktenQuellen> = {},
): FaktenQuellen & { aufrufe: string[][] } => {
  const aufrufe: string[][] = [];
  const { dateien = {}, ordner = {}, befehle = {}, zeiten = {}, ...rest } = teile;
  return {
    aufrufe,
    lesen: async (pfad) => dateien[pfad],
    lesenFremd: async (pfad) => dateien[pfad],
    liste: async (pfad) => ordner[pfad],
    gibtEs: async (pfad) => pfad in dateien || pfad in ordner,
    geaendertAm: async (pfad) => zeiten[pfad],
    platz: async () => undefined,
    ausfuehren: async (argv) => {
      aufrufe.push([...argv]);
      return befehle[argv.join(" ")];
    },
    maschine: () => "",
    schnittstellen: () => ({}),
    rueckwaerts: async () => undefined,
    verbinden: async () => null,
    ...rest,
  };
};
