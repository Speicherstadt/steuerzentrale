import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { pfadeIn } from "../pfade.ts";
import type { Ereignisse } from "./sockel.ts";
import { verbindungsSchleife } from "./verbinden.ts";

/*
 * BAULISTE.md Z-504: the new agent confirms its update once its Zentrale greets it, and not before
 * (src/agent-update/marke.ts); a connection that opens but gets no `willkommen` confirms nothing.
 */
const PEM = (art: string) => `-----BEGIN ${art}-----\na\n-----END ${art}-----\n`;
const weiter = () => new Promise((r) => setTimeout(r, 0));

describe("the agent's connection and its update", () => {
  it("confirms the update at each willkommen, not at hallo", async () => {
    let bestaetigt = 0;
    const offen: Ereignisse[] = [];
    const schleife = verbindungsSchleife(
      {
        oeffnen: (_url, _tls, e) => {
          offen.push(e);
          return { senden: () => {}, schliessen: () => {} };
        },
        planen: () => () => {},
        jetzt: () => 1,
        zufall: () => 0,
        log: () => {},
        dateien: speicher({
          "/z/agent.key": PEM("PRIVATE KEY"),
          "/z/agent.pem": PEM("CERTIFICATE"),
        }).dateien,
        pfade: pfadeIn("/k", "/z"),
        architektur: "amd64",
        verbunden: async () => {
          bestaetigt += 1;
        },
      },
      "https://agent.example.de",
    );
    await weiter();
    offen[0]?.offen();
    expect(bestaetigt).toBe(0);
    offen[0]?.nachricht(
      JSON.stringify({ typ: "willkommen", protokoll: PROTOKOLL_VERSION, zeit: 1 }),
    );
    await weiter();
    expect(bestaetigt).toBe(1);
    schleife.stoppen();
  });
});
