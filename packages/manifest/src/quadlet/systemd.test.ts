// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${…} is text a word must keep
import { describe, expect, it } from "vitest";
import { systemdWort, unitLesen, unitText } from "./systemd.ts";

/**
 * The reverse of systemdWort as Quadlet (C unescape inside double quotes, split.go) and then systemd
 * (%% → %, $$ → $ in ExecStart=) read it: what the program in the container gets
 */
const gelesen = (wort: string): string => {
  expect(wort.startsWith('"') && wort.endsWith('"')).toBe(true);
  const innen = wort.slice(1, -1);
  expect(innen).not.toMatch(/(^|[^\\])"/);
  const quadlet = innen.replaceAll(/\\(.)/g, "$1");
  return quadlet.replaceAll("%%", "%").replaceAll("$$", "$");
};

describe("a word of a systemd command line", () => {
  it.each([
    "redis-server",
    "--config",
    "a b",
    'say "hi"',
    "C:\\pfad\\",
    "100%",
    "%h",
    "$HOME",
    "${HOME}",
    "kontext: ${env:X}",
    "ümlaut",
  ])("%j comes out unchanged", (wort) => {
    const w = systemdWort(wort);
    expect(w).not.toBeNull();
    expect(gelesen(w ?? "")).toBe(wort);
  });

  it("doubles % and $, so systemd expands no specifier and no variable", () => {
    expect(systemdWort("%h/$HOME")).toBe('"%%h/$$HOME"');
  });

  it.each(["", "a\nb", "a\rb", "tab\t", "nul\u0000", "esc\u001b", "del\u007f", "c1\u0085"])(
    "refuses %j: empty (Quadlet drops it) or with a control character",
    (wort) => {
      expect(systemdWort(wort)).toBeNull();
    },
  );
});

describe("a unit text", () => {
  it("leaves out empty sections and reads back as written", () => {
    const text = unitText("kopf", [
      { name: "Unit", zeilen: [["Description", "x"]] },
      { name: "Leer", zeilen: [] },
      { name: "Container", zeilen: [["Exec", '"a=b" "c"']] },
    ]);
    expect(text).toBe('# kopf\n\n[Unit]\nDescription=x\n\n[Container]\nExec="a=b" "c"\n');
    expect(unitLesen(text)).toEqual([
      { name: "Unit", zeilen: [["Description", "x"]] },
      { name: "Container", zeilen: [["Exec", '"a=b" "c"']] },
    ]);
  });
});
