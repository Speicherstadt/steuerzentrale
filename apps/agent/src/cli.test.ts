import { TEST_SCHLUESSEL_ID } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "./beitritt/testhilfen.ts";
import { type CliDeps, runCli, USAGE, versionLine } from "./cli.ts";

const deps = (eingabe = ""): CliDeps & { gesendet: unknown[]; gestartet: unknown[] } => {
  const gesendet: unknown[] = [];
  const gestartet: unknown[] = [];
  return {
    dienstStarten: (...args) => gestartet.push(args),
    gestartet,
    dateien: speicher().dateien,
    fetch: async (_url, init) => {
      gesendet.push(JSON.parse(String(init.body)));
      return Response.json({ fehler: "token_ungueltig" }, { status: 401 });
    },
    eingabe: async () => eingabe,
    architektur: "x64",
    fakten: async () => ({ typ: "fakten", zeit: 1 }) as never,
    sichern: {
      uid: () => 0,
      home: () => "/root",
      dateien: speicher().dateien,
      sichern: {
        restic: async () => ({ code: 0, aus: "" }),
        jetzt: () => 1,
        id: () => "l",
        planen: () => () => {},
      },
    },
    archiv: {
      uid: () => 0,
      home: () => "/home/sz-x",
      dateien: speicher().dateien,
      restic: async () => ({ code: 0, aus: "" }),
      jetzt: () => 0,
      ordner: async () => "/tmp",
      groesse: async () => 0,
      hochladen: async () => 200,
      entfernen: async () => {},
    },
    spielen: {
      uid: () => 0,
      eingabe: async () => eingabe,
      restic: async () => ({ code: 0, aus: "" }),
      lesen: async () => ({ code: 0, aus: "" }),
    },
    rueckkehr: {
      dateien: speicher().dateien,
      binaer: {
        lesen: async () => undefined,
        schreiben: async () => {},
        loeschen: async () => {},
      },
      binary: "/usr/local/bin/steuerzentrale-agent",
      marke: "/var/lib/steuerzentrale/agent-update.json",
      spawn: async () => ({ code: 0 }),
      uid: () => 0,
    },
    gesendet,
  };
};

describe("agent command line", () => {
  it("prints version and protocol", async () => {
    expect(versionLine()).toBe(`steuerzentrale-agent ${VERSION} (protokoll ${PROTOKOLL_VERSION})`);
    expect(await runCli(["--version"], deps())).toEqual({ code: 0, out: versionLine() });
  });

  it("refuses anything else with the usage", async () => {
    expect(await runCli(["sh", "-c", "id"], deps())).toEqual({ code: 2, out: USAGE });
    expect((await runCli(["beitreten"], deps())).code).toBe(2);
    expect((await runCli(["beitreten", "--zentrale"], deps())).code).toBe(2);
    expect((await runCli(["beitreten", "--zentrale", "https://a.test", "--x"], deps())).code).toBe(
      2,
    );
    expect((await runCli(["dienst", "--jetzt"], deps())).code).toBe(2);
    expect((await runCli(["fakten", "--shell"], deps())).code).toBe(2);
  });

  it("backs up only as an installation's user, never as root (Z-601)", async () => {
    const ergebnis = await runCli(["sichern", "test-x"], deps());
    expect(ergebnis.code).toBe(1);
    expect(JSON.parse(ergebnis.out)).toEqual({
      msg: "refusing to back up",
      grund: "sichern runs as the installation's user",
    });
    expect((await runCli(["sichern"], deps())).code).toBe(2);
  });

  it("checks an update of the agent without arguments only (Z-504)", async () => {
    expect(JSON.parse((await runCli(["agent-update-pruefen"], deps())).out)).toEqual({
      msg: "no agent update to check",
    });
    expect((await runCli(["agent-update-pruefen", "--jetzt"], deps())).code).toBe(2);
  });

  it("prints the facts it would report (Z-304)", async () => {
    const ergebnis = await runCli(["fakten"], deps());
    expect(ergebnis.code).toBe(0);
    expect(JSON.parse(ergebnis.out)).toEqual({ typ: "fakten", zeit: 1 });
  });

  it("refuses to run as a service on a server that has not joined", async () => {
    const d = deps();
    const ergebnis = await runCli(["dienst"], d);
    expect(ergebnis.code).toBe(1);
    expect(ergebnis.bleiben).toBeUndefined();
    expect(ergebnis.out).toContain("has not joined");
    expect(d.gestartet).toEqual([]);
  });

  it("starts the connection to its Zentrale as a service on a joined server", async () => {
    const pem = (art: string) => `-----BEGIN ${art}-----\nAAAA\n-----END ${art}-----\n`;
    const d = deps();
    d.dateien = speicher({
      "/etc/steuerzentrale/manifest.pub": TEST_PUB,
      "/etc/steuerzentrale/agent.json": JSON.stringify({
        zentrale: "https://agent.example.de",
        serverId: "srv-1",
        testmodus: true,
      }),
      "/var/lib/steuerzentrale/agent.key": pem("PRIVATE KEY"),
      "/var/lib/steuerzentrale/agent.pem": pem("CERTIFICATE"),
      "/var/lib/steuerzentrale/ca.pem": pem("CERTIFICATE"),
    }).dateien;
    const ergebnis = await runCli(["dienst"], d);
    expect(ergebnis).toMatchObject({ code: 0, bleiben: true });
    expect(d.gestartet).toEqual([
      [
        "https://agent.example.de",
        expect.objectContaining({ zertifikat: "/var/lib/steuerzentrale/agent.pem" }),
        "amd64",
        { schluessel: expect.objectContaining({ id: TEST_SCHLUESSEL_ID }), zweck: "test" },
        false,
      ],
    ]);
  });

  it("starts only observing where install.sh left the mode's file (Z-1102)", async () => {
    const pem = (art: string) => `-----BEGIN ${art}-----\nAAAA\n-----END ${art}-----\n`;
    const d = deps();
    d.dateien = speicher({
      "/etc/steuerzentrale/manifest.pub": TEST_PUB,
      "/etc/steuerzentrale/agent.json": JSON.stringify({
        zentrale: "https://agent.example.de",
        serverId: "srv-1",
        testmodus: true,
      }),
      "/etc/steuerzentrale/nur-beobachten": "nur-beobachten\n",
      "/var/lib/steuerzentrale/agent.key": pem("PRIVATE KEY"),
      "/var/lib/steuerzentrale/agent.pem": pem("CERTIFICATE"),
      "/var/lib/steuerzentrale/ca.pem": pem("CERTIFICATE"),
    }).dateien;
    const ergebnis = await runCli(["dienst"], d);
    expect(JSON.parse(ergebnis.out)).toMatchObject({ msg: "ready", nurBeobachten: true });
    expect(d.gestartet[0]).toEqual([
      expect.any(String),
      expect.anything(),
      "amd64",
      expect.anything(),
      true,
    ]);
  });

  it("reads the token from standard input, never from an argument", async () => {
    const d = deps(" token-aus-der-eingabe-1234567890 \n");
    d.dateien = speicher({ "/etc/steuerzentrale/manifest.pub": TEST_PUB }).dateien;
    const ergebnis = await runCli(
      ["beitreten", "--zentrale", "https://agent.example.de", "--testmodus"],
      d,
    );
    expect(ergebnis.code).toBe(1);
    expect(d.gesendet).toEqual([
      expect.objectContaining({ token: "token-aus-der-eingabe-1234567890" }),
    ]);
  });
});
