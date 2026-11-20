import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { anmeldungAus, anmeldungenFolgen, type Folgen, journalArgv } from "./anmeldungen.ts";

// Lines of `journalctl -o json` (systemd.journal-fields(7)): OpenSSH 9.8 and newer log the login
// from sshd-session (Debian 13), older ones from sshd (Ubuntu 24.04); both under ssh.service
const zeile = (felder: Record<string, unknown>) =>
  JSON.stringify({
    __CURSOR: "s=7d1c;i=4b2;b=9f3e;m=1a2b;t=6441f;x=5e6d",
    __REALTIME_TIMESTAMP: "1795000000123456",
    __MONOTONIC_TIMESTAMP: "4711000",
    _BOOT_ID: "9f3e",
    PRIORITY: "6",
    SYSLOG_FACILITY: "4",
    _SYSTEMD_UNIT: "ssh.service",
    _HOSTNAME: "server-a",
    ...felder,
  });
const DEBIAN = zeile({
  SYSLOG_IDENTIFIER: "sshd-session",
  _COMM: "sshd-session",
  MESSAGE:
    "Accepted publickey for tristan from 10.8.0.2 port 52344 ssh2: ED25519 SHA256:Zm9vYmFyYmF6",
});
const UBUNTU = zeile({
  __CURSOR: "s=7d1c;i=4b3",
  SYSLOG_IDENTIFIER: "sshd",
  MESSAGE: "Accepted password for root from 2001:db8::2 port 40022 ssh2",
});
const ANDERE = zeile({
  __CURSOR: "s=7d1c;i=4b4",
  SYSLOG_IDENTIFIER: "sshd-session",
  MESSAGE: "pam_unix(sshd:session): session opened for user tristan(uid=1000) by tristan(uid=0)",
});

describe("a journal line", () => {
  it("is a login with user, address, method and time, and its cursor", () => {
    expect(anmeldungAus(DEBIAN)).toEqual({
      cursor: "s=7d1c;i=4b2;b=9f3e;m=1a2b;t=6441f;x=5e6d",
      anmeldung: {
        zeit: 1_795_000_000_123,
        nutzer: "tristan",
        von: "10.8.0.2",
        methode: "publickey",
      },
    });
    expect(anmeldungAus(UBUNTU)?.anmeldung).toEqual({
      zeit: 1_795_000_000_123,
      nutzer: "root",
      von: "2001:db8::2",
      methode: "password",
    });
  });

  it("of another kind carries only its cursor", () => {
    expect(anmeldungAus(ANDERE)).toEqual({ cursor: "s=7d1c;i=4b4" });
  });

  it("reads a message journald wrote as bytes, as it does for text that is not UTF-8", () => {
    const bytes = [
      ...Buffer.from("Accepted keyboard-interactive/pam for anna from 10.8.0.3 port 1 ssh2"),
    ];
    expect(anmeldungAus(zeile({ MESSAGE: bytes }))?.anmeldung).toMatchObject({
      nutzer: "anna",
      methode: "keyboard-interactive/pam",
    });
  });

  it("that is no JSON or has no cursor is nothing", () => {
    expect(anmeldungAus("-- No entries --")).toBeUndefined();
    expect(
      anmeldungAus(JSON.stringify({ MESSAGE: "Accepted publickey for a from b port 1" })),
    ).toBeUndefined();
  });
});

describe("the journal command", () => {
  it("is a fixed argv: new entries only, or after the saved cursor", () => {
    expect(journalArgv(undefined)).toEqual([
      "journalctl",
      "--unit=ssh.service",
      "--unit=sshd.service",
      "--output=json",
      "--follow",
      "--lines=0",
    ]);
    expect(journalArgv("s=7d1c;i=4b2")).toEqual([
      "journalctl",
      "--unit=ssh.service",
      "--unit=sshd.service",
      "--output=json",
      "--follow",
      "--after-cursor=s=7d1c;i=4b2",
    ]);
  });

  it("never takes a cursor that is not journald's", () => {
    expect(journalArgv("x --since=1970 -o cat")).toContain("--lines=0");
  });
});

/** A journal that hands out the given lines and ends, as journalctl does when it is stopped */
const journal = (zeilen: string[]) => {
  const aufrufe: string[][] = [];
  let gestoppt = 0;
  const folgen: Folgen = (argv) => {
    aufrufe.push([...argv]);
    return {
      zeilen: (async function* () {
        yield* zeilen;
      })(),
      stoppen: () => {
        gestoppt += 1;
      },
    };
  };
  return { folgen, aufrufe, gestoppt: () => gestoppt };
};

describe("following the logins", () => {
  it("reports each login and keeps the cursor of every line read", async () => {
    const j = journal([DEBIAN, ANDERE, UBUNTU]);
    const fs = speicher();
    const gemeldet: unknown[] = [];
    const lauf = anmeldungenFolgen({
      folgen: j.folgen,
      dateien: fs.dateien,
      cursorPfad: "/z/ssh-cursor",
      melden: (a) => gemeldet.push(a),
    });
    await lauf.fertig;
    expect(gemeldet).toEqual([
      expect.objectContaining({ nutzer: "tristan" }),
      expect.objectContaining({ nutzer: "root" }),
    ]);
    expect(fs.inhalt.get("/z/ssh-cursor")).toEqual({ text: "s=7d1c;i=4b3\n", modus: 0o600 });
    lauf.stoppen();
    expect(j.gestoppt()).toBe(1);
  });

  it("starts after the saved cursor, so a login while the agent was away is not lost", async () => {
    const j = journal([]);
    const fs = speicher({ "/z/ssh-cursor": "s=7d1c;i=4b2\n" });
    const lauf = anmeldungenFolgen({
      folgen: j.folgen,
      dateien: fs.dateien,
      cursorPfad: "/z/ssh-cursor",
      melden: () => {},
    });
    await lauf.fertig;
    expect(j.aufrufe[0]).toContain("--after-cursor=s=7d1c;i=4b2");
  });

  it("reports nothing more once stopped", async () => {
    const j = journal([DEBIAN]);
    const gemeldet: unknown[] = [];
    const lauf = anmeldungenFolgen({
      folgen: j.folgen,
      dateien: speicher().dateien,
      cursorPfad: "/z/ssh-cursor",
      melden: (a) => gemeldet.push(a),
    });
    lauf.stoppen();
    await lauf.fertig;
    expect(gemeldet).toEqual([]);
  });
});
