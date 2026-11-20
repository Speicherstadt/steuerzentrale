/**
 * The allowlist of runtime packages (allowed-dependencies.json): every runtime dependency of a
 * workspace needs an entry with a reason that names the workspace. The agent runs as root-adjacent
 * code on every managed server, so each package it pulls in is a decision. A dependency is judged
 * by its name, so its version must be an exact registry version: an alias (`npm:`), a Git, file or
 * URL source could install any package under an allowed name. Source: Speicherstadt/kennwort,
 * scripts/allowed-dependencies.ts, without its rule for packages/crypto.
 */

export type Allowlist = { packages: Record<string, { reason: string; workspaces: string[] }> };
/** A workspace's runtime dependencies, as a map or as entries when several fields name one package */
export type Workspace = { dir: string; dependencies: Record<string, string> | [string, string][] };

const isWorkspacePackage = (version: string) => version.startsWith("workspace:");
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** What is wrong with one dependency of one workspace, or nothing */
const problemOf = (
  allowlist: Allowlist,
  dir: string,
  [name, version]: [string, string],
): string | undefined => {
  if (!EXACT_VERSION.test(version))
    return `${dir}: ${name}@${version} is not an exact registry version`;
  const entry = allowlist.packages[name];
  if (!entry) return `${dir}: ${name} is not in allowed-dependencies.json`;
  if (entry.reason.trim() === "")
    return `${dir}: ${name} has no reason in allowed-dependencies.json`;
  if (!entry.workspaces.includes(dir))
    return `${dir}: ${name} is allowed only in ${entry.workspaces.join(", ")}`;
  return undefined;
};

/** Every runtime dependency that the allowlist does not cover */
export const violations = (allowlist: Allowlist, workspaces: Workspace[]): string[] =>
  workspaces.flatMap(({ dir, dependencies }) =>
    (Array.isArray(dependencies) ? dependencies : Object.entries(dependencies))
      .filter(([, version]) => !isWorkspacePackage(version))
      .map((dependency) => problemOf(allowlist, dir, dependency))
      .filter((problem) => problem !== undefined),
  );

/**
 * `overrides` and `resolutions` of the root package.json swap the package behind a name for every
 * workspace, so each one must be an exact registry version too
 */
export const overrideViolations = (root: Record<string, unknown>): string[] =>
  (["overrides", "resolutions"] as const).flatMap((field) =>
    Object.entries((root[field] ?? {}) as Record<string, unknown>)
      .filter(([, version]) => typeof version !== "string" || !EXACT_VERSION.test(version))
      .map(
        ([name, version]) =>
          `package.json: ${field} ${name}@${JSON.stringify(version)} is not an exact registry version`,
      ),
  );
