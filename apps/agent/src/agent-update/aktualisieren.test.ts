import {
  AGENT_UPDATE_AKTION,
  type AgentUpdateAuftrag,
  schluesselLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import type { Spawn } from "../auftraege/ausfuehren.ts";
import { type AuftragNachricht, auftragPruefen } from "../auftraege/pruefen.ts";
import { TEST_PUB } from "../beitritt/testhilfen.ts";
import { type AgentUpdateDeps, agentAktualisieren } from "./aktualisieren.ts";
import { markeLesen } from "./marke.ts";
import {
  BINARY,
  FREMDE_SIGNATUR,
  MARKE,
  NEUES_X64,
  platte,
  SIGNATUR,
  SUMMEN,
} from "./testhilfen.ts";

/*
 * BAULISTE.md Z-504, the agent's side: it checks the signature over SHA256SUMS with its key (the
 * test key only in test mode), loads its binary from its own Zentrale, checks the checksum and that
 * the new binary names the job's version, keeps the old one and puts the new one in place. A wrong
 * signature, checksum or line replaces nothing.
 */
const SCHLUESSEL = schluesselLesen(TEST_PUB);
if (!SCHLUESSEL) throw new Error("test key");

const nachricht = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht => ({
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "u-1",
  installationId: null,
  aktion: AGENT_UPDATE_AKTION,
  argumente: { version: "0.0.1" },
  manifest: SUMMEN,
  signatur: SIGNATUR,
  zeitlimitS: 600,
  ...teil,
});

describe("checking the job", () => {
  it("takes SHA256SUMS signed with its key and gives the checksums", () => {
    const geprueft = auftragPruefen(nachricht(), { schluessel: SCHLUESSEL, zweck: "test" });
    expect(geprueft).toMatchObject({
      ok: true,
      plan: {
        art: "agent_update",
        auftrag: { version: "0.0.1" },
        zeitlimitMs: 600_000,
        idempotent: false,
      },
    });
  });

  it("refuses a signature of another key", () => {
    expect(
      auftragPruefen(nachricht({ signatur: FREMDE_SIGNATUR }), {
        schluessel: SCHLUESSEL,
        zweck: "test",
      }),
    ).toMatchObject({ ok: false, grund: expect.stringContaining("signature of SHA256SUMS") });
  });

  it("refuses the public test key outside test mode", () => {
    expect(auftragPruefen(nachricht(), { schluessel: SCHLUESSEL, zweck: "release" })).toMatchObject(
      { ok: false, grund: expect.stringContaining("test key") },
    );
  });

  it("refuses an address or any other argument", () => {
    const mitUrl = nachricht({ argumente: { version: "0.0.1", url: "http://boese.test/agent" } });
    expect(auftragPruefen(mitUrl, { schluessel: SCHLUESSEL, zweck: "test" })).toMatchObject({
      ok: false,
    });
  });
});

const auftrag = (): AgentUpdateAuftrag => {
  const g = auftragPruefen(nachricht(), { schluessel: SCHLUESSEL, zweck: "test" });
  if (!g.ok || g.plan.art !== "agent_update") throw new Error("plan");
  return g.plan.auftrag;
};

type Lauf = readonly string[];

const umgebung = (
  o: { geladen?: Uint8Array; status?: number; versionZeile?: string; systemdRun?: number } = {},
) => {
  const p = platte({ [BINARY]: "agent linux-x64 0.0.0\n" });
  const urls: string[] = [];
  const laeufe: Lauf[] = [];
  const spawn: Spawn = async (argv) => {
    laeufe.push(argv);
    return { code: argv[0] === "systemd-run" ? (o.systemdRun ?? 0) : 0 };
  };
  const deps: AgentUpdateDeps = {
    zentrale: "https://agent.example.org",
    architektur: "amd64",
    binary: BINARY,
    marke: MARKE,
    version: "0.0.0",
    protokoll: PROTOKOLL_VERSION,
    holen: async (url) => {
      urls.push(url);
      return new Response((o.geladen ?? NEUES_X64).slice(), { status: o.status ?? 200 });
    },
    dateien: p.dateien,
    binaer: p.binaer,
    lesen: async (argv) => {
      laeufe.push(argv);
      return {
        code: 0,
        aus: `${o.versionZeile ?? `steuerzentrale-agent 0.0.1 (protokoll ${PROTOKOLL_VERSION})`}\n`,
      };
    },
    spawn,
    jetzt: () => 1000,
  };
  return { deps, p, urls, laeufe };
};

describe("agentAktualisieren", () => {
  it("loads its binary from its Zentrale, keeps the old one and puts the new one in place", async () => {
    const u = umgebung();
    expect(await agentAktualisieren(u.deps, "u-1", auftrag())).toEqual({
      ok: true,
      daten: { version: "0.0.1", vorher: "0.0.0" },
    });
    expect(u.urls).toEqual(["https://agent.example.org/agent/steuerzentrale-agent-linux-x64"]);
    expect(u.p.lesen(BINARY)).toBe("agent linux-x64 0.0.1\n");
    expect(u.p.inhalt.get(BINARY)?.modus).toBe(0o755);
    expect(u.p.lesen(`${BINARY}.alt`)).toBe("agent linux-x64 0.0.0\n");
    expect(u.p.inhalt.has(`${BINARY}.neu`)).toBe(false);
    expect(await markeLesen(u.p.dateien, MARKE)).toEqual({
      auftragId: "u-1",
      vorher: "0.0.0",
      neu: "0.0.1",
      am: 1000,
      bestaetigt: false,
    });
    // the new binary ran before it was put in place, and the check runs the old one
    expect(u.laeufe).toContainEqual([`${BINARY}.neu`, "--version"]);
    expect(u.laeufe).toContainEqual([
      "systemd-run",
      "--unit=steuerzentrale-agent-pruefen",
      "--on-active=300",
      "--timer-property=AccuracySec=1s",
      "--timer-property=RemainAfterElapse=no",
      "--collect",
      `${BINARY}.alt`,
      "agent-update-pruefen",
    ]);
  });

  const nichtsGeaendert = (u: ReturnType<typeof umgebung>) => {
    expect(u.p.lesen(BINARY)).toBe("agent linux-x64 0.0.0\n");
    expect(u.p.inhalt.has(`${BINARY}.neu`)).toBe(false);
    expect(u.p.inhalt.has(MARKE)).toBe(false);
    expect(u.laeufe.some((l) => l[0] === "systemd-run")).toBe(false);
  };

  it("refuses a binary whose checksum is not the one of SHA256SUMS", async () => {
    const u = umgebung({ geladen: new TextEncoder().encode("ein anderes Binary\n") });
    expect(await agentAktualisieren(u.deps, "u-1", auftrag())).toEqual({
      ok: false,
      fehler: "abgelehnt: the checksum of steuerzentrale-agent-linux-x64 does not match SHA256SUMS",
    });
    nichtsGeaendert(u);
    expect(u.laeufe).toEqual([]);
  });

  it("refuses SHA256SUMS without a line for its architecture", async () => {
    const u = umgebung();
    const ohne = {
      ...auftrag(),
      pruefsummen: { "steuerzentrale-agent-linux-arm64": "0".repeat(64) },
    };
    expect(await agentAktualisieren(u.deps, "u-1", ohne)).toEqual({
      ok: false,
      fehler: "abgelehnt: SHA256SUMS has no checksum for steuerzentrale-agent-linux-x64",
    });
    expect(u.urls).toEqual([]);
    nichtsGeaendert(u);
  });

  it("never goes back to its own or an older version", async () => {
    for (const version of ["0.0.0", "0.0.0-rc.1"]) {
      const u = umgebung();
      const r = await agentAktualisieren(u.deps, "u-1", { ...auftrag(), version });
      expect(r).toMatchObject({ ok: false, fehler: expect.stringContaining("is not newer") });
      expect(u.urls).toEqual([]);
    }
  });

  it("refuses a binary that names another version or an older protocol", async () => {
    for (const versionZeile of [
      "steuerzentrale-agent 0.0.2 (protokoll 1)",
      `steuerzentrale-agent 0.0.1 (protokoll ${PROTOKOLL_VERSION - 1})`,
      "Segmentation fault",
    ]) {
      const u = umgebung({ versionZeile });
      const r = await agentAktualisieren(u.deps, "u-1", auftrag());
      expect(r, versionZeile).toMatchObject({
        ok: false,
        fehler: expect.stringMatching(/^abgelehnt: /),
      });
      nichtsGeaendert(u);
    }
  });

  it("changes nothing when the Zentrale does not serve the binary", async () => {
    const u = umgebung({ status: 404 });
    expect(await agentAktualisieren(u.deps, "u-1", auftrag())).toEqual({
      ok: false,
      fehler: "Agent-Update gescheitert: steuerzentrale-agent-linux-x64: HTTP 404; nichts geändert",
    });
    nichtsGeaendert(u);
  });

  it("changes nothing when systemd does not plan the check", async () => {
    const u = umgebung({ systemdRun: 1 });
    expect(await agentAktualisieren(u.deps, "u-1", auftrag())).toMatchObject({
      ok: false,
      fehler: expect.stringContaining("nichts geändert"),
    });
    expect(u.p.lesen(BINARY)).toBe("agent linux-x64 0.0.0\n");
    expect(u.p.inhalt.has(`${BINARY}.neu`)).toBe(false);
    expect(u.p.inhalt.has(MARKE)).toBe(false);
  });
});
