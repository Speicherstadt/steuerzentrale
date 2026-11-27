/*
 * Rules for pull requests from docs/mitwirken.md and BAULISTE.md that only this project has and
 * that can be checked on the pull request itself. Title, issue references, code without docs and a
 * fix without a test are checked by the Werkbank (Speicherstadt/werkbank, werkzeug/pr-regeln),
 * called from the same workflow. Errors stop the pull request; hints appear as warnings only.
 */

export type Report = { level: "error" | "warning"; message: string };

/** A Bauliste item: "Z-205: Quadlets rendern" */
const ITEM = /^(Z-\d{3,4}): \S.*$/;

/** The Bauliste item a title names, or undefined */
export const itemOf = (title: string): string | undefined => title.trim().match(ITEM)?.[1];

export type Commit = { subject: string; body: string };

/** Every commit carries a Signed-off-by line (Developer Certificate of Origin, no CLA) */
export function checkSignOff(commits: Commit[]): Report[] {
  return commits
    .filter((commit) => !/^Signed-off-by: .+ <.+>$/m.test(commit.body))
    .map((commit) => ({
      level: "error",
      message: `Commit „${commit.subject}“ hat kein „Signed-off-by:“ (DCO): mit \`git commit -s\` committen, nachträglich mit \`git rebase --signoff origin/main\`.`,
    }));
}

/**
 * A pull request for a Bauliste item ticks it in the same pull request (BAULISTE.md, loop step 6).
 * A draft only reserves the item, so the hint waits until the pull request is ready.
 */
export function checkTicked(
  item: string | undefined,
  draft: boolean,
  baulisteDiff: string,
): Report[] {
  if (!item || draft) return [];
  const ticked = baulisteDiff.split("\n").some((line) => line.startsWith(`+- [x] **${item} `));
  return ticked
    ? []
    : [
        {
          level: "error",
          message: `${item} ist in BAULISTE.md nicht abgehakt; das gehört in denselben Pull Request.`,
        },
      ];
}

/** A change to the manifest schema comes with its docs (AGENTS.md, „Bei jeder Änderung“) */
export function hints(files: string[]): Report[] {
  if (
    files.some((file) => file.startsWith("packages/manifest/src/")) &&
    !files.includes("docs/manifest.md")
  )
    return [
      {
        level: "warning",
        message:
          "packages/manifest geändert, docs/manifest.md nicht: Ändert sich das Schema, gehört die Doku dazu (AGENTS.md).",
      },
    ];
  return [];
}
