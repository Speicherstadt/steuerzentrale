import { afterAll, describe, expect, it } from "vitest";
import { auditLog, backups, ereignisse } from "../../db/schema.ts";
import { backupUmgebung } from "../../testhilfen/backups.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import type { Server } from "../server/index.ts";
import { sitzung } from "../verbindung/sitzung.ts";
import { backupStandAnnehmen } from "./stand.ts";

/*
 * BAULISTE.md Z-601: what an agent reports of a backup run. A run of an installation of this server
 * and operator becomes a row in `backups`; a failed one also the event `backup_gescheitert`; a run
 * of another server's or another operator's installation is dropped and logged; the same run twice
 * stays one row.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

const server = (serverId = "s1", betreiberId = "b1") =>
  ({ betreiberId, serverId, name: serverId }) as Server;

const SNAPSHOT = "4f2a9c1e".repeat(8);

/** A run as the agent sends it (packages/protokoll, `BackupStand`) */
const stand = (installationId: string, teil: Record<string, unknown> = {}) => ({
  typ: "backup_stand" as const,
  protokoll: 1,
  installationId,
  lauf: crypto.randomUUID(),
  beginn: 1_800_000_000_000 - 65_000,
  ende: 1_800_000_000_000 - 5_000,
  ok: true,
  teile: [
    { tag: "volume:daten", ok: true, snapshot: SNAPSHOT },
    { tag: "befehl:sichern", ok: true, snapshot: "b7d3e8f0".repeat(8) },
  ],
  ...teil,
});

describe("a backup report", () => {
  it("of an installation of this server becomes a row of its operator", () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    expect(backupStandAnnehmen(u.deps, server(), stand(id), u.uhr.ms)).toEqual({
      ok: true,
      neu: true,
    });
    expect(u.db.select().from(backups).all()).toEqual([
      expect.objectContaining({
        betreiberId: "b1",
        installationId: id,
        serverId: "s1",
        zeitpunkt: u.uhr.ms - 5_000,
        ok: true,
        grund: null,
        teile: JSON.stringify(stand(id).teile),
      }),
    ]);
    expect(u.db.select().from(ereignisse).all()).toEqual([]);
    expect(u.db.select().from(auditLog).all().at(-1)).toMatchObject({
      aktion: "backup.stand",
      akteur: "server:s1",
    });
  });

  it("of a failed run makes the event backup_gescheitert", () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    const n = stand(id, {
      ok: false,
      fehler: "befehl:sichern: die Quelle endete mit Code 1",
      teile: [
        { tag: "volume:daten", ok: true, snapshot: SNAPSHOT },
        { tag: "befehl:sichern", ok: false, fehler: "die Quelle endete mit Code 1" },
      ],
    });
    backupStandAnnehmen(u.deps, server(), n, u.uhr.ms);
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: "backup_gescheitert",
        schwere: "fehler",
        ziel: `installation:${id}`,
        text: `Backup von ${id} gescheitert: befehl:sichern: die Quelle endete mit Code 1`,
      }),
    ]);
  });

  it("sent again at the next connection stays one row and one event, at its arrival at the latest", () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    const n = stand(id, { ok: false, fehler: "kaputt", ende: u.uhr.ms + 60_000 });
    backupStandAnnehmen(u.deps, server(), n, u.uhr.ms);
    u.uhr.ms += 3_600_000;
    expect(backupStandAnnehmen(u.deps, server(), n, u.uhr.ms)).toEqual({ ok: true, neu: false });
    u.uhr.ms -= 3_600_000;
    expect(
      u.db
        .select()
        .from(backups)
        .all()
        .map((b) => b.zeitpunkt),
    ).toEqual([u.uhr.ms]);
    expect(u.db.select().from(ereignisse).all()).toHaveLength(1);
  });

  it("of another server's or another operator's installation is dropped and logged", () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    u.bereit("b2");
    const fremd = u.laufend({}, "b2");
    for (const [s, i] of [
      [server("s2"), id],
      [server("s1", "b2"), id],
      [server("s1"), fremd],
      [server("s1"), "gibt-es-nicht"],
    ] as const)
      expect(backupStandAnnehmen(u.deps, s, stand(i, { ok: false }), u.uhr.ms).ok).toBe(false);
    expect(u.db.select().from(backups).all()).toEqual([]);
    expect(u.db.select().from(ereignisse).all()).toEqual([]);
    expect(u.log.filter((z) => z.includes("backup report dropped"))).toHaveLength(4);
  });

  it("arrives over the agent's connection", async () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    const angemeldet = { ...server(), agentVersion: "0.0.0", architektur: "amd64" } as Server;
    const s = sitzung(u.deps, { server: angemeldet, neu: false });
    s.offen({ senden: () => {}, schliessen: () => {} });
    const hallo = {
      typ: "hallo",
      protokoll: 1,
      agentVersion: "0.0.0",
      architektur: "amd64",
      zeit: 1,
    };
    await s.nachricht(JSON.stringify(hallo));
    await s.nachricht(JSON.stringify(stand(id)));
    expect(u.db.select().from(backups).all()).toHaveLength(1);
  });
});
