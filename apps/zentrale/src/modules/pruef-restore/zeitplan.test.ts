import { BACKUP_AKTIONEN, PRUEF_RESTORE_AKTION } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { ereignisse } from "../../db/schema.ts";
import { KENNWORT, LIZENZ } from "../../testhilfen/installationen.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { pruefUmgebung } from "../../testhilfen/pruef-restore.ts";
import { backupJetzt } from "../backups/index.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { kopieEinrichtungFuer } from "./kopie.ts";
import {
  PRUEF_RESTORE_ABSTAND_MS,
  PRUEF_RESTORE_KEIN_PLATZ_ART,
  pruefRestorePlanen,
} from "./zeitplan.ts";

/*
 * BAULISTE.md Z-602, the schedule (docs/plan.md, "Prüf-Restore (Z-602)"): every hour a running
 * installation with backups set up and a successful run gets a test restore on its own server, at
 * most one a week, none while another of its jobs is open, none on a server without room (an event
 * instead, once a week). The copy has its own name and ports; its data, with the installation's
 * settings, goes only to the installation's own server, and never a backup access.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

type U = ReturnType<typeof pruefUmgebung>;

/** The test restore jobs the agent of s1 got */
const bekommen = (u: U) =>
  u.agent.filter((n) => n.typ === "auftrag" && n.aktion === PRUEF_RESTORE_AKTION) as {
    installationId: string;
    argumente: { kopie: string };
    einrichtung: {
      installation: { httpPort: number; ports: Record<string, number>; host: string };
      einstellungen: { betreiber: Record<string, unknown>; installation: Record<string, unknown> };
    };
  }[];

const keinPlatz = (u: U) =>
  u.db
    .select()
    .from(ereignisse)
    .all()
    .filter((e) => e.art === PRUEF_RESTORE_KEIN_PLATZ_ART);

describe("the schedule of test restores", () => {
  it("makes one on the installation's own server, with the copy's own name and ports", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    expect(pruefRestorePlanen(u.deps)).toEqual({ angelegt: 1, keinPlatz: 0 });
    const [job] = u.pruefAuftraege(id);
    expect(job).toMatchObject({ serverId: "s1", zustand: "zugestellt", angelegtVon: "system" });
    const [n] = bekommen(u);
    const kopie = n?.argumente.kopie ?? "";
    expect(kopie).toMatch(/^restore-[a-z0-9]{6}$/);
    expect(n).not.toHaveProperty("backup");
    const i = installationLesen(u.db, "b1", id);
    const original = JSON.parse(i?.ports ?? "{}") as Record<string, number>;
    expect(n?.einrichtung.installation.httpPort).not.toBe(i?.httpPort);
    expect(Object.values(n?.einrichtung.installation.ports ?? {})).not.toEqual(
      Object.values(original),
    );
    expect(n?.einrichtung.installation.host).toBe(i?.host);
    expect(n?.einrichtung.einstellungen.betreiber.PROBE_LIZENZ).toBe(LIZENZ);
    expect(n?.einrichtung.einstellungen.installation.PROBE_KENNWORT).toBe(KENNWORT);
    expect(
      u
        .kopiePortZeilen(kopie)
        .map((p) => p.port)
        .sort(),
    ).toEqual(
      [
        n?.einrichtung.installation.httpPort,
        ...Object.values(n?.einrichtung.installation.ports ?? {}),
      ].sort(),
    );
    expect(JSON.stringify(u.pruefAuftraege(id))).not.toContain(KENNWORT);
  });

  it("makes at most one a week, whatever became of it", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    pruefRestorePlanen(u.deps);
    const [erster] = u.pruefAuftraege(id);
    u.pruefMelden(
      erster?.auftragId ?? "",
      u.ergebnis(erster?.auftragId ?? "", { ok: false, fehler: "Health rot" }),
    );
    u.uhr.ms += PRUEF_RESTORE_ABSTAND_MS - 60_000;
    expect(pruefRestorePlanen(u.deps).angelegt).toBe(0);
    u.uhr.ms += 60_000;
    // the agent reports its facts every 15 minutes; a placement does not use stale ones
    u.fakten("b1", "s1");
    expect(pruefRestorePlanen(u.deps)).toEqual({ angelegt: 1, keinPlatz: 0 });
    expect(u.pruefAuftraege(id)).toHaveLength(2);
  });

  it("makes none without backups set up or without a successful run", async () => {
    const u = pruefUmgebung(minio);
    const ohneEinrichtung = u.laufend();
    const ohneLauf = await u.eingerichtet();
    const nurGescheitert = await u.eingerichtet();
    u.lauf(nurGescheitert, false);
    expect(pruefRestorePlanen(u.deps)).toEqual({ angelegt: 0, keinPlatz: 0 });
    for (const id of [ohneEinrichtung, ohneLauf, nurGescheitert])
      expect(u.pruefAuftraege(id)).toEqual([]);
  });

  it("makes none while another job of the installation is open", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    const jetzt = backupJetzt(u.deps, u.kontext("b1"), id);
    expect(jetzt.ok).toBe(true);
    expect(pruefRestorePlanen(u.deps).angelegt).toBe(0);
    u.melden(u.auftrag(id, BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", true);
    expect(pruefRestorePlanen(u.deps).angelegt).toBe(1);
  });

  it("makes one test restore per server at a time", async () => {
    const u = pruefUmgebung(minio);
    const a = await u.gesichert();
    const b = await u.gesichert();
    expect(pruefRestorePlanen(u.deps).angelegt).toBe(1);
    const [job] = [...u.pruefAuftraege(a), ...u.pruefAuftraege(b)];
    u.pruefMelden(job?.auftragId ?? "", u.ergebnis(job?.auftragId ?? "", { ok: true, daten: {} }));
    expect(pruefRestorePlanen(u.deps).angelegt).toBe(1);
    expect(u.pruefAuftraege(a)).toHaveLength(1);
    expect(u.pruefAuftraege(b)).toHaveLength(1);
  });

  it("does not choose a server without room: an event once a week, no job", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    // room for the installation, none for a second one like it
    u.fakten("b1", "s1", { ramMb: 400 });
    expect(pruefRestorePlanen(u.deps)).toEqual({ angelegt: 0, keinPlatz: 1 });
    expect(u.pruefAuftraege(id)).toEqual([]);
    expect(keinPlatz(u)).toEqual([
      expect.objectContaining({
        schwere: "warn",
        ziel: `installation:${id}`,
        text: expect.stringContaining("ram"),
      }),
    ]);
    u.uhr.ms += 60 * 60_000;
    pruefRestorePlanen(u.deps);
    expect(keinPlatz(u)).toHaveLength(1);
    u.uhr.ms += PRUEF_RESTORE_ABSTAND_MS;
    u.fakten("b1", "s1", { ramMb: 400 });
    pruefRestorePlanen(u.deps);
    expect(keinPlatz(u)).toHaveLength(2);
    expect(u.pruefAuftraege(id)).toEqual([]);
    expect(bekommen(u)).toEqual([]);
  });

  it("gives the copy's data to no other server", async () => {
    const u = pruefUmgebung(minio);
    u.betreiber("b2", "s2");
    const fremd = u.verbinden("b2", "s2");
    const id = await u.gesichert();
    pruefRestorePlanen(u.deps);
    const [job] = u.pruefAuftraege(id);
    if (!job) throw new Error("no job");
    expect(fremd.filter((n) => n.typ === "auftrag")).toEqual([]);
    expect(kopieEinrichtungFuer(u.deps, { ...job, serverId: "s9" })).toEqual({
      ok: false,
      grund: `${id} does not stand on server s9`,
    });
    expect(kopieEinrichtungFuer(u.deps, { ...job, betreiberId: "b2" }).ok).toBe(false);
  });
});
