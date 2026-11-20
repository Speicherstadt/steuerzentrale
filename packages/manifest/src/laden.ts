import { parse } from "yaml";
import { regelnPruefen } from "./pruefungen.ts";
import { type Manifest, ManifestStruktur } from "./schema.ts";
import { type OeffentlicherSchluessel, signaturPruefen } from "./signatur.ts";

export type Geprueft = { ok: true; manifest: Manifest } | { ok: false; fehler: string[] };

const pfadText = (pfad: readonly PropertyKey[]): string =>
  pfad.length === 0 ? "(manifest)" : pfad.map(String).join(".");

/** A manifest from its YAML text, or every finding as "field: reason" */
export const manifestPruefen = (text: string): Geprueft => {
  let roh: unknown;
  try {
    roh = parse(text, { uniqueKeys: true, maxAliasCount: 0 });
  } catch (fehler) {
    return { ok: false, fehler: [`(yaml): ${(fehler as Error).message.split("\n")[0]}`] };
  }
  const struktur = ManifestStruktur.safeParse(roh);
  if (!struktur.success)
    return {
      ok: false,
      fehler: struktur.error.issues.map((issue) => `${pfadText(issue.path)}: ${issue.message}`),
    };
  const befunde = regelnPruefen(struktur.data);
  if (befunde.length > 0)
    return { ok: false, fehler: befunde.map((b) => `${pfadText(b.pfad)}: ${b.grund}`) };
  return { ok: true, manifest: struktur.data };
};

/**
 * A manifest only with a valid signature of `schluessel` over its exact bytes (docs/plan.md,
 * "Was der Agent ausführt"); the signature is checked before the YAML is even parsed
 */
export const signiertesManifestLaden = (
  inhalt: Uint8Array,
  signatur: string | undefined,
  schluessel: OeffentlicherSchluessel,
): Geprueft => {
  if (signatur === undefined)
    return { ok: false, fehler: ["(signature): the manifest is not signed"] };
  const signiert = signaturPruefen(inhalt, signatur, schluessel);
  if (!signiert.ok) return { ok: false, fehler: [`(signature): ${signiert.grund}`] };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(inhalt);
  } catch {
    return { ok: false, fehler: ["(manifest): not UTF-8"] };
  }
  return manifestPruefen(text);
};
