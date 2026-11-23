import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Binaer, Dateien } from "../dateien.ts";

/** SHA256SUMS of packages/manifest/test, with its signatures by the test key and by another key */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
export const SUMMEN = readFileSync(join(FIXTURES, "SHA256SUMS"), "utf8");
export const SIGNATUR = readFileSync(join(FIXTURES, "SHA256SUMS.minisig"), "utf8");
export const FREMDE_SIGNATUR = readFileSync(join(FIXTURES, "SHA256SUMS.fremd.minisig"), "utf8");

/** The binary of linux-x64 that SHA256SUMS above lists */
export const NEUES_X64 = new TextEncoder().encode("agent linux-x64 0.0.1\n");

export const BINARY = "/usr/local/bin/steuerzentrale-agent";
export const MARKE = "/var/lib/steuerzentrale/agent-update.json";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** One file system in memory for text and bytes, with the mode of each file */
export const platte = (anfang: Record<string, string> = {}) => {
  const inhalt = new Map<string, { bytes: Uint8Array; modus: number }>(
    Object.entries(anfang).map(([p, t]) => [
      p,
      { bytes: new TextEncoder().encode(t), modus: 0o755 },
    ]),
  );
  const dateien: Dateien = {
    lesen: async (p) => {
      const d = inhalt.get(p);
      return d && text(d.bytes);
    },
    schreiben: async (p, t, modus) => {
      inhalt.set(p, { bytes: new TextEncoder().encode(t), modus });
    },
    umbenennen: async (von, nach) => {
      const d = inhalt.get(von);
      if (!d) throw new Error(`ENOENT: ${von}`);
      inhalt.set(nach, d);
      inhalt.delete(von);
    },
  };
  const binaer: Binaer = {
    lesen: async (p) => inhalt.get(p)?.bytes,
    schreiben: async (p, bytes, modus) => {
      inhalt.set(p, { bytes, modus });
    },
    loeschen: async (p) => {
      inhalt.delete(p);
    },
  };
  const lesen = (p: string) => {
    const d = inhalt.get(p);
    return d && text(d.bytes);
  };
  return { dateien, binaer, inhalt, lesen };
};
