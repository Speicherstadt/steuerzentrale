import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { argumente, ausblenden, dateien, pruefeQuelle, pruefeTsconfig } from "./solid-muster.ts";

const muster = (datei: string, text: string) => pruefeQuelle(datei, text).map((f) => f.muster);

describe("pruefeQuelle: imports", () => {
  it("finds removed subpath imports", () => {
    expect(
      muster(
        "a.ts",
        'import { render } from "solid-js/web";\nimport { createStore } from "solid-js/store";',
      ),
    ).toEqual(['import from "solid-js/web"', 'import from "solid-js/store"']);
  });

  it("finds removed names imported from solid-js, also over several lines and with aliases", () => {
    const text =
      'import {\n  createSignal,\n  createResource as res,\n  batch,\n  on,\n} from "solid-js";';
    expect(muster("a.ts", text)).toEqual([
      "createResource (import)",
      "batch (import)",
      "on (import)",
    ]);
  });

  it("lets the 2.0 names through", () => {
    const text =
      'import { createSignal, createMemo, createEffect, onSettled, merge, omit, Loading, Errored, For, Show } from "solid-js";';
    expect(muster("a.ts", text)).toEqual([]);
  });

  it("finds Suspense and ErrorBoundary imported from @solidjs/web", () => {
    expect(muster("a.ts", 'import { Suspense, ErrorBoundary } from "@solidjs/web";')).toEqual([
      "Suspense (import)",
      "ErrorBoundary (import)",
    ]);
  });

  it("does not mind an on() of another library", () => {
    expect(muster("a.ts", 'import { on } from "node:events";\nemitter.on("x", f);')).toEqual([]);
  });
});

describe("pruefeQuelle: calls", () => {
  it("finds createResource and mergeProps even without an import", () => {
    expect(
      muster("a.ts", "const [u] = createResource(id, fetchUser);\nconst p = mergeProps(a, b);"),
    ).toEqual(["createResource(...)", "mergeProps(...)"]);
  });

  it("finds createEffect with one argument", () => {
    expect(muster("a.ts", "createEffect(() => {\n  el.title = name();\n});")).toEqual([
      "createEffect with one argument",
    ]);
  });

  it("lets createEffect(compute, apply) and the error bundle through", () => {
    const text = [
      "createEffect(() => name(), (v) => { el.title = v; });",
      "createEffect(count, (v) => log(v), { defer: true });",
      "createEffect(() => work(), {\n  effect: (v) => use(v),\n  error: (e) => warn(e),\n});",
      "createEffect<number>(\n  () => f(g(1, 2), [3, 4]),\n  (v) => h(v),\n);",
    ].join("\n");
    expect(muster("a.ts", text)).toEqual([]);
  });

  it("does not count a trailing comma as a second argument", () => {
    expect(muster("a.ts", "createEffect(() => {\n  run();\n},);")).toEqual([
      "createEffect with one argument",
    ]);
  });

  it("ignores patterns in comments and strings", () => {
    const text =
      '// createResource is gone\n/* createEffect(() => x) */\nconst msg = "use classList and createResource(";';
    expect(muster("a.tsx", text)).toEqual([]);
  });

  it("names the line", () => {
    expect(pruefeQuelle("a.ts", "const a = 1;\n\ncreateComputed(() => x());")[0]?.zeile).toBe(3);
  });

  it("points to the migration guide", () => {
    expect(pruefeQuelle("a.ts", "createComputed(() => x());")[0]?.ersatz).toContain(
      "docs/solid-2.0/MIGRATION.md",
    );
  });
});

describe("pruefeQuelle: JSX", () => {
  it("finds removed components and Context.Provider", () => {
    const text =
      "<Suspense fallback={<p />}><Index each={a()}>{(x) => x()}</Index></Suspense>\n<Theme.Provider value={t}>{c}</Theme.Provider>";
    expect(muster("a.tsx", text)).toEqual(["<Suspense>", "<Index>", "<Context.Provider>"]);
  });

  it("does not take <Loading> or <IndexPage> for 1.x", () => {
    expect(muster("a.tsx", "<Loading fallback={<p />}><IndexPage /></Loading>")).toEqual([]);
  });

  it("finds classList, directives, namespaces and lowercase handlers", () => {
    const text =
      '<div classList={{ a: on() }} use:tooltip={t} attr:x="1" on:click={f} onclick={g} />';
    expect(muster("a.tsx", text)).toEqual(["classList", "use:…", "attr:…", "on:…", "onclick={…}"]);
  });

  it("lets class objects and camelCase handlers through", () => {
    expect(
      muster("a.tsx", '<div class={["card", { active: on() }]} onClick={f} onPointerDown={g} />'),
    ).toEqual([]);
  });

  it("does not take TypeScript in a .tsx file for JSX attributes", () => {
    const text =
      "const online = { on: true };\nconst classList = el.classList;\nconst opts = { use: 1 };";
    expect(muster("a.tsx", text)).toEqual([]);
  });

  it("checks JSX patterns only in .tsx and .jsx", () => {
    expect(muster("a.ts", "const x = '<Suspense>'; classList;")).toEqual([]);
  });

  it("finds /*@once*/", () => {
    expect(muster("a.tsx", "<C value={/*@once*/ props.v} />")).toEqual(["/*@once*/"]);
  });
});

describe("pruefeTsconfig", () => {
  it('finds jsxImportSource "solid-js" and lets "@solidjs/web" through', () => {
    expect(
      pruefeTsconfig("t.json", '{ "compilerOptions": { "jsxImportSource": "solid-js" } }'),
    ).toHaveLength(1);
    expect(
      pruefeTsconfig("t.json", '{ "compilerOptions": { "jsxImportSource": "@solidjs/web" } }'),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  it("ausblenden keeps newlines and blanks comments", () => {
    const out = ausblenden("a // x\nb /* y\nz */ c", "kommentare");
    expect(out.split("\n")).toHaveLength(3);
    expect(out).not.toContain("x");
    expect(out).toContain("c");
  });

  it("argumente counts top-level arguments", () => {
    expect(argumente("f(a, g(b, c), [d, e])", 1)).toBe(3);
    expect(argumente("f()", 1)).toBe(0);
  });

  it("dateien reads apps, packages and e2e, not node_modules or generated files", () => {
    const root = mkdtempSync(join(tmpdir(), "solid-muster-"));
    for (const dir of [
      "apps/web/src",
      "apps/web/node_modules/x",
      "packages/ui/src/paraglide",
      "docs",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "apps/web/src/a.tsx"), "");
    writeFileSync(join(root, "apps/web/src/routeTree.gen.ts"), "");
    writeFileSync(join(root, "apps/web/node_modules/x/b.ts"), "");
    writeFileSync(join(root, "packages/ui/src/paraglide/m.js"), "");
    writeFileSync(join(root, "docs/c.ts"), "");
    const found = dateien(root)
      .map((p) => p.slice(root.length + 1))
      .sort();
    expect(found).toEqual(["apps/web/src/a.tsx", "tsconfig.json"]);
  });
});
