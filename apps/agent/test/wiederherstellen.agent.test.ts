import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  snapshotArgument,
  WIEDERHERSTELLEN_AKTION,
  wiederherstellenDatenLesen,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { ADMIN, agentInstallieren, BUCKET, type Minio, minioStarten } from "./backup-hilfen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  ersetzen,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf, muss } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-603 with real Podman, systemd and MinIO (CI only, `bun run test:agent`): the
 * example app set up by a job, entry A made over HTTP, its backup set up and run (run 1), entry B
 * made, run 2; then `installation_wiederherstellen` with the snapshots of run 1: A is there, B is
 * gone (read over HTTP), the app is healthy. An app with a Postgres container by digest: a row
 * inserted after run 1 is gone after the restore. Then the time limit: with MinIO gone, restic
 * hangs inside the transient unit until the job's time runs out; afterwards no process of the
 * playback is left (restic, the agent's binary, the unit) and the units run again. Whatever is
 * not a process (a container record Podman did not clean up) is not counted.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the restore test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-w${ZUFALL}`;
const P = `test-v${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-w${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
const MINIO = `sz-test-minio-w${ZUFALL}`;
const MINIO_PORT = 29421;
const PORT = { k: 29161, p: 29171 } as const;
const UNIT = "sz_wiederherstellen.service";

/** Postgres 18.7: `bun scripts/digest.ts docker.io/library/postgres:18.7-alpine` on 2026-11-23 */
const POSTGRES =
  "docker.io/library/postgres@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71";

const BEISPIEL = () => readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");

/** The example app with a Postgres container, backed up by pg_dump (as backup.agent.test.ts) */
const MIT_POSTGRES = () =>
  ersetzen(
    ersetzen(
      ersetzen(
        BEISPIEL(),
        "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]\noptionen:",
        [
          "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]",
          "  - name: db",
          `    image: ${POSTGRES}`,
          "    volumes: [{ name: pgdaten, pfad: /var/lib/postgresql }]",
          "    feste_env: { POSTGRES_HOST_AUTH_METHOD: trust }",
          "optionen:",
        ].join("\n"),
      ),
      "backup:\n  - { art: volume, volume: daten }\n",
      "backup:\n  - { art: pg_dump, container: db, datenbank: postgres, nutzer: postgres }\n",
    ),
    "ressourcen: { ram_mb: 128, platte_gb: 1 }",
    "ressourcen: { ram_mb: 512, platte_gb: 1 }",
  );

const einrichtung = (port: number): Einrichtung => ({
  installation: {
    kundeId: "k-test",
    optionen: [],
    httpPort: port,
    ports: { "app:9000": port + 1 },
    host: `${port}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: {
    betreiber: {},
    installation: {},
    auto: { BEISPIEL_SCHLUESSEL: "c2NobHVlc3NlbA==" },
  },
});

const eintraege = async (port: number): Promise<string[]> => {
  const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
  const j = (await r.json()) as { eintraege: { text: string }[] };
  return j.eintraege.map((e) => e.text);
};

const eintragen = async (port: number, text: string) => {
  const r = await fetch(`http://127.0.0.1:${port}/eintraege`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  expect(r.status).toBe(201);
};

const gesund = async (port: number): Promise<boolean> => {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.status === 200)
      .catch(() => false);
    if (ok) return true;
    await Bun.sleep(500);
  }
  return false;
};

type Ergebnis = { ok: boolean; fehler?: string; daten?: Record<string, unknown> };
type LaufTeil = { tag: string; ok: boolean; snapshot?: string };

/** The arguments of a restore from the parts of a run, as the Zentrale makes them */
const argumente = (teile: LaufTeil[]): Record<string, string> =>
  Object.fromEntries(
    teile
      .filter((t) => !t.tag.startsWith("befehl:"))
      .map((t) => [snapshotArgument(t.tag), t.snapshot ?? ""]),
  );

/** psql in the installation's database container, as its user */
const psql = (sql: string): string =>
  muss(alsNutzer(`sz-${P}`)("podman", "exec", `${P}-db`, "psql", "-U", "postgres", "-tAc", sql));

describe.skipIf(!bereit)("restoring the example app from MinIO (Z-603)", () => {
  let agent: EchterAgent;
  let minio: Minio;
  let binary: { weg: () => void } | undefined;
  const laeufe = new Map<string, LaufTeil[]>();

  const auftrag = (
    name: string,
    aktion: string,
    id: string,
    teil: Record<string, unknown> = {},
  ): Promise<Ergebnis> => {
    const manifest = (teil.manifest as string | undefined) ?? BEISPIEL();
    return agent.auftrag({
      auftragId: `${id}-${name}`,
      installationId: name,
      aktion,
      argumente: {},
      manifest,
      signatur: signiert(manifest),
      zeitlimitS: 1800,
      ...teil,
    }) as Promise<Ergebnis>;
  };

  const einrichten = async (name: string, port: number, manifest: string) => {
    const e = await auftrag(name, EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      manifest,
      einrichtung: einrichtung(port),
    });
    expect(e.ok ? "ok" : e.fehler).toBe("ok");
    expect(await gesund(port)).toBe(true);
    const b = await auftrag(name, BACKUP_AKTIONEN.einrichten, "backup-einrichten", {
      manifest,
      backup: {
        repository: `s3:${minio.fuerInstallation}/${BUCKET}/b-test/${name}`,
        zugang: ADMIN,
        passwort: PASSWORT,
      },
    });
    expect(b.ok ? "ok" : b.fehler).toBe("ok");
  };

  const sichern = async (name: string, id: string, manifest: string) => {
    const r = await auftrag(name, BACKUP_AKTIONEN.jetzt, id, { manifest });
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const teile = (r.daten?.teile ?? []) as LaufTeil[];
    expect(teile.every((t) => t.ok && /^[0-9a-f]{64}$/.test(t.snapshot ?? ""))).toBe(true);
    laeufe.set(`${name}:${id}`, teile);
    return teile;
  };

  const wiederherstellen = (name: string, id: string, teile: LaufTeil[], o = {}) =>
    auftrag(name, WIEDERHERSTELLEN_AKTION, id, {
      argumente: argumente(teile),
      zeitlimitS: 3600,
      ...o,
    });

  const aktiv = (name: string, unit: string) =>
    lauf(alsNutzer(`sz-${name}`)("systemctl", "--user", "is-active", unit)).aus.trim();

  beforeAll(async () => {
    binary = agentInstallieren(AGENT);
    minio = await minioStarten(MINIO, MINIO_PORT);
    agent = echterAgent({ agent: AGENT });
  }, 600_000);

  afterAll(() => {
    for (const name of [K, P]) wegraeumen(name);
    minio?.stoppen();
    binary?.weg();
    agent?.aufraeumen();
  });

  it("brings back the volume of an older run: its entry is there, a later one is gone", async () => {
    const manifest = BEISPIEL();
    await einrichten(K, PORT.k, manifest);
    await eintragen(PORT.k, `a-${ZUFALL}`);
    const lauf1 = await sichern(K, "lauf1", manifest);
    await eintragen(PORT.k, `b-${ZUFALL}`);
    await sichern(K, "lauf2", manifest);
    expect(await eintraege(PORT.k)).toEqual(expect.arrayContaining([`a-${ZUFALL}`, `b-${ZUFALL}`]));

    const r = await wiederherstellen(K, "zurueck1", lauf1);
    if (!r.ok) throw new Error(r.fehler);
    const daten = wiederherstellenDatenLesen(r.daten);
    const volume = lauf1.find((t) => t.tag === "volume:daten");
    expect(daten.teile.map((t) => [t.tag, t.zurueckgespielt, t.snapshot])).toEqual([
      ["volume:daten", true, volume?.snapshot],
      ["befehl:export", false, null],
    ]);
    expect(await gesund(PORT.k)).toBe(true);
    const nachher = await eintraege(PORT.k);
    expect(nachher).toContain(`a-${ZUFALL}`);
    expect(nachher).not.toContain(`b-${ZUFALL}`);
    expect(aktiv(K, `${K}-app.service`)).toBe("active");
    expect(aktiv(K, "sz_backup.timer")).toBe("active");
    // the transient unit is gone once it ended (--collect)
    expect(aktiv(K, UNIT)).not.toBe("active");
    expect(JSON.stringify(r)).not.toContain(PASSWORT);
  }, 1_200_000);

  it("brings back a database of an older run: a row inserted later is gone", async () => {
    const manifest = MIT_POSTGRES();
    await einrichten(P, PORT.p, manifest);
    let bereitDb = false;
    for (let i = 0; i < 60 && !bereitDb; i++) {
      bereitDb =
        lauf(alsNutzer(`sz-${P}`)("podman", "exec", `${P}-db`, "pg_isready", "-U", "postgres"))
          .code === 0;
      if (!bereitDb) await Bun.sleep(1000);
    }
    expect(bereitDb).toBe(true);
    psql("CREATE TABLE test_zeilen (text text); INSERT INTO test_zeilen VALUES ('vorher')");
    const lauf1 = await sichern(P, "lauf1", manifest);
    psql("INSERT INTO test_zeilen VALUES ('nachher')");
    expect(psql("SELECT string_agg(text, ',' ORDER BY text) FROM test_zeilen")).toBe(
      "nachher,vorher",
    );

    const r = await wiederherstellen(P, "zurueck1", lauf1, { manifest });
    if (!r.ok) throw new Error(r.fehler);
    expect(
      wiederherstellenDatenLesen(r.daten).teile.map((t) => [t.tag, t.zurueckgespielt]),
    ).toEqual([
      ["pg_dump:db:postgres", true],
      ["befehl:export", false],
    ]);
    expect(psql("SELECT string_agg(text, ',' ORDER BY text) FROM test_zeilen")).toBe("vorher");
    expect(await gesund(PORT.p)).toBe(true);
    expect(aktiv(P, `${P}-app.service`)).toBe("active");
  }, 1_200_000);

  it("leaves no process of the playback once the time limit ran out, and runs the units again", async () => {
    const lauf1 = laeufe.get(`${K}:lauf1`);
    expect(lauf1).toBeDefined();
    const uid = muss(["id", "-u", `sz-${K}`]);
    // restic retries an unreachable S3 for 15 minutes, inside the transient unit; MinIO is not
    // needed after this last test
    muss(["podman", "kill", MINIO]);
    const r = await wiederherstellen(K, "zeitlimit", lauf1 ?? [], { zeitlimitS: 60 });
    expect(r.ok).toBe(false);
    expect(r.fehler).toMatch(
      /^Wiederherstellen gescheitert: volume:daten: (Zeitlimit des Auftrags überschritten|zurueckspielen endete mit Code .+); Units wieder gestartet$/,
    );
    expect(aktiv(K, UNIT)).not.toBe("active");
    expect(lauf(["pgrep", "-u", uid, "-x", "restic"]).code).toBe(1);
    expect(lauf(["pgrep", "-u", uid, "-f", "zurueckspielen"]).code).toBe(1);
    expect(lauf(["pgrep", "-u", uid, "-x", "systemd-run"]).code).toBe(1);
    expect(aktiv(K, `${K}-app.service`)).toBe("active");
    expect(aktiv(K, "sz_backup.timer")).toBe("active");
    expect(await gesund(PORT.k)).toBe(true);
  }, 900_000);
});
