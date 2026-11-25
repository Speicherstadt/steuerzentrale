import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../../db/schema.ts";
import {
  installationsUmgebung,
  neueInstallation,
  TEST_SCHLUESSEL,
  type Testmanifest,
} from "../../testhilfen/installationen.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { offeneZustellen } from "../auftraege/zustellen.ts";
import { aktionAusloesen } from "./aktionen.ts";
import { installationAnlegen } from "./anlegen.ts";

/*
 * BAULISTE.md Z-405, the Zentrale's side of the actions of an installation (docs/plan.md,
 * "Aktionen einer Installation", "Neustart"): only what the manifest offers, only for an installation
 * that runs, each with a reason in the audit log; a restart never in a freeze window of the
 * manifest, neither made nor sent, and never while another job of the installation is open.
 */

type U = ReturnType<typeof installationsUmgebung>;
type Nachricht = Record<string, unknown> & { aktion?: string; auftragId?: string };

const SERVER = { betreiberId: "b1", serverId: "s1" } as Parameters<typeof auftragMelden>[1];

const fertig = (auftragId: string): AuftragsMeldung => ({
  typ: "ergebnis",
  protokoll: 1,
  auftragId,
  zeit: 1,
  ergebnis: { ok: true, daten: {} },
});

/** Every job the agent got that has not ended, reported done */
const allesErledigt = (u: U) => {
  for (const a of u.db.select().from(auftraege).all()) {
    if (["erfolgreich", "gescheitert", "abgebrochen"].includes(a.zustand)) continue;
    const auftragId = a.auftragId;
    auftragMelden(u.deps, SERVER, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
    auftragMelden(u.deps, SERVER, fertig(auftragId), u.uhr.ms);
  }
};

/** An installation set up and running; with what its agent got */
const laufend = (u: U, mit: Testmanifest = "probe") => {
  const agent = u.bereit("b1", mit) as Nachricht[];
  const wahl = u.manifest(mit);
  const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation(wahl));
  if (!a.ok) throw new Error(`${a.grund} ${a.detail ?? ""}`);
  allesErledigt(u);
  allesErledigt(u);
  return { i: a.installation, agent };
};

const GRUND = "Health rot seit 10:31";

const ausloesen = (
  u: U,
  installationId: string,
  aktion: Parameters<typeof aktionAusloesen>[3],
  betreiberId = "b1",
) => aktionAusloesen(u.deps, { ...u.kontext(betreiberId), grund: GRUND }, installationId, aktion);

describe("an action of an installation", () => {
  it.each([
    ["neustart", AKTIONS_AUFTRAEGE.neustart],
    ["log_auszug", AKTIONS_AUFTRAEGE.log_auszug],
  ] as const)("%s becomes the built-in job, sent to the agent", (aktion, auftrag) => {
    const u = installationsUmgebung();
    const { i, agent } = laufend(u);
    const r = ausloesen(u, i.installationId, aktion);
    expect(r).toMatchObject({ ok: true, auftrag: { aktion: auftrag, zustand: "zugestellt" } });
    expect(agent.at(-1)).toMatchObject({
      typ: "auftrag",
      aktion: auftrag,
      installationId: i.installationId,
      argumente: {},
    });
    expect(agent.at(-1)).not.toHaveProperty("einrichtung");
  });

  it("nur lesen runs the command the manifest names", () => {
    const u = installationsUmgebung();
    const { i, agent } = laufend(u, "aktionen");
    const r = ausloesen(u, i.installationId, "nur_lesen");
    expect(r).toMatchObject({ ok: true, auftrag: { aktion: "nurlesen" } });
    expect(agent.at(-1)).toMatchObject({ aktion: "nurlesen", argumente: {} });
  });

  it("stands in the audit log with its reason", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    const r = ausloesen(u, i.installationId, "neustart");
    if (!r.ok) throw new Error(r.grund);
    expect(u.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        aktion: "installation.neustart",
        ziel: `auftraege:${r.auftrag.auftragId}`,
        grund: GRUND,
        akteur: "nutzer-1",
      }),
    );
  });

  it("is taken without a reason, with an empty one in the audit log (Z-1207)", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    const r = aktionAusloesen(
      u.deps,
      { ...u.kontext("b1"), grund: "" },
      i.installationId,
      "neustart",
    );
    expect(r.ok).toBe(true);
    expect(u.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({ aktion: "installation.neustart", grund: "" }),
    );
  });

  it.each(["neustart", "nur_lesen"] as const)("%s is refused when not offered", (aktion) => {
    const u = installationsUmgebung();
    const { i } = laufend(u, aktion === "neustart" ? "aktionen" : "probe");
    const jobs = u.db.select().from(auftraege).all().length;
    expect(ausloesen(u, i.installationId, aktion)).toEqual({ ok: false, grund: "nicht_angeboten" });
    expect(u.db.select().from(auftraege).all()).toHaveLength(jobs);
  });

  it("is refused for an installation that does not run", () => {
    const u = installationsUmgebung();
    u.bereit();
    const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation());
    if (!a.ok) throw new Error(a.grund);
    expect(ausloesen(u, a.installation.installationId, "log_auszug")).toEqual({
      ok: false,
      grund: "laeuft_nicht",
    });
  });

  it("is refused for an installation of another operator", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    u.betreiber("b2", "s2");
    for (const aktion of ["neustart", "log_auszug", "nur_lesen"] as const)
      expect(ausloesen(u, i.installationId, aktion, "b2")).toEqual({
        ok: false,
        grund: "keine_installation",
      });
  });
});

describe("a restart", () => {
  it("is refused while another job of the installation is open; a log excerpt is not", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    expect(ausloesen(u, i.installationId, "log_auszug").ok).toBe(true);
    expect(ausloesen(u, i.installationId, "neustart")).toEqual({
      ok: false,
      grund: "auftrag_offen",
    });
    expect(ausloesen(u, i.installationId, "log_auszug").ok).toBe(true);
  });

  it("is refused in a freeze window of the manifest, and not outside it", () => {
    const u = installationsUmgebung();
    u.uhr.ms = Date.UTC(2027, 0, 13, 12);
    const { i } = laufend(u, "gesperrt");
    u.uhr.ms = Date.UTC(2027, 1, 7, 9);
    expect(ausloesen(u, i.installationId, "neustart")).toEqual({
      ok: false,
      grund: "sperrzeit",
      detail: "Umsatzsteuer-Voranmeldung",
    });
    // a log excerpt restarts nothing
    expect(ausloesen(u, i.installationId, "log_auszug").ok).toBe(true);
    allesErledigt(u);
    u.uhr.ms = Date.UTC(2027, 1, 12, 23, 30);
    expect(ausloesen(u, i.installationId, "neustart").ok).toBe(true);
  });

  it("made outside a freeze window is not sent to an agent that connects within it", () => {
    const u = installationsUmgebung();
    u.uhr.ms = Date.UTC(2027, 0, 13, 12);
    const { i } = laufend(u, "gesperrt");
    u.deps.verbindungen.trennen("b1", "s1", 1001, "test");
    u.uhr.ms = Date.UTC(2027, 1, 6, 12);
    const r = ausloesen(u, i.installationId, "neustart");
    if (!r.ok) throw new Error(r.grund);
    expect(r.auftrag.zustand).toBe("bereit");
    u.uhr.ms = Date.UTC(2027, 1, 8, 9);
    const drinnen = u.verbinden("b1", "s1") as Nachricht[];
    offeneZustellen(u.deps, "b1", "s1");
    expect(drinnen.filter((n) => n.aktion === AKTIONS_AUFTRAEGE.neustart)).toEqual([]);
    u.uhr.ms = Date.UTC(2027, 1, 13, 9);
    const danach = u.verbinden("b1", "s1") as Nachricht[];
    offeneZustellen(u.deps, "b1", "s1");
    expect(danach.filter((n) => n.auftragId === r.auftrag.auftragId)).toHaveLength(1);
  });
});
