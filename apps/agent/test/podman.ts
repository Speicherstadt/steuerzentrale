/**
 * The agent tests need Podman with systemd (docs/plan.md, "Tests"). In CI a missing Podman fails
 * the run instead of skipping it; elsewhere the tests are skipped and say so.
 */
export const podmanVersion = (): string | null => {
  try {
    const run = Bun.spawnSync(["podman", "version", "--format", "{{.Client.Version}}"]);
    return run.exitCode === 0 ? run.stdout.toString().trim() : null;
  } catch {
    return null;
  }
};

/** Whether `version` is at least `minimum`, both as major.minor[.patch] */
export const atLeast = (version: string, minimum: string): boolean => {
  const parts = (text: string) =>
    text
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

export const requirePodman = (ci: boolean): string | null => {
  const version = podmanVersion();
  if (version === null && ci)
    throw new Error("Podman is missing: CI must run the agent tests against Podman");
  if (version === null) console.warn("Podman is missing: agent tests skipped (they run in CI)");
  return version;
};
