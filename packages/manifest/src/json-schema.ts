import { z } from "zod";
import { ManifestStruktur } from "./schema.ts";

/**
 * The manifest's structure as JSON Schema (draft 2020-12) for editors and app developers. The rules
 * across fields (pruefungen.ts) are not expressible there; the Zentrale checks them on import.
 */
export const manifestJsonSchema = (): Record<string, unknown> => ({
  ...z.toJSONSchema(ManifestStruktur, { io: "input", target: "draft-2020-12" }),
  $id: "https://github.com/Speicherstadt/steuerzentrale/blob/main/packages/manifest/manifest.schema.json",
  title: "Manifest einer App der Steuerzentrale",
});
