/** The workspaces of the monorepo: every folder under packages/ and apps/ with a package.json (from Speicherstadt/kennwort) */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const workspaceDirs = (root: string): string[] =>
  ["packages", "apps"]
    .filter((group) => existsSync(join(root, group)))
    .flatMap((group) => readdirSync(join(root, group)).map((name) => `${group}/${name}`))
    .filter((dir) => existsSync(join(root, dir, "package.json")))
    .sort();

// Matched from the left, so a "//", "/*" or ",]" inside a string stays part of the string. Comments
// go first, so a trailing comma before a comment is seen as trailing in the second pass.
const STRING = /"(?:[^"\\]|\\.)*"/.source;
const COMMENTS = new RegExp(`(${STRING})|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/`, "g");
const TRAILING_COMMAS = new RegExp(`(${STRING})|,(?=\\s*[}\\]])`, "g");
const keepStrings = (_match: string, string?: string) => string ?? "";

/** Reads a tsconfig file, which may carry comments and trailing commas (JSONC) */
export const parseJsonc = (text: string): unknown =>
  JSON.parse(text.replace(COMMENTS, keepStrings).replace(TRAILING_COMMAS, keepStrings));

/** The paths a solution tsconfig references */
export const referencedPaths = (tsconfig: unknown): string[] =>
  ((tsconfig as { references?: { path: string }[] }).references ?? []).map((ref) => ref.path);
