import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dateien } from "../dateien.ts";

/** A file system in memory: what was written, with its mode */
export const speicher = (anfang: Record<string, string> = {}) => {
  const inhalt = new Map<string, { text: string; modus: number }>(
    Object.entries(anfang).map(([pfad, text]) => [pfad, { text, modus: 0o644 }]),
  );
  const reihenfolge: string[] = [];
  const dateien: Dateien = {
    lesen: async (pfad) => inhalt.get(pfad)?.text,
    schreiben: async (pfad, text, modus) => {
      reihenfolge.push(pfad);
      inhalt.set(pfad, { text, modus });
    },
  };
  return { dateien, inhalt, reihenfolge };
};

/** The public test key (test/schluessel/test.pub), trusted only in test mode */
export const TEST_PUB = readFileSync(
  join(import.meta.dirname, "../../../../test/schluessel/test.pub"),
  "utf8",
);
