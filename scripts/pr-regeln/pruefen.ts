/**
 * Runs the rules of regel.ts on the pull request of the GitHub event (.github/workflows/pr-regeln.yml):
 * title and draft state from the event, commits and files from git between base and head.
 * Errors and warnings go out as workflow annotations; any error fails the run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type Commit,
  checkSignOff,
  checkTicked,
  checkTitle,
  hints,
  itemOf,
  type Report,
} from "./regel.ts";

type Event = {
  pull_request: { title: string; draft: boolean; base: { sha: string }; head: { sha: string } };
};

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const SEP = "\u001e";

export const parseLog = (log: string): Commit[] =>
  log
    .split(SEP)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = "", ...rest] = entry.split("\n");
      return { subject, body: rest.join("\n") };
    });

export function run(event: Event, read: (args: string[]) => string): Report[] {
  const { title, draft, base, head } = event.pull_request;
  const range = `${base.sha}...${head.sha}`;
  const commits = parseLog(read(["log", `--format=%s%n%b${SEP}`, `${base.sha}..${head.sha}`]));
  const files = read(["diff", "--name-only", range]).split("\n").filter(Boolean);
  const bauliste = files.includes("BAULISTE.md") ? read(["diff", range, "--", "BAULISTE.md"]) : "";
  return [
    ...checkTitle(title),
    ...checkSignOff(commits),
    ...checkTicked(itemOf(title), draft, bauliste),
    ...hints(
      files,
      commits.map((commit) => commit.subject),
    ),
  ];
}

if (import.meta.main) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as Event;
  const reports = run(event, (args) => git(...args));
  for (const report of reports) console.log(`::${report.level}::${report.message}`);
  if (reports.length === 0) console.log("Alle Regeln erfüllt.");
  process.exit(reports.some((report) => report.level === "error") ? 1 : 0);
}
