import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auslieferung, skriptAusfuellen } from "../modules/server/auslieferung.ts";
import { TEST_AGENT_URL, testServer } from "../testhilfen/server.ts";

// BAULISTE.md Z-302: agent.<domain> serves install.sh, the agent binaries and SHA256SUMS with its signature
const TEST_PUB = "RWRIyXK5ooYVPbx8wak0UtxTTy6wWLdKm1lGfSg8ZJudL8LJxj7pxXFU";

describe("agent.<domain>", () => {
  it("serves install.sh with its own address and the signing key filled in", async () => {
    const server = testServer();
    const antwort = await server.browser().anfrage("/install.sh");
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/x-shellscript");
    const skript = await antwort.text();
    expect(skript).toContain(`ZENTRALE='${TEST_AGENT_URL}'`);
    expect(skript).toContain(`SCHLUESSEL='${TEST_PUB}'`);
    expect(skript).not.toContain("@ZENTRALE@");
    expect(skript).not.toContain("@SCHLUESSEL@");
  });

  it("serves the binaries and the signed checksums, nothing else", async () => {
    const server = testServer();
    const b = server.browser();
    const binary = await b.anfrage("/agent/steuerzentrale-agent-linux-arm64");
    expect(binary.status).toBe(200);
    expect(binary.headers.get("content-type")).toBe("application/octet-stream");
    expect(await binary.text()).toBe("agent arm64\n");
    for (const datei of ["SHA256SUMS", "SHA256SUMS.minisig"])
      expect((await b.anfrage(`/agent/${datei}`)).status, datei).toBe(200);
    for (const pfad of ["/agent/install.sh", "/agent/minisign.pub", "/agent/..%2Fminisign.pub"])
      expect((await b.anfrage(pfad)).status, pfad).toBe(404);
  });

  it("serves no script without the agent's files or with a key that is none", async () => {
    const ohne = auslieferung(undefined, TEST_AGENT_URL);
    expect(await ohne.skript()).toBeUndefined();
    expect(ohne.datei("SHA256SUMS")).toBeUndefined();
    const server = testServer();
    writeFileSync(join(server.agentDateien, "minisign.pub"), "kein schluessel\n");
    expect((await server.browser().json("/install.sh")).daten).toEqual({
      fehler: "agent_dateien_fehlen",
    });
  });

  it("fills in only values that cannot leave the script's quotes", () => {
    const vorlage = "ZENTRALE='@ZENTRALE@'\nSCHLUESSEL='@SCHLUESSEL@'\n";
    expect(skriptAusfuellen(vorlage, { zentrale: TEST_AGENT_URL, schluessel: TEST_PUB })).toBe(
      `ZENTRALE='${TEST_AGENT_URL}'\nSCHLUESSEL='${TEST_PUB}'\n`,
    );
    for (const zentrale of ["https://a.test'; rm -rf /; '", "https://a.test/pfad", "ftp://a.test"])
      expect(
        skriptAusfuellen(vorlage, { zentrale, schluessel: TEST_PUB }),
        zentrale,
      ).toBeUndefined();
    expect(
      skriptAusfuellen(vorlage, { zentrale: TEST_AGENT_URL, schluessel: `${TEST_PUB}'` }),
    ).toBeUndefined();
    expect(
      skriptAusfuellen("echo", { zentrale: TEST_AGENT_URL, schluessel: TEST_PUB }),
    ).toBeUndefined();
  });

  it("serves the script of the repository", async () => {
    const server = testServer();
    const vorlage = readFileSync(
      join(import.meta.dirname, "../../../../install/install.sh"),
      "utf8",
    );
    const skript = await (await server.browser().anfrage("/install.sh")).text();
    expect(skript.split("\n").length).toBe(vorlage.split("\n").length);
  });
});
