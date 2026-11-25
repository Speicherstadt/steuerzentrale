import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1, VON_DER_ZENTRALE_V1 } from "./beispiele-v1.ts";
import {
  AELTESTE_VERSION,
  fuerVersion,
  MAX_NACHRICHT_BYTES,
  PROTOKOLL_VERSION,
  schreiben,
  vomAgentenLesen,
  vonDerZentraleLesen,
} from "./lesen.ts";
import { TRENNUNG, VomAgenten, VonDerZentrale } from "./nachrichten.ts";

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
  "zertifikat_anfrage",
  "backup_stand",
];

describe("every message", () => {
  it("has a frozen example for the current version", () => {
    const beispiele = BEISPIELE[PROTOKOLL_VERSION];
    expect(beispiele, `add beispiele-v${PROTOKOLL_VERSION}.ts`).toBeDefined();
    expect(new Set(beispiele?.vomAgenten.map((n) => n.typ))).toEqual(new Set(TYPEN_VOM_AGENTEN));
    expect(new Set(beispiele?.vonDerZentrale.map((n) => n.typ))).toEqual(
      new Set(["willkommen", "auftrag", "zertifikat", "beobachten"]),
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

  it("the Zentrale writes to an agent one version behind in the agent's version", () => {
    // as a Zentrale of protocol 2 would, with a field that is new in 2 (Z-504)
    const neu = JSON.stringify({ typ: "willkommen", protokoll: 2, zeit: 1, neuIn2: true });
    const fuerAlt = JSON.parse(fuerVersion(neu, 1, 2));
    expect(fuerAlt).toEqual({ typ: "willkommen", protokoll: 1, zeit: 1, neuIn2: true });
    // the older schema drops what it does not know
    expect(VonDerZentrale.parse(fuerAlt)).toEqual({ typ: "willkommen", protokoll: 1, zeit: 1 });
    expect(fuerVersion(neu, 2, 2)).toBe(neu);
    const jetzt = schreiben(VonDerZentrale, {
      typ: "willkommen",
      protokoll: PROTOKOLL_VERSION,
      zeit: 1,
    });
    expect(fuerVersion(jetzt, PROTOKOLL_VERSION)).toBe(jetzt);
  });

  it("every agent of protocol 1 reads the update of the agent (Z-504)", () => {
    const update = VON_DER_ZENTRALE_V1.find((n) => n.aktion === "agent_update");
    expect(update, "frozen agent_update").toBeDefined();
    expect(vonDerZentraleLesen(JSON.stringify(update))).toMatchObject({ ok: true });
  });

  it("every agent of protocol 1 reads the reboot of its server (Z-701)", () => {
    const neustart = VON_DER_ZENTRALE_V1.find((n) => n.aktion === "server_neustart");
    expect(neustart, "frozen server_neustart").toBeDefined();
    expect(vonDerZentraleLesen(JSON.stringify(neustart))).toMatchObject({ ok: true });
  });

  it("reads facts of an agent before Z-701 with its new facts unknown", () => {
    const fakten = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") ?? {};
    const { bootId: _b, gestartetAm: _g, unattendedUpgrades: _u, ...vorher } = fakten;
    expect(vomAgentenLesen(JSON.stringify(vorher))).toEqual({
      ok: true,
      nachricht: { ...vorher, bootId: null, gestartetAm: null, unattendedUpgrades: null },
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

describe("the connection", () => {
  it("names a close code for every reason the Zentrale ends a connection", () => {
    expect(new Set(Object.values(TRENNUNG)).size).toBe(Object.keys(TRENNUNG).length);
    // 4000-4999 are free for applications (RFC 6455, 7.4.2)
    for (const code of Object.values(TRENNUNG)) expect(code).toBeGreaterThanOrEqual(4000);
  });

  it("a certificate request carries only a PEM request, never a key", () => {
    const mitSchluessel = {
      typ: "zertifikat_anfrage",
      protokoll: 1,
      csr: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
    };
    expect(vomAgentenLesen(JSON.stringify(mitSchluessel))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^csr: /),
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

  it("a step and an error text of a job are bounded", () => {
    const schritt = {
      typ: "fortschritt",
      protokoll: 1,
      auftragId: "a",
      schritt: "x".repeat(201),
      zeit: 1,
    };
    expect(vomAgentenLesen(JSON.stringify(schritt))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^schritt: /),
    });
    const ergebnis = {
      typ: "ergebnis",
      protokoll: 1,
      auftragId: "a",
      zeit: 1,
      ergebnis: { ok: false, fehler: "x".repeat(2001) },
    };
    expect(vomAgentenLesen(JSON.stringify(ergebnis))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^ergebnis\.fehler: /),
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

describe("facts", () => {
  // Z-304: a fact the agent cannot read is null, never invented
  it("reads a message in which no fact was readable", () => {
    const nichts = {
      typ: "fakten",
      protokoll: 1,
      zeit: 1,
      cpuKerne: null,
      ramMb: null,
      platten: null,
      architektur: null,
      os: null,
      kernel: { laeuft: null, installiert: null },
      neustartNoetig: null,
      updatesAusstehend: null,
      podman: null,
      ipv4: null,
      ipv6: null,
      ptr: {},
      portsBelegt: null,
      port25Ausgehend: null,
      uhrzeitAbweichungMs: null,
      bootId: null,
      gestartetAm: null,
      unattendedUpgrades: null,
    };
    expect(vomAgentenLesen(JSON.stringify(nichts))).toEqual({ ok: true, nachricht: nichts });
  });

  // Z-702: open ports, certificates and the time service came after the first agents; an agent
  // without them still sends valid facts, the Zentrale takes them as not read
  it("reads facts without the fields of the checks", () => {
    const {
      portsOffen: _p,
      zertifikate: _z,
      uhrSynchron: _u,
      ...ohne
    } = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") ?? {};
    expect(vomAgentenLesen(JSON.stringify(ohne))).toEqual({ ok: true, nachricht: ohne });
  });

  it("refuses a certificate without a host or a port out of range", () => {
    const fakten = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") ?? {};
    const ohneHost = { ...fakten, zertifikate: [{ host: "", gueltigBis: 1 }] };
    expect(vomAgentenLesen(JSON.stringify(ohneHost)).ok).toBe(false);
    const port = { ...fakten, portsOffen: [{ port: 70000, proto: "tcp" }] };
    expect(vomAgentenLesen(JSON.stringify(port)).ok).toBe(false);
  });

  it("refuses a fact left out instead of null", () => {
    const { podman: _weg, ...ohne } = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") ?? {};
    expect(vomAgentenLesen(JSON.stringify(ohne))).toMatchObject({
      ok: false,
      grund: expect.stringMatching(/^podman: /),
    });
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
