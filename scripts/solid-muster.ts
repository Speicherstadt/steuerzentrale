/**
 * Finds Solid 1.x patterns that Solid 2.0 removed or renamed (docs/solid-2.0/MIGRATION.md, section
 * "Quick rename / removal map", and docs/solid-2.0/CHEATSHEET.md, "What changed from 1.x").
 * Part of `bun run lint`; the skill solid-2 lists the same patterns for agents.
 * Behaviour that compiles but works differently (batching, writes in owned scope, top-level reads)
 * cannot be seen in the text; the review checks it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Fund = { datei: string; zeile: number; muster: string; ersatz: string };

const MIGRATION = "docs/solid-2.0/MIGRATION.md";

/** Removed or renamed exports of solid-js and @solidjs/web, with their 2.0 replacement */
const ENTFERNT: Record<string, string> = {
  createResource:
    "async createMemo(() => fetchX(id())) under <Loading>; refresh(x), action + createOptimistic",
  createComputed: "createMemo, split createEffect or createSignal(fn)",
  on: "the compute phase of a split createEffect(compute, apply)",
  batch: "nothing (writes batch by microtask); flush() in tests",
  startTransition: "built-in transitions, isPending, action",
  useTransition: "built-in transitions, isPending, action",
  onMount: "onSettled",
  onError: "<Errored> or the createEffect error option",
  catchError: "<Errored> or the createEffect error option",
  mergeProps: "merge (undefined overrides)",
  splitProps: "omit",
  produce: "draft setters are the default",
  createMutable: "createStore with draft setters",
  modifyMutable: "createStore with draft setters",
  unwrap: "snapshot",
  createSelector: "createProjection or createStore(fn)",
  observable: "createEffect pushing to the subscriber",
  indexArray: "mapArray",
  createDynamic: "the dynamic(source) factory",
  Dynamic: "the dynamic(source) factory",
  resetErrorBoundaries: "nothing (boundaries heal by themselves)",
  enableScheduling: "nothing (removed)",
  equalFn: "isEqual",
  getListener: "getObserver",
  Suspense: "<Loading>",
  SuspenseList: "<Reveal>",
  ErrorBoundary: "<Errored>",
  Index: "<For keyed={false}>",
};

/** Calls that are 1.x even without an import (aliased or re-exported) */
const AUFRUFE = [
  "createResource",
  "createComputed",
  "createMutable",
  "modifyMutable",
  "createSelector",
  "createDynamic",
  "indexArray",
  "startTransition",
  "useTransition",
  "mergeProps",
  "splitProps",
  "catchError",
  "resetErrorBoundaries",
];

const ALTE_PFADE: Record<string, string> = {
  "solid-js/web": "@solidjs/web",
  "solid-js/store": "solid-js",
  "solid-js/h": "@solidjs/h",
  "solid-js/html": "@solidjs/html",
  "solid-js/universal": "@solidjs/universal",
  "solid-js/jsx-runtime": "@solidjs/web/jsx-runtime",
  "solid-js/jsx-dev-runtime": "@solidjs/web/jsx-dev-runtime",
};

const JSX_TAGS: Record<string, string> = {
  Suspense: "<Loading>",
  SuspenseList: "<Reveal>",
  ErrorBoundary: "<Errored>",
  Index: "<For keyed={false}>",
  Dynamic: "the dynamic(source) factory",
};

type Modus = "kommentare" | "kommentare-und-texte";

/**
 * Replaces comments (and, if asked, the inside of strings) with spaces, keeping every newline, so
 * a pattern in a comment or a message does not count and line numbers stay right. Regex literals
 * are not recognised; a quote inside one can blank the rest of its line.
 */
export const ausblenden = (text: string, modus: Modus): string => {
  let out = "";
  let i = 0;
  const leer = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < text.length) {
    const c = text[i] ?? "";
    const n = text[i + 1] ?? "";
    if (c === "/" && n === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += leer(text.slice(i, stop));
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += leer(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && !(c !== "`" && text[j] === "\n"))
        j += text[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, text.length);
      out +=
        modus === "kommentare"
          ? text.slice(i, stop)
          : c + leer(text.slice(i + 1, stop - 1)) + (text[stop - 1] === c ? c : "");
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
};

const zeileVon = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** The number of top-level arguments of the call whose opening parenthesis is at `open` */
export const argumente = (text: string, open: number): number => {
  let tiefe = 0;
  let anzahl = 0;
  let inhalt = false;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if ("([{".includes(c)) {
      tiefe += 1;
      if (tiefe > 1) inhalt = true;
    } else if (")]}".includes(c)) {
      tiefe -= 1;
      if (tiefe === 0) return inhalt ? anzahl + 1 : 0;
    } else if (c === "," && tiefe === 1) {
      // a trailing comma before ")" does not start another argument
      if (/^\s*\)/.test(text.slice(i + 1))) continue;
      anzahl += 1;
    } else if (tiefe === 1 && !/\s/.test(c)) inhalt = true;
  }
  return anzahl + 1;
};

/** Names imported from solid-js or @solidjs/web (`import { a, b as c } from "solid-js"`) */
const solidImporte = (code: string): { name: string; index: number }[] =>
  [
    ...code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](solid-js|@solidjs\/web)["']/g),
  ].flatMap((m) =>
    (m[1] ?? "")
      .split(",")
      .map(
        (teil) =>
          teil
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      )
      .filter(Boolean)
      .map((name) => ({ name, index: m.index ?? 0 })),
  );

/** Every 1.x pattern in one source file */
export const pruefeQuelle = (datei: string, text: string): Fund[] => {
  const ohneKommentare = ausblenden(text, "kommentare");
  const code = ausblenden(text, "kommentare-und-texte");
  const funde: Fund[] = [];
  const fund = (index: number, muster: string, ersatz: string) =>
    funde.push({ datei, zeile: zeileVon(text, index), muster, ersatz });

  for (const m of ohneKommentare.matchAll(
    /(?:from\s*|import\s*\(\s*)["'](solid-js\/[\w-]+)["']/g,
  )) {
    const pfad = m[1] ?? "";
    if (ALTE_PFADE[pfad])
      fund(m.index ?? 0, `import from "${pfad}"`, `import from "${ALTE_PFADE[pfad]}"`);
  }
  for (const { name, index } of solidImporte(ohneKommentare)) {
    const ersatz = ENTFERNT[name];
    if (ersatz) fund(index, `${name} (import)`, ersatz);
  }
  for (const name of AUFRUFE)
    for (const m of code.matchAll(new RegExp(`(?<![\\w.$])${name}\\s*\\(`, "g")))
      fund(m.index ?? 0, `${name}(...)`, ENTFERNT[name] ?? "");
  for (const m of code.matchAll(/(?<![\w.$])createEffect\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (argumente(code, open) < 2)
      fund(m.index ?? 0, "createEffect with one argument", "createEffect(compute, apply)");
  }
  if (/\.(t|j)sx$/.test(datei)) {
    for (const [tag, ersatz] of Object.entries(JSX_TAGS))
      for (const m of code.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, "g")))
        fund(m.index ?? 0, `<${tag}>`, ersatz);
    for (const m of code.matchAll(/<[A-Z][\w]*\.Provider(?=[\s/>])/g))
      fund(m.index ?? 0, "<Context.Provider>", "<Context value={...}>");
    for (const m of code.matchAll(/\sclassList=[{"']/g))
      fund(m.index ?? 0, "classList", 'class with an object or array (class={["a", { b: on() }]})');
    for (const m of code.matchAll(/\s(use|attr|bool|on|oncapture):[\w-]+(?=[\s/>=])/g))
      fund(
        m.index ?? 0,
        `${m[1]}:…`,
        m[1] === "use"
          ? "a ref directive factory (ref={name(x)})"
          : m[1]?.startsWith("on")
            ? "onClick-style handlers or a ref callback"
            : "plain attributes",
      );
    for (const m of code.matchAll(/\son([a-z]+)=\{/g))
      fund(
        m.index ?? 0,
        `on${m[1]}={…}`,
        `on${(m[1] ?? "").charAt(0).toUpperCase()}${(m[1] ?? "").slice(1)} (lowercase on* is an attribute in 2.0)`,
      );
  }
  for (const m of text.matchAll(/\/\*\s*@once\s*\*\//g))
    fund(m.index ?? 0, "/*@once*/", "normal reactive JSX, defaultValue, or untrack in JavaScript");
  return funde.map((f) => ({ ...f, ersatz: `${f.ersatz} (${MIGRATION})` }));
};

/** `jsxImportSource: "solid-js"` in a tsconfig */
export const pruefeTsconfig = (datei: string, text: string): Fund[] =>
  [...text.matchAll(/"jsxImportSource"\s*:\s*"solid-js"/g)].map((m) => ({
    datei,
    zeile: zeileVon(text, m.index ?? 0),
    muster: 'jsxImportSource "solid-js"',
    ersatz: `"@solidjs/web" (${MIGRATION})`,
  }));

const QUELLEN = /\.(ts|tsx|js|jsx|mjs)$/;
const AUSLASSEN = new Set(["node_modules", "dist", "paraglide", ".tsbuild"]);

/** Every file below the given folders that the check reads */
export const dateien = (root: string, ordner = ["apps", "packages", "e2e"]): string[] => {
  const gehe = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (AUSLASSEN.has(name)) return [];
      const pfad = join(dir, name);
      if (statSync(pfad).isDirectory()) return gehe(pfad);
      return QUELLEN.test(name) && !name.endsWith(".gen.ts")
        ? [pfad]
        : /^tsconfig.*\.json$/.test(name)
          ? [pfad]
          : [];
    });
  const wurzel = readdirSync(root)
    .filter((name) => /^tsconfig.*\.json$/.test(name))
    .map((name) => join(root, name));
  return [
    ...wurzel,
    ...ordner
      .map((o) => join(root, o))
      .filter(existsSync)
      .flatMap(gehe),
  ];
};

if (import.meta.main) {
  const root = process.cwd();
  const funde = dateien(root).flatMap((pfad) => {
    const datei = relative(root, pfad);
    const text = readFileSync(pfad, "utf8");
    return datei.endsWith(".json") ? pruefeTsconfig(datei, text) : pruefeQuelle(datei, text);
  });
  for (const f of funde)
    console.error(`${f.datei}:${f.zeile}: Solid 1.x: ${f.muster} → ${f.ersatz}`);
  process.exit(funde.length > 0 ? 1 : 0);
}
