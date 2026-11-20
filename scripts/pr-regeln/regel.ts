/*
 * Rules for pull requests from CLAUDE.md and BAULISTE.md that can be checked on the pull request
 * itself. Errors stop the pull request; hints appear as warnings only. Modelled on
 * Speicherstadt/haben, scripts/pr-regeln/regel.ts.
 */

export type Report = { level: "error" | "warning"; message: string };

const CONVENTIONAL = /^(feat|fix|docs|test|refactor|chore|style|perf|build|ci|revert)(\(.*\))?!?:/;
/** A Bauliste item: "Z-205: Quadlets rendern" */
const ITEM = /^(Z-\d{3,4}): \S.*$/;
/** Anything else: "Bereich: was sich ändert", one to three words before the colon */
const AREA = /^\p{L}[\p{L}\d-]*(?: [\p{L}\d-]+){0,2}: \S.*$/u;

/** The squash merge turns the title into the commit on main */
export function checkTitle(title: string): Report[] {
  const trimmed = title.trim();
  const example = "„Z-205: Quadlets rendern“ oder „Doku: Manifest-Felder erklärt“";
  if (CONVENTIONAL.test(trimmed))
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“: Conventional Commits gelten für Commits im Pull Request, der Titel heißt ${example}.`,
      },
    ];
  if (!ITEM.test(trimmed) && !AREA.test(trimmed))
    return [
      {
        level: "error",
        message: `Titel „${trimmed}“ folgt nicht „Z-xxx: was gebaut wird“ oder „Bereich: was sich ändert“, etwa ${example}.`,
      },
    ];
  if (trimmed.endsWith("."))
    return [{ level: "error", message: `Titel „${trimmed}“ endet ohne Punkt.` }];
  return [];
}

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

const isTest = (file: string) => /\.(test|spec)\.tsx?$/.test(file) || file.startsWith("e2e/");
const isCode = (file: string) =>
  /^(apps|packages)\/[^/]+\/src\/.*\.tsx?$/.test(file) && !isTest(file);
const isFix = (subject: string) => /^fix(\(.*\))?!?:/.test(subject);

/** Rules that cannot be decided for sure: code without docs, a fix without a test */
export function hints(files: string[], commitSubjects: string[]): Report[] {
  const reports: Report[] = [];
  if (files.some(isCode) && !files.some((file) => file.startsWith("docs/")))
    reports.push({
      level: "warning",
      message:
        "Code geändert, aber nichts in docs/: Beschreibt eine Doku-Seite das geänderte Verhalten?",
    });
  if (commitSubjects.some(isFix) && !files.some(isTest))
    reports.push({
      level: "warning",
      message:
        "fix-Commit ohne geänderten Test: Ein Bugfix beginnt mit einem Test, der fehlschlägt (CLAUDE.md).",
    });
  if (
    files.some((file) => file.startsWith("packages/manifest/src/")) &&
    !files.includes("docs/manifest.md")
  )
    reports.push({
      level: "warning",
      message:
        "packages/manifest geändert, docs/manifest.md nicht: Ändert sich das Schema, gehört die Doku dazu (CLAUDE.md).",
    });
  return reports;
}
