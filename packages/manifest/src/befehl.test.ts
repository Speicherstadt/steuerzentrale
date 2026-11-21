// biome-ignore-all lint/suspicious/noTemplateCurlyInString: argv placeholders are ${arg:…} as plain text
import { describe, expect, it } from "vitest";
import { argumentBefunde, befehlFuellen, befehlZurAktion } from "./befehl.ts";
import { manifestPruefen } from "./laden.ts";
import type { Befehl, Manifest } from "./schema.ts";

/*
 * BAULISTE.md Z-305: the arguments of a job are checked against the command's declaration in the
 * signed manifest, and each value becomes one whole argv word.
 */
const befehl = (teil: Partial<Befehl> = {}): Befehl => ({
  container: "app",
  argv: ["restic-tool", "restore", "${arg:snapshot}", "--tiefe", "${arg:tiefe}"],
  argumente: {
    snapshot: { typ: "text", muster: "[0-9a-f]{8}", max_laenge: 200 },
    tiefe: { typ: "zahl", min: 1, max: 5 },
  },
  idempotent: false,
  ...teil,
});

describe("befehlFuellen", () => {
  it("puts each value into its placeholder as one word", () => {
    expect(befehlFuellen(befehl(), { snapshot: "a1b2c3d4", tiefe: 2 })).toEqual({
      ok: true,
      argv: ["restic-tool", "restore", "a1b2c3d4", "--tiefe", "2"],
    });
  });

  it("keeps a value with spaces or shell characters one word, if its pattern allows it", () => {
    const b = befehl({
      argv: ["tool", "${arg:name}"],
      argumente: { name: { typ: "text", muster: ".+", max_laenge: 200 } },
    });
    expect(befehlFuellen(b, { name: "a; rm -rf / $(id)" })).toEqual({
      ok: true,
      argv: ["tool", "a; rm -rf / $(id)"],
    });
  });

  it.each([
    [{ snapshot: "a1b2c3d4" }, "argument tiefe is missing"],
    [{ snapshot: "a1b2c3d4", tiefe: 2, mehr: "x" }, "unknown argument mehr"],
    [{ snapshot: "a1b2c3d4; id", tiefe: 2 }, "argument snapshot: does not match its pattern"],
    [{ snapshot: "a1b2c3d", tiefe: 2 }, "argument snapshot: does not match its pattern"],
    [{ snapshot: 12345678, tiefe: 2 }, "argument snapshot: not a text"],
    [{ snapshot: "a1b2c3d4", tiefe: 6 }, "argument tiefe: above 5"],
    [{ snapshot: "a1b2c3d4", tiefe: 0 }, "argument tiefe: below 1"],
    [{ snapshot: "a1b2c3d4", tiefe: 1.5 }, "argument tiefe: not an integer"],
    [{ snapshot: "a1b2c3d4", tiefe: "2" }, "argument tiefe: not an integer"],
  ])("refuses %j: %s", (argumente, grund) => {
    expect(befehlFuellen(befehl(), argumente)).toEqual({ ok: false, grund });
  });

  it("anchors the pattern: a match inside the value is not enough", () => {
    const b = befehl({
      argv: ["tool", "${arg:x}"],
      argumente: { x: { typ: "text", muster: "[a-z]+|[0-9]+", max_laenge: 200 } },
    });
    expect(befehlFuellen(b, { x: "abc" }).ok).toBe(true);
    expect(befehlFuellen(b, { x: "abc123" }).ok).toBe(false);
  });

  it("does not let a pattern close the anchoring group and match anything", () => {
    // "x)|(.*" compiles only inside the wrapper, where it reads ^(?:x)|(.*)$: any value would do
    const b = befehl({
      argv: ["tool", "${arg:x}"],
      argumente: { x: { typ: "text", muster: "[0-9a-f]{8})|(.*", max_laenge: 200 } },
    });
    expect(befehlFuellen(b, { x: "--privileged" }).ok).toBe(false);
    expect(argumentBefunde("b", b).map((f) => f.pfad.join("."))).toEqual([
      "befehle.b.argumente.x.muster",
    ]);
  });

  it("refuses a text past its length and one with a control character", () => {
    const b = befehl({
      argv: ["tool", "${arg:x}"],
      argumente: { x: { typ: "text", muster: "[^]*", max_laenge: 3 } },
    });
    expect(befehlFuellen(b, { x: "abcd" })).toEqual({
      ok: false,
      grund: "argument x: longer than 3 characters",
    });
    expect(befehlFuellen(b, { x: "a\nb" })).toEqual({
      ok: false,
      grund: "argument x: has a control character",
    });
  });

  it("writes yes/no and choices as their words", () => {
    const b = befehl({
      argv: ["tool", "${arg:an}", "${arg:modus}"],
      argumente: { an: { typ: "ja_nein" }, modus: { typ: "auswahl", werte: ["voll", "teil"] } },
    });
    expect(befehlFuellen(b, { an: true, modus: "teil" })).toEqual({
      ok: true,
      argv: ["tool", "true", "teil"],
    });
    expect(befehlFuellen(b, { an: "ja", modus: "teil" })).toEqual({
      ok: false,
      grund: "argument an: not true or false",
    });
    expect(befehlFuellen(b, { an: false, modus: "alles" })).toEqual({
      ok: false,
      grund: "argument modus: not one of voll, teil",
    });
  });

  it("takes no arguments for a command that declares none", () => {
    const b = befehl({ argv: ["bun", "migrate"], argumente: {} });
    expect(befehlFuellen(b, {})).toEqual({ ok: true, argv: ["bun", "migrate"] });
    expect(befehlFuellen(b, { x: "1" })).toEqual({ ok: false, grund: "unknown argument x" });
  });

  it("does not take an inherited name for an argument", () => {
    const b = befehl({ argv: ["bun", "migrate"], argumente: {} });
    expect(befehlFuellen(b, JSON.parse('{"__proto__": "x"}')).ok).toBe(false);
  });
});

describe("argumentBefunde", () => {
  it.each([
    [
      ["tool", "--name=${arg:x}"],
      "befehle.b.argv.1",
      "a placeholder is a whole argument of its own",
    ],
    [["${arg:x}", "y"], "befehle.b.argv.0", "the program is never a placeholder"],
    [["tool", "${arg:x}", "${arg:y}"], "befehle.b.argv.2", "y is not declared under argumente"],
    [["tool"], "befehle.b.argumente.x", "no argv element uses it"],
  ])("finds %j at %s", (argv, pfad, grund) => {
    const b = befehl({ argv, argumente: { x: { typ: "ja_nein" } } });
    expect(
      argumentBefunde("b", b).map((f) => ({ pfad: f.pfad.join("."), grund: f.grund })),
    ).toContainEqual({ pfad, grund });
  });

  it("finds a pattern that does not compile and a range upside down", () => {
    const b = befehl({
      argv: ["tool", "${arg:x}", "${arg:n}"],
      argumente: {
        x: { typ: "text", muster: "([a-z", max_laenge: 200 },
        n: { typ: "zahl", min: 5, max: 1 },
      },
    });
    expect(argumentBefunde("b", b).map((f) => f.pfad.join("."))).toEqual([
      "befehle.b.argumente.x.muster",
      "befehle.b.argumente.n.max",
    ]);
  });
});

describe("a manifest with arguments, time limit and idempotent", () => {
  const yaml = (argv: string) => `
schema: 1
id: test
version: 1.0.0
lizenz: AGPL-3.0-only
quelle: https://example.org/test
container:
  - { name: app, image: "registry.example.org/test@sha256:${"a".repeat(64)}" }
architektur: [amd64]
ressourcen: { ram_mb: 128, platte_gb: 1 }
netz: { http: { dienst: app, port: 8080 } }
anmeldung: eigen
health: { art: keine, hinweis: Test }
befehle:
  wiederherstellen:
    container: app
    argv: ${argv}
    argumente: { snapshot: { typ: text, muster: "[0-9a-f]{8}" } }
    zeitlimit_s: 120
    idempotent: true
aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }
`;

  it("is valid, with the defaults filled in", () => {
    const geprueft = manifestPruefen(yaml('[tool, "${arg:snapshot}"]'));
    expect(geprueft.ok).toBe(true);
    const b = befehlZurAktion((geprueft as { manifest: Manifest }).manifest, "wiederherstellen");
    expect(b).toMatchObject({
      zeitlimit_s: 120,
      idempotent: true,
      argumente: { snapshot: { typ: "text", max_laenge: 200 } },
    });
  });

  it("is refused with the field when a placeholder hides in a word", () => {
    expect(manifestPruefen(yaml('[tool, "x${arg:snapshot}"]'))).toEqual({
      ok: false,
      fehler: [
        "befehle.wiederherstellen.argv.1: a placeholder is a whole argument of its own",
        "befehle.wiederherstellen.argumente.snapshot: no argv element uses it",
      ],
    });
  });

  it("names no action that is not a command", () => {
    const geprueft = manifestPruefen(yaml('[tool, "${arg:snapshot}"]'));
    const m = (geprueft as { manifest: Manifest }).manifest;
    expect(befehlZurAktion(m, "neustart")).toBeUndefined();
    expect(befehlZurAktion(m, "constructor")).toBeUndefined();
  });
});
