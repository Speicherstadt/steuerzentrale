/**
 * Compiles a Bun entry point into one binary per Linux architecture the servers run (docs/plan.md,
 * "Technologie": amd64 and arm64): `bun scripts/compile.ts <entry> <outfile-prefix>` writes
 * `<prefix>-linux-x64` and `<prefix>-linux-arm64`.
 */
export const TARGETS = ["linux-x64", "linux-arm64"] as const;

export const compileArgs = (entry: string, prefix: string, target: string): string[] => [
  "bun",
  "build",
  "--compile",
  "--minify",
  "--sourcemap",
  `--target=bun-${target}`,
  entry,
  "--outfile",
  `${prefix}-${target}`,
];

if (import.meta.main) {
  const [entry, prefix] = process.argv.slice(2);
  if (!entry || !prefix) {
    console.error("usage: bun scripts/compile.ts <entry> <outfile-prefix>");
    process.exit(2);
  }
  for (const target of TARGETS) {
    const run = Bun.spawnSync(compileArgs(entry, prefix, target), {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);
  }
}
