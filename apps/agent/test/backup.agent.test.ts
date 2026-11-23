import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKUP_AKTIONEN,
  backupPraefix,
  backupRepository,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { backupMelder } from "../src/backup/melden.ts";
import { speicher } from "../src/beitritt/testhilfen.ts";
import {
  ADMIN,
  agentInstallieren,
  BUCKET,
  MINIO_PORT,
  type Minio,
  minioStarten,
  objekte,
  resticAlsRunner,
  type S3Schluessel,
  s3Anfrage,
  snapshots,
  zugangAnlegen,
} from "./backup-hilfen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  ersetzen,
  nutzerLesen,
  signiert,
  sudoLesen,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf, muss } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-601 with real Podman, systemd and MinIO (CI only, `bun run test:agent`): the
 * example app set up by a job, its backup set up by `installation_backup_einrichten` (backup.json
 * 0600 of the user, the user's timer, the repository created in MinIO by the agent's binary as the
 * user), then `installation_backup`: the parts `volume` and `befehl` land as snapshots of their
 * own. The retention is checked with snapshots of an old time (`backup --time`), so the run uses
 * the production policy 7/4/6 unchanged and no variable of the agent changes it for a test. A run
 * started directly by the user's systemd, without the agent's connection, goes through; one with a
 * wrong password writes a failed stand. A second installation with a Postgres container by digest
 * backs up `pg_dump` and `befehl`. Root's part goes through sudo (einrichtung-hilfen.ts). Two
 * installations' own accesses, made by the Zentrale's admin client with `backupPolicy`, show that
 * one cannot read, delete or list outside its own prefix.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the backup test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-s${ZUFALL}`;
const P = `test-q${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
const EINTRAG = `eintrag-${ZUFALL}`;

/** Postgres 18.7: `bun scripts/digest.ts docker.io/library/postgres:18.7-alpine` on 2026-11-23 */
const POSTGRES =
  "docker.io/library/postgres@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71";

const BEISPIEL = () => readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");

/** The example app with a Postgres container, backed up by pg_dump and its export */
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

const home = (name: string) => `/home/sz-${name}`;
const KONFIG = (name: string) => `${home(name)}/.config/steuerzentrale`;

type Teil = { tag: string; ok: boolean; snapshot?: string; fehler?: string };
type Lauf = { lauf: string; ok: boolean; fehler?: string; teile: Teil[] };

/** The runs in the user's stand file, read as root */
const laeufe = (name: string): Lauf[] => {
  const l = lauf(["sudo", "-n", "cat", "--", `${KONFIG(name)}/backup-stand.json`]);
  return l.code === 0 ? (JSON.parse(l.aus) as { laeufe: Lauf[] }).laeufe : [];
};

describe.skipIf(!bereit)("backups of the example app into MinIO (Z-601)", () => {
  let agent: EchterAgent;
  let minio: Minio;
  let binary: { weg: () => void } | undefined;
  const repository = (name: string) => `s3:${minio.fuerInstallation}/${BUCKET}/b-test/${name}`;
  const amRunner = (name: string) => `s3:http://127.0.0.1:${MINIO_PORT}/${BUCKET}/b-test/${name}`;

  const auftrag = (
    name: string,
    aktion: string,
    id: string,
    teil: Record<string, unknown> = {},
  ) => {
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
    }) as Promise<{ ok: boolean; fehler?: string; daten?: Record<string, unknown> }>;
  };
  const backupEinrichten = (name: string, manifest = BEISPIEL()) =>
    auftrag(name, BACKUP_AKTIONEN.einrichten, "backup-einrichten", {
      manifest,
      backup: { repository: repository(name), zugang: ADMIN, passwort: PASSWORT },
    });

  beforeAll(async () => {
    binary = agentInstallieren(AGENT);
    minio = await minioStarten(`sz-test-minio-${ZUFALL}`);
    agent = echterAgent({ agent: AGENT });
  }, 600_000);

  afterAll(() => {
    for (const name of [K, P]) wegraeumen(name);
    minio?.stoppen();
    binary?.weg();
    agent?.aufraeumen();
  });

  it("sets up the example app and its backup: backup.json 0600 of the user, the timer enabled", async () => {
    const e = await auftrag(K, EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      einrichtung: einrichtung(29111),
    });
    expect(e.ok ? "ok" : e.fehler).toBe("ok");
    expect(await gesund(29111)).toBe(true);
    const neu = await fetch("http://127.0.0.1:29111/eintraege", {
      method: "POST",
      body: JSON.stringify({ text: EINTRAG }),
    });
    expect(neu.status).toBe(201);
    const r = await backupEinrichten(K);
    expect(r).toEqual({
      ok: true,
      daten: {
        installation: K,
        repository: "angelegt",
        teile: ["volume:daten", "befehl:export"],
        timer: "sz_backup.timer",
      },
    });
    expect(muss(["sudo", "-n", "stat", "-c", "%a %U", `${KONFIG(K)}/backup.json`])).toBe(
      `600 sz-${K}`,
    );
    expect(muss(alsNutzer(`sz-${K}`)("systemctl", "--user", "is-enabled", "sz_backup.timer"))).toBe(
      "enabled",
    );
  }, 900_000);

  it("backs up the volume and the command as snapshots of their own on installation_backup", async () => {
    const r = await auftrag(K, BACKUP_AKTIONEN.jetzt, "jetzt");
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const teile = (r.daten?.teile ?? []) as Teil[];
    expect(teile.map((t) => [t.tag, t.ok])).toEqual([
      ["volume:daten", true],
      ["befehl:export", true],
    ]);
    const s = snapshots(amRunner(K), PASSWORT);
    expect(s.map((x) => [x.hostname, x.tags, x.id]).sort()).toEqual(
      teile.map((t) => [K, [t.tag], t.snapshot]).sort(),
    );
    const export_ = resticAlsRunner(amRunner(K), PASSWORT, [
      "dump",
      "latest",
      "/export",
      "--tag",
      "befehl:export",
    ]);
    expect(export_.aus).toContain(EINTRAG);
    const volume = resticAlsRunner(amRunner(K), PASSWORT, [
      "ls",
      "latest",
      "--tag",
      "volume:daten",
    ]);
    expect(volume.aus).toContain("/sicherung/daten/beispiel.db");
  }, 600_000);

  it("reports the run as backup_stand, read from the user's stand file", async () => {
    const gesendet: { typ: string; installationId: string; ok: boolean }[] = [];
    await backupMelder({
      gedaechtnis: agent.gedaechtnis,
      nutzer: nutzerLesen,
      lesen: sudoLesen,
      dateien: speicher().dateien,
      pfad: "/z/backup-gemeldet.json",
      log: () => {},
    })((text) => {
      gesendet.push(JSON.parse(text));
      return true;
    }, true);
    expect(gesendet).toEqual([
      expect.objectContaining({ typ: "backup_stand", installationId: K, ok: true }),
    ]);
    expect(JSON.stringify(gesendet)).not.toContain(PASSWORT);
  }, 60_000);

  it("thins out old snapshots by 7 daily, 4 weekly and 6 monthly", async () => {
    // four of one day long ago: a day keeps its newest, and restic keeps the oldest snapshot too
    // while there are fewer periods than the policy names (doc/060_forget.rst, v0.20.0)
    for (const stunde of ["01", "02", "03", "04"]) {
      const alt = resticAlsRunner(
        amRunner(K),
        PASSWORT,
        [
          "backup",
          "--stdin",
          "--stdin-filename",
          "alt",
          "--host",
          K,
          "--tag",
          "volume:daten",
          "--time",
          `2026-01-01 ${stunde}:00:00`,
        ],
        "alt\n",
      );
      expect(alt.code).toBe(0);
    }
    const r = await auftrag(K, BACKUP_AKTIONEN.jetzt, "aufbewahrung");
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const alt = snapshots(amRunner(K), PASSWORT)
      .filter((x) => x.time.startsWith("2026-01-01"))
      .map((x) => x.time.slice(11, 13))
      .sort();
    expect(alt).toEqual(["01", "04"]);
  }, 600_000);

  it("backs up when the user's systemd starts the service, without the agent", async () => {
    const vorher = laeufe(K).length;
    muss(alsNutzer(`sz-${K}`)("systemctl", "--user", "start", "sz_backup.service"), 600_000);
    const nachher = laeufe(K);
    expect(nachher).toHaveLength(vorher + 1);
    expect(nachher.at(-1)?.ok).toBe(true);
  }, 600_000);

  it("writes a failed stand for a wrong password, without the password", async () => {
    const datei = `${KONFIG(K)}/backup.json`;
    const inhalt = JSON.parse(muss(["sudo", "-n", "cat", "--", datei]));
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-backup-"));
    try {
      const falsch = join(ordner, "backup.json");
      writeFileSync(falsch, JSON.stringify({ ...inhalt, passwort: "falsches-passwort-0815" }));
      muss([
        "sudo",
        "-n",
        "install",
        "-m",
        "0600",
        "-o",
        `sz-${K}`,
        "-g",
        `sz-${K}`,
        "--",
        falsch,
        datei,
      ]);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
    const l = lauf(
      alsNutzer(`sz-${K}`)("systemctl", "--user", "start", "sz_backup.service"),
      600_000,
    );
    expect(l.code).not.toBe(0);
    const letzter = laeufe(K).at(-1);
    expect(letzter?.ok).toBe(false);
    expect(letzter?.fehler).toContain("falsches Passwort des Repositorys");
    expect(JSON.stringify(laeufe(K))).not.toContain("falsches-passwort-0815");
    expect(JSON.stringify(laeufe(K))).not.toContain(PASSWORT);
  }, 600_000);

  it("backs up pg_dump and a command of an app with Postgres as snapshots of their own", async () => {
    const manifest = MIT_POSTGRES();
    const e = await auftrag(P, EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      manifest,
      einrichtung: einrichtung(29121),
    });
    expect(e.ok ? "ok" : e.fehler).toBe("ok");
    const als = alsNutzer(`sz-${P}`);
    let bereitDb = false;
    for (let i = 0; i < 60 && !bereitDb; i++) {
      bereitDb = lauf(als("podman", "exec", `${P}-db`, "pg_isready", "-U", "postgres")).code === 0;
      if (!bereitDb) await Bun.sleep(1000);
    }
    expect(bereitDb).toBe(true);
    const b = await backupEinrichten(P, manifest);
    expect(b.ok ? "ok" : b.fehler).toBe("ok");
    const r = await auftrag(P, BACKUP_AKTIONEN.jetzt, "jetzt", { manifest });
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const tags = snapshots(amRunner(P), PASSWORT).map((x) => x.tags?.join(","));
    expect(tags.sort()).toEqual(["befehl:export", "pg_dump:db:postgres"]);
    const dump = resticAlsRunner(amRunner(P), PASSWORT, [
      "dump",
      "latest",
      "/db-postgres.dump",
      "--tag",
      "pg_dump:db:postgres",
    ]);
    // pg_dump's custom format starts with PGDMP (pg_backup_archiver.c)
    expect(dump.aus.startsWith("PGDMP")).toBe(true);
  }, 900_000);

  it("keeps an installation's own access to its prefix: another's it can neither read nor delete", async () => {
    const praefix = (installationId: string) => {
      const p = backupPraefix({ bucket: BUCKET, betreiberId: "b-test", installationId });
      if (!p.ok) throw new Error(p.grund);
      return p.praefix;
    };
    const [na, nb] = [`test-a${ZUFALL}`, `test-b${ZUFALL}`];
    const [pa, pb] = [praefix(na), praefix(nb)];
    const a = await zugangAnlegen(na, pa);
    const b = await zugangAnlegen(nb, pb);
    const repo = (p: string) => backupRepository(`http://127.0.0.1:${MINIO_PORT}`, BUCKET, p);
    // one password for both repositories: what is refused, S3 refuses, not restic's key
    const mit = (zugang: S3Schluessel, p: string, args: string[], eingabe?: string) =>
      resticAlsRunner(repo(p), PASSWORT, args, eingabe, zugang);
    const sichern = ["backup", "--stdin", "--stdin-filename", "probe", "--host", "probe"];
    for (const [zugang, p] of [
      [a, pa],
      [b, pb],
    ] as const) {
      const init = mit(zugang, p, ["init"]);
      expect(init.code === 0 ? "ok" : init.fehler).toBe("ok");
      const backup = mit(zugang, p, sichern, "probe\n");
      expect(backup.code === 0 ? "ok" : backup.fehler).toBe("ok");
    }
    const vorher = await objekte(pb);
    expect(vorher).toContain(`${pb}config`);
    const [snapshotB] = snapshots(repo(pb), PASSWORT);

    const lesen = mit(a, pb, ["snapshots"]);
    expect(lesen.code).not.toBe(0);
    expect(lesen.fehler).toContain("Access Denied");
    const vergessen = mit(a, pb, ["forget", "--prune", snapshotB?.id ?? "?"]);
    expect(vergessen.code).not.toBe(0);
    expect(vergessen.fehler).toContain("Access Denied");
    for (const objekt of vorher)
      expect((await s3Anfrage(a, "DELETE", `/${objekt}`)).status, objekt).toBe(403);
    expect(await objekte(pb)).toEqual(vorher);
    expect(snapshots(repo(pb), PASSWORT).map((s) => s.id)).toEqual([snapshotB?.id]);

    const auflisten = (prefix: string) => s3Anfrage(a, "GET", "/", { "list-type": "2", prefix });
    expect(await objekte(pa, a)).toContain(`${pa}config`);
    for (const prefix of [pb, "b-test/", ""])
      expect((await auflisten(prefix)).status, prefix).toBe(403);
  }, 600_000);
});
