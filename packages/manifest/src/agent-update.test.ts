import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_DATEI,
  AGENT_UPDATE_AKTION,
  type AgentUpdateAnfrage,
  agentUpdateAuftragPruefen,
  pruefsummenLesen,
} from "./agent-update.ts";
import { schluesselLesen } from "./signatur.ts";

/*
 * BAULISTE.md Z-504: the job that updates the agent has a fixed shape, checked by the Zentrale when
 * it makes one and by the agent before it loads anything. SHA256SUMS and its signatures are fixtures
 * (test/SHA256SUMS*): one with the public test key, one with another key made for this test.
 */
const lesen = (datei: string) => readFileSync(join(import.meta.dirname, "../test", datei), "utf8");
const SUMMEN = lesen("SHA256SUMS");
const SIGNATUR = lesen("SHA256SUMS.minisig");
const FREMD = lesen("SHA256SUMS.fremd.minisig");
const SCHLUESSEL = schluesselLesen(lesen("../../../test/schluessel/test.pub"));
if (!SCHLUESSEL) throw new Error("test key");

const anfrage = (teil: Partial<AgentUpdateAnfrage> = {}): AgentUpdateAnfrage => ({
  aktion: AGENT_UPDATE_AKTION,
  installationId: null,
  argumente: { version: "0.0.1" },
  manifest: SUMMEN,
  signatur: SIGNATUR,
  ...teil,
});

describe("pruefsummenLesen", () => {
  it("reads the lines of sha256sum by file name", () => {
    expect(pruefsummenLesen(SUMMEN)).toEqual({
      ok: true,
      summen: {
        [AGENT_DATEI.amd64]: "30c4e71c25b7798ff2b0188453f1db65aa1c58f0bb25f38c9d7c99ca9d2cb7da",
        [AGENT_DATEI.arm64]: "1e123f9bce327cc1410a35a36d99ce28ec63e68623b8eb2a433b8eae1a979626",
      },
    });
  });

  it("refuses a line of another form, a name twice and a list without an agent", () => {
    expect(pruefsummenLesen(`${"a".repeat(64)} ${AGENT_DATEI.amd64}\n`)).toMatchObject({
      ok: false,
    });
    expect(pruefsummenLesen(`${"A".repeat(64)}  ${AGENT_DATEI.amd64}\n`)).toMatchObject({
      ok: false,
    });
    const zweimal = `${"a".repeat(64)}  ${AGENT_DATEI.amd64}\n${"b".repeat(64)}  ${AGENT_DATEI.amd64}\n`;
    expect(pruefsummenLesen(zweimal)).toMatchObject({ ok: false });
    expect(pruefsummenLesen(`${"a".repeat(64)}  install.sh\n`)).toMatchObject({ ok: false });
    expect(pruefsummenLesen("")).toMatchObject({ ok: false });
  });
});

describe("agentUpdateAuftragPruefen", () => {
  it("takes SHA256SUMS signed with the key, a version and no installation", () => {
    expect(agentUpdateAuftragPruefen(anfrage(), SCHLUESSEL)).toEqual({
      ok: true,
      auftrag: {
        art: "agent_update",
        version: "0.0.1",
        pruefsummen: {
          [AGENT_DATEI.amd64]: "30c4e71c25b7798ff2b0188453f1db65aa1c58f0bb25f38c9d7c99ca9d2cb7da",
          [AGENT_DATEI.arm64]: "1e123f9bce327cc1410a35a36d99ce28ec63e68623b8eb2a433b8eae1a979626",
        },
      },
    });
  });

  it("refuses a signature of another key and one that does not fit the text", () => {
    expect(agentUpdateAuftragPruefen(anfrage({ signatur: FREMD }), SCHLUESSEL)).toMatchObject({
      ok: false,
      grund: expect.stringContaining("SHA256SUMS"),
    });
    const anders = SUMMEN.replace("30c4", "40c4");
    expect(agentUpdateAuftragPruefen(anfrage({ manifest: anders }), SCHLUESSEL)).toMatchObject({
      ok: false,
      grund: expect.stringContaining("signature does not match"),
    });
  });

  it("without a key checks only the shape (the Zentrale, which does not sign)", () => {
    expect(agentUpdateAuftragPruefen(anfrage({ signatur: FREMD }))).toMatchObject({ ok: true });
  });

  it("refuses an installation, other arguments, a version of another form and other data", () => {
    const nein = (teil: Partial<AgentUpdateAnfrage>) =>
      expect(agentUpdateAuftragPruefen(anfrage(teil), SCHLUESSEL)).toMatchObject({ ok: false });
    nein({ aktion: "installation_update" });
    nein({ installationId: "probe-k1" });
    nein({ argumente: {} });
    nein({ argumente: { version: "0.0.1", url: "https://example.org/agent" } });
    nein({ argumente: { version: "v0.0.1" } });
    nein({ argumente: { version: "0.0.01" } });
    nein({ argumente: { version: 1 } });
    nein({ einrichtung: {} });
    nein({ backup: {} });
    nein({ manifest: "kein SHA256SUMS" });
  });
});
