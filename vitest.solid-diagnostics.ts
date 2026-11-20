/**
 * The interface tests run on Solid's dev build (vitest.config.ts), whose diagnostics name a
 * reactivity defect by its code, such as [REACTIVE_WRITE_IN_OWNED_SCOPE] (docs/solid-2.0/
 * 08-dev-diagnostics.md). A thrown one may only reach the console when the reactive system halts,
 * so any Solid diagnostic printed during a test fails that test: code that compiles but still
 * behaves like 1.x shows up here.
 */
import { afterEach, beforeEach, vi } from "vitest";

const SOLID_CODE = /\[([A-Z][A-Z_]{5,})\]/;
let reported: string[] = [];

const watch = (level: "warn" | "error") => {
  const original = console[level].bind(console);
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    const code = SOLID_CODE.exec(text)?.[1];
    if (code) reported.push(`${code}: ${text.split("\n")[0]}`);
    original(...args);
  });
};

beforeEach(() => {
  reported = [];
  watch("warn");
  watch("error");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (reported.length > 0)
    throw new Error(`Solid reported a reactivity defect:\n${[...new Set(reported)].join("\n")}`);
});
