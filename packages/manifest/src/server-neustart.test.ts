import { describe, expect, it } from "vitest";
import {
  KEIN_MANIFEST,
  SERVER_NEUSTART_AKTION,
  type ServerNeustartAnfrage,
  serverNeustartAuftragPruefen,
} from "./server-neustart.ts";

/*
 * BAULISTE.md Z-701: the reboot of a server is a job with a fixed shape, checked by the Zentrale
 * when it makes one and by the agent before it reboots: no installation, no data, no manifest, and
 * the boot it is meant for as its one argument.
 */
const BOOT = "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4";

const anfrage = (teil: Partial<ServerNeustartAnfrage> = {}): ServerNeustartAnfrage => ({
  aktion: SERVER_NEUSTART_AKTION,
  installationId: null,
  argumente: { bootId: BOOT },
  manifest: KEIN_MANIFEST,
  signatur: KEIN_MANIFEST,
  ...teil,
});

describe("serverNeustartAuftragPruefen", () => {
  it("takes the reboot of one boot", () => {
    expect(serverNeustartAuftragPruefen(anfrage())).toEqual({
      ok: true,
      auftrag: { art: "server_neustart", bootId: BOOT },
    });
  });

  it("refuses another action, an installation and installation or backup data", () => {
    expect(serverNeustartAuftragPruefen(anfrage({ aktion: "agent_update" })).ok).toBe(false);
    expect(serverNeustartAuftragPruefen(anfrage({ installationId: "haben-k1" }))).toMatchObject({
      ok: false,
      grund: "the reboot belongs to no installation",
    });
    expect(serverNeustartAuftragPruefen(anfrage({ einrichtung: {} })).ok).toBe(false);
    expect(serverNeustartAuftragPruefen(anfrage({ backup: {} })).ok).toBe(false);
  });

  it("refuses a manifest or a signature: a reboot carries none", () => {
    expect(serverNeustartAuftragPruefen(anfrage({ manifest: "schema: 1\n" }))).toMatchObject({
      ok: false,
      grund: "the reboot carries no manifest",
    });
    expect(serverNeustartAuftragPruefen(anfrage({ signatur: "untrusted comment" })).ok).toBe(false);
  });

  it("takes the boot id as its only argument, as the kernel writes it", () => {
    expect(
      serverNeustartAuftragPruefen(anfrage({ argumente: { bootId: BOOT, befehl: "rm" } })),
    ).toMatchObject({ ok: false, grund: "unknown argument befehl" });
    expect(serverNeustartAuftragPruefen(anfrage({ argumente: {} })).ok).toBe(false);
    for (const falsch of [BOOT.toUpperCase(), `${BOOT} `, "--force", 1])
      expect(
        serverNeustartAuftragPruefen(anfrage({ argumente: { bootId: falsch } })),
      ).toMatchObject({
        ok: false,
        grund: "argument bootId: a boot id as /proc/sys/kernel/random/boot_id",
      });
  });
});
