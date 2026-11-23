/**
 * Compiles a Bun entry point into one binary per Linux architecture the servers run (docs/plan.md,
 * "Technologie": amd64 and arm64): `bun scripts/compile.ts <entry> <outfile-prefix>` writes
 * `<prefix>-linux-x64` and `<prefix>-linux-arm64`. With STEUERZENTRALE_BAU_VERSION set the binaries
 * name that version instead of package.json's (packages/protokoll, `VERSION`): only CI uses it, to
 * build a newer agent its test servers update to (BAULISTE.md Z-504); a release never sets it.
 */
export const TARGETS = ["linux-x64", "linux-arm64"] as const;

// SemVer 2.0.0 without build metadata, as packages/manifest AGENT_VERSION
const VERSION_FORM = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

/** The version a build names instead of package.json's, if one is set; a wrong one is refused */
export const bauVersion = (env: Record<string, string | undefined>): string | undefined => {
  const version = env.STEUERZENTRALE_BAU_VERSION;
  if (version === undefined || version === "") return undefined;
  if (!VERSION_FORM.test(version))
    throw new Error("STEUERZENTRALE_BAU_VERSION: a version as major.minor.patch");
  return version;
};

export const compileArgs = (
  entry: string,
  prefix: string,
  target: string,
  version?: string,
): string[] => [
  "bun",
  "build",
  "--compile",
  "--minify",
  "--sourcemap",
  `--target=bun-${target}`,
  ...(version === undefined
    ? []
    : ["--define", `STEUERZENTRALE_BAU_VERSION=${JSON.stringify(version)}`]),
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
  const version = bauVersion(process.env);
  for (const target of TARGETS) {
    const run = Bun.spawnSync(compileArgs(entry, prefix, target, version), {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);
  }
}
