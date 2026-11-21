import { PFORTE_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { auftragsUmgebung, neuerAuftrag } from "../../testhilfen/auftraege.ts";
import { auftragAnlegen } from "./anlegen.ts";

/*
 * BAULISTE.md Z-401: the Zentrale makes the Pforte's jobs with the same function as every job; it
 * checks their fixed shape (packages/manifest, pforte/auftraege.ts) as the agent does again. Who
 * makes them (installing, removing) comes with Z-402.
 */

const route = (teil: Record<string, unknown> = {}) =>
  neuerAuftrag("s1", {
    aktion: PFORTE_AKTIONEN.setzen,
    argumente: { host: "auftrag.kunde.example", port: 20001 },
    ...teil,
  });

describe("a job of the Pforte", () => {
  it("is made with a time limit of 60 seconds and goes to its agent", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    const agent = u.verbinden("b1", "s1");
    expect(auftragAnlegen(u.deps, u.kontext("b1"), route({ auftragId: "p1" }))).toMatchObject({
      ok: true,
      auftrag: { aktion: PFORTE_AKTIONEN.setzen, zeitlimitS: 60, zustand: "zugestellt" },
    });
    expect(
      auftragAnlegen(
        u.deps,
        u.kontext("b1"),
        route({ auftragId: "p2", aktion: PFORTE_AKTIONEN.entfernen, argumente: {} }),
      ),
    ).toMatchObject({ ok: true });
    expect(agent.map((n) => n.aktion)).toEqual([PFORTE_AKTIONEN.setzen, PFORTE_AKTIONEN.entfernen]);
  });

  it.each([
    ["a host with a path", { argumente: { host: "a.example/x", port: 20001 } }],
    ["a privileged port", { argumente: { host: "a.example", port: 80 } }],
    ["an argument of its own", { argumente: { host: "a.example", port: 20001, dial: "x" } }],
    ["no installation", { installationId: null }],
  ])("is refused with %s", (_fall, teil) => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    expect(auftragAnlegen(u.deps, u.kontext("b1"), route(teil))).toMatchObject({
      ok: false,
      grund: "argumente_ungueltig",
    });
  });
});
