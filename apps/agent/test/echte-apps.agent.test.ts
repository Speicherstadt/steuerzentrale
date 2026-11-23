import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  UPDATE_AKTION,
  UPDATE_ZEITLIMIT_S,
  updateDatenLesen,
  WIEDERHERSTELLEN_AKTION,
  wiederherstellenDatenLesen,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, agentInstallieren, BUCKET, type Minio, minioStarten } from "./backup-hilfen.ts";
import {
  echtesManifest,
  einrichtungFuer,
  gelesen,
  HERSTELLER_ID,
  type LaufTeil,
  ohneHealth,
  planFuer,
  snapshotArgumente,
} from "./echte-apps-hilfen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf, muss } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-1003 with real Podman, systemd and MinIO (CI only, `bun run test:agent`): the real
 * apps from manifeste/, their images by digest from GHCR, each manifest signed with the test key
 * here. Schreibzeug 0.1.25 and Haben 0.12.0-rc.1 (with the operator's ELSTER manufacturer ID
 * 74931) set up by jobs as the Zentrale makes them, healthy and their units active; their backups
 * set up and run twice with a mark in their data in between, then restored from the first run:
 * the later mark is gone (Schreibzeug: a file in its volume; Haben: a row in its database and a
 * file among its receipts). Then the updates: Schreibzeug to 0.1.26 as its wave starts it (the
 * Zentrale's plan names the date, "intern", due now), Haben to 0.12.0 by hand, since an app
 * without health is never planned (its plan entry waits "nur_von_hand"); the agent judges it by
 * its units. Both with the snapshots of the backup made just before, keeping their data. The
 * reason of an update by hand stays in the Zentrale (modules/updates, anlegen.test.ts); the job
 * it sends is the one built here. Haben names /api/health since 0.12.0, so the test takes it out
 * of both manifests (echte-apps-hilfen.ts `ohneHealth`; docs/plan.md, "Echte Apps (Z-1003)").
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the test of the real apps is skipped (CI only)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const S = `test-s${ZUFALL}`;
const H = `test-h${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-e${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
const MINIO = `sz-test-minio-e${ZUFALL}`;
const MINIO_PORT = 29441;
const PORT = { s: 29191, h: 29201 } as const;
const HINWEIS = "Test ohne Health (Z-1003)";

const SCHREIBZEUG = {
  alt: echtesManifest("schreibzeug", "0.1.25"),
  neu: echtesManifest("schreibzeug", "0.1.26"),
};
const HABEN = {
  alt: ohneHealth(echtesManifest("haben", "0.12.0-rc.1"), HINWEIS),
  neu: ohneHealth(echtesManifest("haben", "0.12.0"), HINWEIS),
};

type Ergebnis = { ok: boolean; fehler?: string; daten?: Record<string, unknown> };

const gesund = async (port: number): Promise<boolean> => {
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => r.status === 200)
      .catch(() => false);
    if (ok) return true;
    await Bun.sleep(1000);
  }
  return false;
};

const als = (name: string) => alsNutzer(`sz-${name}`);
const aktiv = (name: string, unit: string) =>
  lauf(als(name)("systemctl", "--user", "is-active", unit)).aus.trim();

/** The marks (empty files) in a folder of a container, made and listed with its own tools */
const markieren = (name: string, ordner: string, marke: string) =>
  muss(als(name)("podman", "exec", `${name}-app`, "touch", `${ordner}/${marke}`));
const marken = (name: string, ordner: string): string[] =>
  muss(als(name)("podman", "exec", `${name}-app`, "ls", "-1", ordner))
    .split("\n")
    .filter((z) => z.startsWith("sz-test-"));

/** psql in Haben's database container as its user (haben-db.container: POSTGRES_USER=haben) */
const psql = (sql: string): string =>
  muss(als(H)("podman", "exec", `${H}-db`, "psql", "-U", "haben", "-d", "haben", "-tAc", sql));

/** The version the running app container carries in its label */
const laufendeVersion = (name: string): string =>
  muss(
    als(name)(
      "podman",
      "inspect",
      "--format",
      '{{index .Config.Labels "de.speicherstadt.steuerzentrale.version"}}',
      `${name}-app`,
    ),
  ).trim();

describe.skipIf(!bereit)("the real apps: Schreibzeug and Haben from manifeste/ (Z-1003)", () => {
  let agent: EchterAgent;
  let minio: Minio;
  let binary: { weg: () => void } | undefined;
  const einrichtungen = new Map<string, Einrichtung>();

  const auftrag = (
    name: string,
    manifest: string,
    aktion: string,
    id: string,
    teil: Record<string, unknown> = {},
  ): Promise<Ergebnis> =>
    agent.auftrag({
      auftragId: `${id}-${name}`,
      installationId: name,
      aktion,
      argumente: {},
      manifest,
      signatur: signiert(manifest),
      zeitlimitS: 1800,
      ...teil,
    }) as Promise<Ergebnis>;

  const einrichten = async (name: string, manifest: string, e: Einrichtung) => {
    einrichtungen.set(name, e);
    const r = await auftrag(name, manifest, EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      einrichtung: e,
      zeitlimitS: 3600,
    });
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const b = await auftrag(name, manifest, BACKUP_AKTIONEN.einrichten, "backup-einrichten", {
      backup: {
        repository: `s3:${minio.fuerInstallation}/${BUCKET}/b-test/${name}`,
        zugang: ADMIN,
        passwort: PASSWORT,
      },
    });
    expect(b.ok ? "ok" : b.fehler).toBe("ok");
  };

  const sichern = async (name: string, manifest: string, id: string): Promise<LaufTeil[]> => {
    const r = await auftrag(name, manifest, BACKUP_AKTIONEN.jetzt, id);
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const teile = (r.daten?.teile ?? []) as LaufTeil[];
    expect(teile.every((t) => t.ok && /^[0-9a-f]{64}$/.test(t.snapshot ?? ""))).toBe(true);
    return teile;
  };

  const wiederherstellen = async (name: string, manifest: string, teile: LaufTeil[]) => {
    const r = await auftrag(name, manifest, WIEDERHERSTELLEN_AKTION, "zurueck", {
      argumente: snapshotArgumente(teile),
      zeitlimitS: 3600,
    });
    if (!r.ok) throw new Error(r.fehler);
    expect(JSON.stringify(r)).not.toContain(PASSWORT);
    return wiederherstellenDatenLesen(r.daten).teile.map((t) => [t.tag, t.zurueckgespielt]);
  };

  /** The update job as the Zentrale makes it: the new manifest, the values, the run just before */
  const aktualisieren = async (name: string, alt: string, neu: string) => {
    const vorher = await sichern(name, alt, "vor-update");
    const r = await auftrag(name, neu, UPDATE_AKTION, "update", {
      argumente: snapshotArgumente(vorher),
      einrichtung: einrichtungen.get(name),
      zeitlimitS: UPDATE_ZEITLIMIT_S,
    });
    if (!r.ok) throw new Error(r.fehler);
    expect(JSON.stringify(r)).not.toContain(PASSWORT);
    const d = updateDatenLesen(r.daten);
    if (d === null) throw new Error(`no update result: ${JSON.stringify(r.daten)}`);
    return d;
  };

  beforeAll(async () => {
    binary = agentInstallieren(AGENT);
    minio = await minioStarten(MINIO, MINIO_PORT);
    agent = echterAgent({ agent: AGENT });
  }, 600_000);

  afterAll(() => {
    for (const name of [S, H]) wegraeumen(name);
    minio?.stoppen();
    binary?.weg();
    agent?.aufraeumen();
  });

  it("sets up Schreibzeug 0.1.25, backs it up and restores the first run", async () => {
    await einrichten(S, SCHREIBZEUG.alt, einrichtungFuer(gelesen(SCHREIBZEUG.alt), PORT.s));
    expect(await gesund(PORT.s)).toBe(true);
    expect(aktiv(S, `${S}-app.service`)).toBe("active");
    expect(laufendeVersion(S)).toBe("0.1.25");

    markieren(S, "/data", "sz-test-a");
    const lauf1 = await sichern(S, SCHREIBZEUG.alt, "lauf1");
    markieren(S, "/data", "sz-test-b");
    await sichern(S, SCHREIBZEUG.alt, "lauf2");
    expect(marken(S, "/data")).toEqual(["sz-test-a", "sz-test-b"]);

    expect(await wiederherstellen(S, SCHREIBZEUG.alt, lauf1)).toEqual([["volume:daten", true]]);
    expect(await gesund(PORT.s)).toBe(true);
    expect(marken(S, "/data")).toEqual(["sz-test-a"]);
    expect(aktiv(S, `${S}-app.service`)).toBe("active");
    expect(aktiv(S, "sz_backup.timer")).toBe("active");
  }, 2_400_000);

  it("updates Schreibzeug to 0.1.26 as its wave starts it, with its data", async () => {
    const plan = planFuer(S, SCHREIBZEUG.alt, [SCHREIBZEUG.neu], Date.now());
    expect(plan.version).toBe("0.1.26");
    expect(plan.eintrag).toMatchObject({ welle: "intern", ergebnis: { art: "termin" } });
    expect(plan.faellig).toBe(true);

    const d = await aktualisieren(S, SCHREIBZEUG.alt, SCHREIBZEUG.neu);
    expect(d.ergebnis).toBe("aktualisiert");
    expect(await gesund(PORT.s)).toBe(true);
    expect(laufendeVersion(S)).toBe("0.1.26");
    expect(marken(S, "/data")).toEqual(["sz-test-a"]);
    expect(aktiv(S, `${S}-app.service`)).toBe("active");
    expect(aktiv(S, "sz_backup.timer")).toBe("active");
  }, 1_800_000);

  it("sets up Haben 0.12.0-rc.1 with the manufacturer ID, backs it up and restores the first run", async () => {
    const e = einrichtungFuer(gelesen(HABEN.alt), PORT.h, { ELSTER_HERSTELLER_ID: HERSTELLER_ID });
    await einrichten(H, HABEN.alt, e);
    // judged by its units; its health route is read here only as proof that Haben really runs
    expect(await gesund(PORT.h)).toBe(true);
    expect(aktiv(H, `${H}-db.service`)).toBe("active");
    expect(aktiv(H, `${H}-app.service`)).toBe("active");
    expect(laufendeVersion(H)).toBe("0.12.0-rc.1");
    expect(
      muss(als(H)("podman", "exec", `${H}-app`, "printenv", "ELSTER_HERSTELLER_ID")).trim(),
    ).toBe(HERSTELLER_ID);

    psql(
      "CREATE SCHEMA sz_test; CREATE TABLE sz_test.zeilen (text text); INSERT INTO sz_test.zeilen VALUES ('vorher')",
    );
    markieren(H, "/var/lib/haben/belege", "sz-test-a");
    const lauf1 = await sichern(H, HABEN.alt, "lauf1");
    psql("INSERT INTO sz_test.zeilen VALUES ('nachher')");
    markieren(H, "/var/lib/haben/belege", "sz-test-b");
    await sichern(H, HABEN.alt, "lauf2");
    expect(psql("SELECT string_agg(text, ',' ORDER BY text) FROM sz_test.zeilen")).toBe(
      "nachher,vorher",
    );

    expect(await wiederherstellen(H, HABEN.alt, lauf1)).toEqual([
      ["pg_dump:db:haben", true],
      ["volume:belege", true],
    ]);
    expect(psql("SELECT string_agg(text, ',' ORDER BY text) FROM sz_test.zeilen")).toBe("vorher");
    expect(marken(H, "/var/lib/haben/belege")).toEqual(["sz-test-a"]);
    expect(await gesund(PORT.h)).toBe(true);
    expect(aktiv(H, `${H}-app.service`)).toBe("active");
    expect(aktiv(H, "sz_backup.timer")).toBe("active");
  }, 2_400_000);

  it("updates Haben without health only by hand, to 0.12.0, judged by its units", async () => {
    const plan = planFuer(H, HABEN.alt, [HABEN.neu], Date.now());
    expect(plan.version).toBe("0.12.0");
    expect(plan.eintrag.ergebnis).toEqual({ art: "wartet", grund: "nur_von_hand" });
    expect(plan.faellig).toBe(false);

    const d = await aktualisieren(H, HABEN.alt, HABEN.neu);
    expect(d.ergebnis).toBe("aktualisiert");
    expect(aktiv(H, `${H}-db.service`)).toBe("active");
    expect(aktiv(H, `${H}-app.service`)).toBe("active");
    expect(laufendeVersion(H)).toBe("0.12.0");
    expect(psql("SELECT string_agg(text, ',' ORDER BY text) FROM sz_test.zeilen")).toBe("vorher");
    expect(marken(H, "/var/lib/haben/belege")).toEqual(["sz-test-a"]);
    expect(await gesund(PORT.h)).toBe(true);
    expect(aktiv(H, "sz_backup.timer")).toBe("active");
  }, 1_800_000);
});
