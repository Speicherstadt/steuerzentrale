import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  snapshotArgument,
  UPDATE_AKTION,
  UPDATE_ZEITLIMIT_S,
  updateDatenLesen,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { ADMIN, agentInstallieren, BUCKET, type Minio, minioStarten } from "./backup-hilfen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-503 with real Podman, systemd and MinIO (CI only, `bun run test:agent`): the
 * example app 1.0.0 set up by a job with its backup, entry A made over HTTP, a backup run, then
 * `installation_update` to 2.0.0 with that run's snapshots: `aktualisiert`, 2.0.0 runs with A and
 * the migration of 2.0.0 (`schritte.nach_update`). Entry B made, a backup run, then the update to
 * the broken 2.1.0 (health red, scripts/beispiel-images.ts): `zurueckgenommen`, 2.0.0 runs again,
 * healthy, with A and B, and without any trace of 2.1.0 in its data (its server and its
 * `migrieren` record their version in the table `migrationen`): the data are those of the backup
 * made just before. The backup's timer runs again, the transient unit is gone.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the update test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const NAME = `test-u${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-u${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
const MINIO = `sz-test-minio-u${ZUFALL}`;
const MINIO_PORT = 29431;
const PORT = 29181;

const manifest = (version: string) =>
  readFileSync(join(AUSGABE, "manifeste", version, "manifest.yml"), "utf8");

const einrichtung: Einrichtung = {
  installation: {
    kundeId: "k-test",
    optionen: [],
    httpPort: PORT,
    ports: { "app:9000": PORT + 1 },
    host: `${PORT}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: {
    betreiber: {},
    installation: {},
    auto: { BEISPIEL_SCHLUESSEL: "c2NobHVlc3NlbA==" },
  },
};

type Stand = { version: string; eintraege: { text: string }[]; migrationen: { version: string }[] };

const stand = async (): Promise<Stand> => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(5000) });
  return (await r.json()) as Stand;
};

const eintragen = async (text: string) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/eintraege`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  expect(r.status).toBe(201);
};

const gesund = async (): Promise<boolean> => {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.status === 200)
      .catch(() => false);
    if (ok) return true;
    await Bun.sleep(500);
  }
  return false;
};

type Ergebnis = { ok: boolean; fehler?: string; daten?: Record<string, unknown> };
type LaufTeil = { tag: string; ok: boolean; snapshot?: string };

/** The arguments of an update from the parts of the run just before, as the Zentrale makes them */
const argumente = (teile: LaufTeil[]): Record<string, string> =>
  Object.fromEntries(
    teile
      .filter((t) => !t.tag.startsWith("befehl:"))
      .map((t) => [snapshotArgument(t.tag), t.snapshot ?? ""]),
  );

describe.skipIf(!bereit)(
  "updating the example app, and rolling back a broken version (Z-503)",
  () => {
    let agent: EchterAgent;
    let minio: Minio;
    let binary: { weg: () => void } | undefined;

    const auftrag = (
      aktion: string,
      id: string,
      version: string,
      teil: Record<string, unknown> = {},
    ): Promise<Ergebnis> => {
      const text = manifest(version);
      return agent.auftrag({
        auftragId: `${id}-${NAME}`,
        installationId: NAME,
        aktion,
        argumente: {},
        manifest: text,
        signatur: signiert(text),
        zeitlimitS: 1800,
        ...teil,
      }) as Promise<Ergebnis>;
    };

    const sichern = async (id: string, version: string): Promise<LaufTeil[]> => {
      const r = await auftrag(BACKUP_AKTIONEN.jetzt, id, version);
      expect(r.ok ? "ok" : r.fehler).toBe("ok");
      const teile = (r.daten?.teile ?? []) as LaufTeil[];
      expect(teile.every((t) => t.ok && /^[0-9a-f]{64}$/.test(t.snapshot ?? ""))).toBe(true);
      return teile;
    };

    const aktualisieren = async (id: string, version: string, lauf: LaufTeil[]) => {
      const r = await auftrag(UPDATE_AKTION, id, version, {
        argumente: argumente(lauf),
        einrichtung,
        zeitlimitS: UPDATE_ZEITLIMIT_S,
      });
      if (!r.ok) throw new Error(r.fehler);
      expect(JSON.stringify(r)).not.toContain(PASSWORT);
      const d = updateDatenLesen(r.daten);
      if (d === null) throw new Error(`no update result: ${JSON.stringify(r.daten)}`);
      return d;
    };

    const aktiv = (unit: string) =>
      lauf(alsNutzer(`sz-${NAME}`)("systemctl", "--user", "is-active", unit)).aus.trim();

    beforeAll(async () => {
      binary = agentInstallieren(AGENT);
      minio = await minioStarten(MINIO, MINIO_PORT);
      agent = echterAgent({ agent: AGENT });
      const e = await auftrag(EINRICHTUNG_AKTIONEN.einrichten, "einrichten", "1.0.0", {
        einrichtung,
      });
      expect(e.ok ? "ok" : e.fehler).toBe("ok");
      expect(await gesund()).toBe(true);
      const b = await auftrag(BACKUP_AKTIONEN.einrichten, "backup-einrichten", "1.0.0", {
        backup: {
          repository: `s3:${minio.fuerInstallation}/${BUCKET}/b-test/${NAME}`,
          zugang: ADMIN,
          passwort: PASSWORT,
        },
      });
      expect(b.ok ? "ok" : b.fehler).toBe("ok");
    }, 900_000);

    afterAll(() => {
      wegraeumen(NAME);
      minio?.stoppen();
      binary?.weg();
      agent?.aufraeumen();
    });

    it("brings 1.0.0 to 2.0.0 with its data and runs schritte.nach_update", async () => {
      await eintragen(`a-${ZUFALL}`);
      const lauf1 = await sichern("lauf1", "1.0.0");
      const d = await aktualisieren("update2", "2.0.0", lauf1);
      expect(d.ergebnis).toBe("aktualisiert");
      expect(await gesund()).toBe(true);
      const s = await stand();
      expect(s.version).toBe("2.0.0");
      expect(s.eintraege.map((e) => e.text)).toEqual([`a-${ZUFALL}`]);
      expect(s.migrationen.map((m) => m.version)).toEqual(["1.0.0", "2.0.0"]);
      expect(aktiv(`${NAME}-app.service`)).toBe("active");
      expect(aktiv("sz_backup.timer")).toBe("active");
    }, 900_000);

    it("rolls the broken 2.1.0 back to 2.0.0 with the data from before", async () => {
      await eintragen(`b-${ZUFALL}`);
      const lauf2 = await sichern("lauf2", "2.0.0");
      const d = await aktualisieren("update21", "2.1.0", lauf2);
      expect(d).toMatchObject({ ergebnis: "zurueckgenommen", grund: "Health: HTTP 500" });
      expect(await gesund()).toBe(true);
      const s = await stand();
      expect(s.version).toBe("2.0.0");
      expect(s.eintraege.map((e) => e.text)).toEqual([`a-${ZUFALL}`, `b-${ZUFALL}`]);
      // 2.1.0 ran and recorded itself; the backup before it did not know it
      expect(s.migrationen.map((m) => m.version)).toEqual(["1.0.0", "2.0.0"]);
      expect(aktiv(`${NAME}-app.service`)).toBe("active");
      expect(aktiv("sz_backup.timer")).toBe("active");
      expect(aktiv("sz_wiederherstellen.service")).not.toBe("active");
    }, 1_500_000);
  },
);
