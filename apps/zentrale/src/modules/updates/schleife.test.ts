import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { TEST_SCHLUESSEL } from "../../testhilfen/installationen.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { updateUmgebung } from "../../testhilfen/updates.ts";
import { schreiben } from "../audit/index.ts";
import { auftragAnlegen } from "../auftraege/index.ts";
import { backupAbgleichen } from "../backups/index.ts";
import { updateStand } from "./lesen.ts";
import { updatePlanLesen, WARTUNGSFENSTER_VORGABE, wartungsfensterLesen } from "./plan.ts";
import { updatesPlanen } from "./schleife.ts";

/*
 * BAULISTE.md Z-503, the planning every 5 minutes (docs/plan.md, "Update in der Zentrale (Z-503)"):
 * no automatic update in a freeze window or outside the server's maintenance window, an urgent one
 * at once, at most one per server at a time, never one of an app without health, "alle" only 24 h
 * after "intern", and nothing more of a version once an update to it was rolled back.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

// The test servers' window is Sundays 03:00–04:00 Europe/Berlin (testhilfen/auftraege.ts)
const SONNTAG_IM_FENSTER = Date.UTC(2027, 0, 17, 2, 30); // 03:30 CET
const SONNTAG_DANACH = Date.UTC(2027, 0, 17, 4, 0); // 05:00 CET
const FREITAG = Date.UTC(2027, 0, 15, 8, 0);

const umgebung = async (intern = true) => {
  const u = updateUmgebung(minio);
  u.uhr.ms = FREITAG;
  if (intern)
    schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
      w.aendern("kunden", { kundeId: "k1" }, { intern: true }),
    );
  const planen = () =>
    updatesPlanen({ ...u.deps, manifestSchluessel: async () => TEST_SCHLUESSEL });
  const plan = (id: string) =>
    updatePlanLesen(u.db, "b1", u.uhr.ms).find((z) => z.installationId === id)?.ergebnis;
  return { u, planen, plan };
};

describe("the planning of updates", () => {
  it("updates an internal installation in its server's maintenance window, not outside", async () => {
    const { u, planen, plan } = await umgebung();
    const id = await u.eingerichtet();
    u.versionen("update-1.3.0");
    expect(await planen()).toEqual({ angelegt: [] });
    expect(plan(id)).toEqual({
      art: "termin",
      ab: SONNTAG_IM_FENSTER - 30 * 60_000,
      sperrzeitUebergangen: false,
    });
    u.uhr.ms = SONNTAG_DANACH;
    expect(await planen()).toEqual({ angelegt: [] });
    u.uhr.ms = SONNTAG_IM_FENSTER;
    expect(await planen()).toEqual({ angelegt: [id] });
    expect(updateStand(u.db, "b1", id).letzter).toMatchObject({
      nachVersion: "1.3.0",
      anlass: "welle",
      welle: "intern",
      phase: "sichern",
    });
    expect(u.updateAuftraege(id).backup?.angelegtVon).toBe("system");
  });

  it("starts no update in a freeze window, also within the maintenance window", async () => {
    const { u, planen, plan } = await umgebung();
    // Sunday the 7th of February, inside the window from the 7th to the 12th
    u.uhr.ms = Date.UTC(2027, 1, 7, 2, 30);
    u.zielSetzen();
    const id = u.laufend("gesichert-gesperrt");
    u.melden(u.auftrag(id, "pforte_route_setzen")?.auftragId ?? "", true);
    await backupAbgleichen({ ...u.deps, fetch });
    u.melden(u.auftrag(id, "installation_backup_einrichten")?.auftragId ?? "", true);
    u.versionen("update-1.3.0");
    expect(await planen()).toEqual({ angelegt: [] });
    // the next Sunday after the freeze window
    expect(plan(id)).toMatchObject({ art: "termin", ab: Date.UTC(2027, 1, 14, 2, 0) });
    u.uhr.ms = Date.UTC(2027, 1, 14, 2, 10);
    expect(await planen()).toEqual({ angelegt: [id] });
  });

  it("starts an urgent update at once, in every wave, but not in a freeze window", async () => {
    const { u, planen } = await umgebung(false);
    const id = await u.eingerichtet();
    u.versionen("update-dringend");
    u.uhr.ms = Date.UTC(2027, 1, 8, 10, 0); // in its freeze window, a Monday
    expect(await planen()).toEqual({ angelegt: [] });
    u.uhr.ms = Date.UTC(2027, 1, 15, 10, 0); // a Monday after it, outside any maintenance window
    expect(await planen()).toEqual({ angelegt: [id] });
    expect(updateStand(u.db, "b1", id).letzter).toMatchObject({
      nachVersion: "1.4.0",
      anlass: "dringend",
      welle: "alle",
    });
  });

  it("updates at most one installation per server at a time", async () => {
    const { u, planen } = await umgebung();
    const erste = await u.eingerichtet();
    const zweite = await u.eingerichtet();
    u.versionen("update-1.3.0");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    const runde = await planen();
    expect(runde.angelegt).toHaveLength(1);
    const [gestartet] = runde.angelegt as [string];
    const andere = gestartet === erste ? zweite : erste;
    expect(await planen()).toEqual({ angelegt: [] });
    u.gesichert(gestartet);
    u.beendet(gestartet, { ergebnis: "aktualisiert", dauerMs: 1000 });
    expect(await planen()).toEqual({ angelegt: [andere] });
  });

  it("counts an update of the server's agent as the one update of the server (Z-504)", async () => {
    const { u, planen } = await umgebung();
    const id = await u.eingerichtet();
    u.versionen("update-1.3.0");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    const test = join(import.meta.dirname, "../../../../../packages/manifest/test");
    const agent = auftragAnlegen(u.deps, u.kontext("b1"), {
      serverId: "s1",
      installationId: null,
      aktion: AGENT_UPDATE_AKTION,
      argumente: { version: "0.0.1" },
      manifest: readFileSync(join(test, "SHA256SUMS"), "utf8"),
      signatur: readFileSync(join(test, "SHA256SUMS.minisig"), "utf8"),
    });
    expect(agent.ok).toBe(true);
    expect(await planen()).toEqual({ angelegt: [] });
    u.melden(agent.ok ? agent.auftrag.auftragId : "", true);
    expect(await planen()).toEqual({ angelegt: [id] });
  });

  it("never updates an app without health; by hand it can be", async () => {
    const { u, planen, plan } = await umgebung();
    const id = await u.eingerichtet();
    u.versionen("update-ohne-health");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    expect(await planen()).toEqual({ angelegt: [] });
    expect(plan(id)).toEqual({ art: "wartet", grund: "nur_von_hand" });
    expect(u.anlegen(id, { version: "1.3.2" }).ok).toBe(true);
  });

  it("halts the version after a rollback: no further installation gets it", async () => {
    const { u, planen, plan } = await umgebung();
    const erste = await u.eingerichtet();
    const zweite = await u.eingerichtet();
    u.versionen("update-1.3.0");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    const [gestartet] = (await planen()).angelegt as [string];
    u.gesichert(gestartet);
    u.beendet(gestartet, { ergebnis: "zurueckgenommen", grund: "Health rot", dauerMs: 1000 });
    expect(await planen()).toEqual({ angelegt: [] });
    for (const id of [erste, zweite])
      expect(plan(id)).toEqual({ art: "wartet", grund: "angehalten" });
  });

  it('starts "alle" only 24 hours after "intern" reached the version', async () => {
    const { u, planen, plan } = await umgebung();
    u.kunde("b1", "k2");
    const intern = await u.eingerichtet();
    const kunde = u.laufend("gesichert", { kundeId: "k2" });
    u.melden(u.auftrag(kunde, "pforte_route_setzen")?.auftragId ?? "", true);
    await backupAbgleichen({ ...u.deps, fetch });
    u.melden(u.auftrag(kunde, "installation_backup_einrichten")?.auftragId ?? "", true);
    u.versionen("update-1.3.0");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    expect(await planen()).toEqual({ angelegt: [intern] });
    expect(plan(kunde)).toEqual({ art: "wartet", grund: "intern_laeuft" });
    u.gesichert(intern);
    u.beendet(intern, { ergebnis: "aktualisiert", dauerMs: 1000 });
    // a day later is Monday, outside the window: the next Sunday's
    expect(plan(kunde)).toMatchObject({ art: "termin", ab: Date.UTC(2027, 0, 24, 2, 0) });
    expect(await planen()).toEqual({ angelegt: [] });
    u.uhr.ms = Date.UTC(2027, 0, 24, 2, 5);
    expect(await planen()).toEqual({ angelegt: [kunde] });
  });

  it("plans only the operator's own installations and does nothing without the key", async () => {
    const { u } = await umgebung();
    const id = await u.eingerichtet();
    u.versionen("update-1.3.0");
    u.uhr.ms = SONNTAG_IM_FENSTER;
    u.bereit("b2", null);
    expect(updatePlanLesen(u.db, "b2", u.uhr.ms)).toEqual([]);
    expect(updatePlanLesen(u.db, "b1", u.uhr.ms).map((z) => z.installationId)).toEqual([id]);
    const ohne = await updatesPlanen({ ...u.deps, manifestSchluessel: async () => undefined });
    expect(ohne).toEqual({ angelegt: [] });
  });
});

describe("the maintenance window of a server", () => {
  it("reads the server's window, and takes the default for one it cannot read", () => {
    const fenster = { tage: [0, 6], von: "23:00", bis: "01:00" };
    expect(wartungsfensterLesen(JSON.stringify(fenster))).toEqual(fenster);
    expect(WARTUNGSFENSTER_VORGABE).toEqual({
      tage: [0, 1, 2, 3, 4, 5, 6],
      von: "02:00",
      bis: "05:00",
    });
    for (const kaputt of [
      "{}",
      "nicht json",
      '{"tage":[7],"von":"02:00","bis":"05:00"}',
      '{"tage":[1],"von":"2 Uhr","bis":"05:00"}',
    ])
      expect(wartungsfensterLesen(kaputt)).toEqual(WARTUNGSFENSTER_VORGABE);
  });
});
