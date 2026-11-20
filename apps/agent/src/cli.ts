import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";

/** What `steuerzentrale-agent --version` prints: its version and the protocol it speaks */
export const versionLine = (): string =>
  `steuerzentrale-agent ${VERSION} (protokoll ${PROTOKOLL_VERSION})`;

export type CliResult = { code: number; out: string };

/** Runs the command line; Z-302 onwards adds connecting to the Zentrale */
export const runCli = (args: string[]): CliResult => {
  if (args.includes("--version")) return { code: 0, out: versionLine() };
  return { code: 2, out: "usage: steuerzentrale-agent --version" };
};
