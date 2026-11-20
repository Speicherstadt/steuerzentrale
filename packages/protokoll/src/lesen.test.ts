import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1, VON_DER_ZENTRALE_V1 } from "./beispiele-v1.ts";
import {
  AELTESTE_VERSION,
  MAX_NACHRICHT_BYTES,
  PROTOKOLL_VERSION,
  schreiben,
  vomAgentenLesen,
  vonDerZentraleLesen,
} from "./lesen.ts";
import { VomAgenten, VonDerZentrale } from "./nachrichten.ts";

/** The frozen messages of every version, by version; a new version adds its own */
const BEISPIELE: Record<
  number,
  {
    vomAgenten: readonly Record<string, unknown>[];
    vonDerZentrale: readonly Record<string, unknown>[];
  }
> = {
  1: { vomAgenten: VOM_AGENTEN_V1, vonDerZentrale: VON_DER_ZENTRALE_V1 },
};

const TYPEN_VOM_AGENTEN = [
  "hallo",
  "heartbeat",
  "fakten",
  "zustand",
  "bestaetigt",
  "fortschritt",
  "ergebnis",
  "log_auszug",
  "ssh_anmeldung",
];

describe("every message", () => {
  it("has a frozen example for the current version", () => {
    const beispiele = BEISPIELE[PROTOKOLL_VERSION];
    expect(beispiele, `add beispiele-v${PROTOKOLL_VERSION}.ts`).toBeDefined();
    expect(new Set(beispiele?.vomAgenten.map((n) => n.typ))).toEqual(new Set(TYPEN_VOM_AGENTEN));
    expect(new Set(beispiele?.vonDerZentrale.map((n) => n.typ))).toEqual(
      new Set(["willkommen", "auftrag"]),
    );
  });

  it.each(VOM_AGENTEN_V1.map((n) => [n.typ, n]))(
    "from the agent goes there and back: %s",
    (_typ, nachricht) => {
      const text = schreiben(VomAgenten, nachricht as never);
      expect(vomAgentenLesen(text)).toEqual({ ok: true, nachricht });
    },
  );

  it.each(VON_DER_ZENTRALE_V1.map((n) => [n.typ, n]))(
    "from the Zentrale goes there and back: %s",
    (_typ, nachricht) => {
      const text = schreiben(VonDerZentrale, nachricht as never);
      expect(vonDerZentraleLesen(text)).toEqual({ ok: true, nachricht });
    },
  );
});

describe("versions", () => {
  it("the Zentrale understands every example of an agent one version behind", () => {
    expect(AELTESTE_VERSION).toBe(Math.max(1, PROTOKOLL_VERSION - 1));
    for (let version = AELTESTE_VERSION; version <= PROTOKOLL_VERSION; version++) {
      const beispiele = BEISPIELE[version];
      expect(beispiele, `frozen examples of protocol ${version}`).toBeDefined();
      for (const nachricht of beispiele?.vomAgenten ?? [])
        expect(
          vomAgentenLesen(JSON.stringify(nachricht)),
          `${version} ${nachricht.typ}`,
        ).toMatchObject({ ok: true });
    }
  });

  it("upgrades a message of the version before through its upgrade", () => {
    const optionen = {
      version: 2,
      aelteste: 1,
      aufwertungen: { 1: (alt: Record<string, unknown>) => ({ ...alt, zeit: alt.zeit ?? 0 }) },
    };
    expect(vomAgentenLesen(JSON.stringify({ typ: "heartbeat", protokoll: 1 }), optionen)).toEqual({
      ok: true,
      nachricht: { typ: "heartbeat", protokoll: 2, zeit: 0 },
    });
    expect(
      vomAgentenLesen(JSON.stringify({ typ: "heartbeat", protokoll: 1, zeit: 5 }), {
        ...optionen,
        aufwertungen: {},
      }),
    ).toEqual({
      ok: false,
      grund: "no upgrade from protokoll 1",
    });
  });

  it("refuses a newer or a too old version and a message without one", () => {
    expect(
      vomAgentenLesen(
        JSON.stringify({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION + 1, zeit: 1 }),
      ),
    ).toMatchObject({ ok: false, grund: expect.stringContaining("newer") });
    expect(
      vomAgentenLesen(JSON.stringify({ typ: "heartbeat", protokoll: 0, zeit: 1 })),
    ).toMatchObject({ ok: false, grund: expect.stringContaining("older") });
    expect(vomAgentenLesen(JSON.stringify({ typ: "heartbeat", zeit: 1 }))).toEqual({
      ok: false,
      grund: "protokoll: missing",
    });
  });
});

describe("invalid messages", () => {
  it("are refused with field and reason", () => {
    expect(vomAgentenLesen("kein json")).toEqual({ ok: false, grund: "no JSON" });
    expect(vomAgentenLesen("[1]")).toEqual({ ok: false, grund: "no JSON object" });
    expect(vomAgentenLesen(JSON.stringify({ typ: "befehl", protokoll: 1 }))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^typ: /),
    });
    const zuLang = {
      typ: "log_auszug",
      protokoll: 1,
      auftragId: "a",
      zeilen: Array.from({ length: 501 }, () => "x"),
    };
    expect(vomAgentenLesen(JSON.stringify(zuLang))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^zeilen: /),
    });
  });

  it("a job carries an action name, never a command line", () => {
    const auftrag = { ...VON_DER_ZENTRALE_V1[1], aktion: "sh -c 'rm -rf /'" };
    expect(vonDerZentraleLesen(JSON.stringify(auftrag))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^aktion: /),
    });
  });

  it("the agent reads no message of an older Zentrale protocol than its own", () => {
    expect(
      vonDerZentraleLesen(JSON.stringify({ typ: "willkommen", protokoll: 0, zeit: 1 })).ok,
    ).toBe(false);
  });

  it("schreiben refuses to send what the schema does not allow", () => {
    expect(() => schreiben(VomAgenten, { typ: "heartbeat", protokoll: 1 } as never)).toThrow();
  });
});

describe("size", () => {
  it("a message larger than MAX_NACHRICHT_BYTES is neither read nor sent", () => {
    const riesig = {
      typ: "log_auszug",
      protokoll: 1,
      auftragId: "a",
      zeilen: ["x".repeat(MAX_NACHRICHT_BYTES)],
    };
    expect(vomAgentenLesen(JSON.stringify(riesig))).toMatchObject({
      ok: false,
      grund: expect.stringContaining("larger than"),
    });
    expect(() => schreiben(VomAgenten, riesig as never)).toThrow(/larger than/);
    const auftrag = { ...VON_DER_ZENTRALE_V1[1], manifest: "x".repeat(MAX_NACHRICHT_BYTES) };
    expect(vonDerZentraleLesen(JSON.stringify(auftrag)).ok).toBe(false);
  });
});

describe("state of the installations", () => {
  // `systemctl --state=help` (systemd 255, Ubuntu 24.04) lists these active states; systemd 257
  // (Debian 13) adds "refreshing". One unit in any of them must not make the whole message invalid.
  it.each([
    "active",
    "reloading",
    "inactive",
    "failed",
    "activating",
    "deactivating",
    "maintenance",
    "refreshing",
  ])("reads a unit in the systemd state %s", (aktiv) => {
    const zustand = {
      typ: "zustand",
      protokoll: 1,
      zeit: 1,
      installationen: [
        {
          installationId: "i",
          units: [{ name: "i-app.service", aktiv }],
          health: { zustand: "gruen", grund: "" },
        },
      ],
    };
    expect(vomAgentenLesen(JSON.stringify(zustand))).toMatchObject({ ok: true });
  });
});
