import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "./beitritt/testhilfen.ts";
import { type CliDeps, runCli, USAGE, versionLine } from "./cli.ts";

const deps = (eingabe = ""): CliDeps & { gesendet: unknown[] } => {
  const gesendet: unknown[] = [];
  return {
    dateien: speicher().dateien,
    fetch: async (_url, init) => {
      gesendet.push(JSON.parse(String(init.body)));
      return Response.json({ fehler: "token_ungueltig" }, { status: 401 });
    },
    eingabe: async () => eingabe,
    architektur: "x64",
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
  });

  it("refuses to run as a service on a server that has not joined", async () => {
    const ergebnis = await runCli(["dienst"], deps());
    expect(ergebnis.code).toBe(1);
    expect(ergebnis.bleiben).toBeUndefined();
    expect(ergebnis.out).toContain("has not joined");
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
