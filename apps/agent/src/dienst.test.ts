import { TEST_SCHLUESSEL_ID } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "./beitritt/testhilfen.ts";
import { dienstPruefen } from "./dienst.ts";
import { pfadeIn } from "./pfade.ts";

const pfade = pfadeIn("/k", "/z");
const PEM = (art: string) => `-----BEGIN ${art}-----\nAAAA\n-----END ${art}-----\n`;
const beigetreten = (testmodus = true) => ({
  "/k/manifest.pub": TEST_PUB,
  "/k/agent.json": JSON.stringify({
    zentrale: "http://10.0.0.1:28300",
    serverId: "srv-1",
    testmodus,
  }),
  "/z/agent.key": PEM("PRIVATE KEY"),
  "/z/agent.pem": PEM("CERTIFICATE"),
  "/z/ca.pem": PEM("CERTIFICATE"),
});

describe("the agent's service", () => {
  it("starts on a joined server", async () => {
    expect(await dienstPruefen(speicher(beigetreten()).dateien, pfade)).toEqual({
      ok: true,
      wert: {
        zentrale: "http://10.0.0.1:28300",
        serverId: "srv-1",
        vertrauen: {
          schluessel: expect.objectContaining({ id: TEST_SCHLUESSEL_ID }),
          zweck: "test",
        },
        nurBeobachten: false,
      },
    });
  });

  it("starts only observing when install.sh left the mode's file (Z-1102)", async () => {
    const fs = speicher({ ...beigetreten(), "/k/nur-beobachten": "nur-beobachten\n" });
    const r = await dienstPruefen(fs.dateien, pfade);
    expect(r.ok && r.wert.nurBeobachten).toBe(true);
  });

  it("refuses to start without its certificate", async () => {
    const { "/z/agent.pem": _, ...ohne } = beigetreten();
    const r = await dienstPruefen(speicher(ohne).dateien, pfade);
    expect(r).toEqual({ ok: false, grund: "/z/agent.pem is missing or no CERTIFICATE" });
  });

  it("refuses the public test key when it did not join in test mode", async () => {
    const r = await dienstPruefen(speicher(beigetreten(false)).dateien, pfade);
    expect(r.ok).toBe(false);
  });

  it("refuses settings that are not its own", async () => {
    const r = await dienstPruefen(
      speicher({ ...beigetreten(), "/k/agent.json": "{}" }).dateien,
      pfade,
    );
    expect(r).toEqual({ ok: false, grund: "/k/agent.json is not the agent's settings" });
  });
});
