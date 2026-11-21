import type { Dateien } from "../dateien.ts";

/*
 * SSH logins as events (docs/plan.md, "Notzugang"): the agent follows the journal of the SSH
 * service and reports every accepted login. It reads with a fixed argv; the only variable part is
 * journald's own cursor, saved after every line, so a login while the agent was away is reported
 * when it is back. OpenSSH logs "Accepted <method> for <user> from <address> port <port>" (auth.c,
 * auth_log), since 9.8 from sshd-session, always under the unit ssh.service (Debian, Ubuntu) or
 * sshd.service (other distributions).
 */

export type Anmeldung = { zeit: number; nutzer: string; von: string; methode: string };

/** A long-running command's output line by line, and how to end it */
export type Folgen = (argv: readonly string[]) => {
  zeilen: AsyncIterable<string>;
  stoppen: () => void;
};

// journald's cursors are fields joined by ';' (sd_journal_get_cursor(3)); nothing else is passed on
const CURSOR = /^[A-Za-z0-9]+=[0-9a-fA-F]+(;[A-Za-z0-9]+=[0-9a-fA-F]+)*$/;

const ANGENOMMEN = /^Accepted (\S+) for (\S+) from (\S+) port \d+/;

export const journalArgv = (cursor: string | undefined): string[] => [
  "journalctl",
  "--unit=ssh.service",
  "--unit=sshd.service",
  "--output=json",
  "--follow",
  cursor !== undefined && CURSOR.test(cursor) ? `--after-cursor=${cursor}` : "--lines=0",
];

/** journald writes a field that is not valid UTF-8 as an array of bytes (journalctl(1), json) */
const text = (wert: unknown): string | undefined => {
  if (typeof wert === "string") return wert;
  if (Array.isArray(wert) && wert.every((b) => typeof b === "number"))
    return Buffer.from(wert).toString("utf8");
  return undefined;
};

const objekt = (zeile: string): Record<string, unknown> | undefined => {
  try {
    const wert: unknown = JSON.parse(zeile);
    return typeof wert === "object" && wert !== null
      ? (wert as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** The cursor of a journal line and, for an accepted login, the login */
export const anmeldungAus = (
  zeile: string,
): { cursor: string; anmeldung?: Anmeldung } | undefined => {
  const eintrag = objekt(zeile);
  const cursor = text(eintrag?.__CURSOR);
  if (!eintrag || !cursor) return undefined;
  const treffer = ANGENOMMEN.exec(text(eintrag.MESSAGE) ?? "");
  const mikro = Number(text(eintrag.__REALTIME_TIMESTAMP));
  if (!treffer || !Number.isFinite(mikro)) return { cursor };
  const [, methode = "", nutzer = "", von = ""] = treffer;
  return { cursor, anmeldung: { zeit: Math.floor(mikro / 1000), nutzer, von, methode } };
};

export type FolgenDeps = {
  folgen: Folgen;
  dateien: Dateien;
  cursorPfad: string;
  melden: (anmeldung: Anmeldung) => void;
};

/** Follows the journal until stopped; `fertig` settles when the journal's output ends */
export const anmeldungenFolgen = (
  deps: FolgenDeps,
): { stoppen: () => void; fertig: Promise<void> } => {
  let gestoppt = false;
  let beenden = () => {};
  const lauf = async () => {
    const cursor = (await deps.dateien.lesen(deps.cursorPfad))?.trim();
    if (gestoppt) return;
    const journal = deps.folgen(journalArgv(cursor));
    beenden = journal.stoppen;
    let gemerkt = cursor !== undefined;
    for await (const zeile of journal.zeilen) {
      if (gestoppt) break;
      const gelesen = anmeldungAus(zeile);
      if (!gelesen) continue;
      if (gelesen.anmeldung) deps.melden(gelesen.anmeldung);
      // bots fill the journal with failed attempts: the cursor is kept after each login and once
      // at the start, and after a restart the lines since then are only read again
      if (gelesen.anmeldung || !gemerkt)
        await deps.dateien.schreiben(deps.cursorPfad, `${gelesen.cursor}\n`, 0o600);
      gemerkt = true;
    }
  };
  return {
    stoppen: () => {
      gestoppt = true;
      beenden();
    },
    fertig: lauf(),
  };
};
