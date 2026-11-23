import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  PRUEF_RESTORE_AKTION,
  pruefRestoreDatenLesen,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { sha256Hex, signieren } from "../../zentrale/src/modules/backups/sigv4.ts";
import { ADMIN, agentInstallieren, BUCKET, type Minio, minioStarten } from "./backup-hilfen.ts";
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
 * BAULISTE.md Z-602 with real Podman, systemd and MinIO (CI only, `bun run test:agent`): the
 * example app set up by a job, an entry made over HTTP, its backup set up and run ("Backup jetzt");
 * then `installation_pruef_restore` sets up the copy restore-<6>, plays the snapshot back, starts
 * it and checks its health on its own port. While the copy runs, the test reads the entry from it
 * over HTTP through the hook `waehrendKopie` (pruef-restore/auftrag.ts): the agent knows no app's
 * data, so its result cannot hold such a check without hard-coding the app. Afterwards neither
 * the copy's user nor its home, processes or runtime folder (units, volumes and containers live in
 * home and runtime folder) are left, and the original still runs with its entry. Packs of the
 * repository overwritten with the admin access make a failed Prüf-Restore with its reason, torn
 * down all the same. MinIO on a port of its own: the test files run side by side.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the Prüf-Restore test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-r${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-r${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
const EINTRAG = `eintrag-${ZUFALL}`;
const MINIO_PORT = 29411;
const REGION = "us-east-1";
const PORT = { original: 29131, kopie: 29141, kaputt: 29151 } as const;

const BEISPIEL = () => readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");

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

/** A new copy's name, as the Zentrale makes it */
const kopieName = () => `restore-${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;

/** The objects below the prefix and an object overwritten, as the admin of the test MinIO */
const s3 = async (
  methode: "GET" | "PUT",
  pfad: string,
  abfrage: Record<string, string> = {},
  inhalt = new Uint8Array(0),
) => {
  const url = new URL(`http://127.0.0.1:${MINIO_PORT}/${BUCKET}${pfad}`);
  for (const [k, v] of Object.entries(abfrage)) url.searchParams.set(k, v);
  const koepfe = await signieren({
    methode,
    url,
    inhaltHash: await sha256Hex(inhalt),
    zugang: { accessKey: ADMIN.schluesselId, secretKey: ADMIN.geheim },
    region: REGION,
    jetzt: Date.now(),
  });
  const a = await fetch(url, {
    method: methode,
    headers: koepfe,
    ...(methode === "PUT" ? { body: inhalt } : {}),
  });
  return { status: a.status, text: await a.text() };
};

/** Nothing of the copy is left on the runner */
const nichtsMehrDa = async (kopie: string, uid: string | undefined) => {
  expect(lauf(["id", "-u", `sz-${kopie}`]).code).not.toBe(0);
  expect(lauf(["sudo", "-n", "test", "-e", `/home/sz-${kopie}`]).code).not.toBe(0);
  expect(uid).toMatch(/^[0-9]+$/);
  // logind removes the runtime folder (Podman's containers and the user's units) shortly after
  let weg = false;
  for (let i = 0; i < 30 && !weg; i++) {
    weg =
      lauf(["pgrep", "-u", uid ?? "0"]).code === 1 &&
      lauf(["sudo", "-n", "test", "-e", `/run/user/${uid}`]).code !== 0;
    if (!weg) await Bun.sleep(1000);
  }
  expect(weg).toBe(true);
};

type Gesehen = { kopie: string; eintraege: string[]; uid: string };

describe.skipIf(!bereit)("Prüf-Restore of the example app from MinIO (Z-602)", () => {
  let agent: EchterAgent;
  let minio: Minio;
  let binary: { weg: () => void } | undefined;
  const gesehen: Gesehen[] = [];
  const kopien: string[] = [];

  const auftrag = (aktion: string, id: string, teil: Record<string, unknown> = {}) => {
    const manifest = BEISPIEL();
    return agent.auftrag({
      auftragId: `${id}-${K}`,
      installationId: K,
      aktion,
      argumente: {},
      manifest,
      signatur: signiert(manifest),
      zeitlimitS: 1800,
      ...teil,
    }) as Promise<{ ok: boolean; fehler?: string; daten?: Record<string, unknown> }>;
  };

  const pruefRestore = async (id: string, port: number) => {
    const kopie = kopieName();
    kopien.push(kopie);
    const r = await auftrag(PRUEF_RESTORE_AKTION, id, {
      argumente: { kopie },
      einrichtung: einrichtung(port),
      zeitlimitS: 3600,
    });
    return { kopie, r };
  };

  beforeAll(async () => {
    binary = agentInstallieren(AGENT);
    minio = await minioStarten(`sz-test-minio-r${ZUFALL}`, MINIO_PORT);
    agent = echterAgent({
      agent: AGENT,
      // the entry as the copy serves it, read before the copy is torn down
      waehrendKopie: async ({ kopie, ziel }) => {
        if (ziel.art !== "http") throw new Error(`health ${ziel.art}`);
        gesehen.push({
          kopie,
          eintraege: await eintraege(ziel.port),
          uid: muss(["id", "-u", `sz-${kopie}`]),
        });
      },
    });
  }, 600_000);

  afterAll(() => {
    for (const name of [K, ...kopien]) wegraeumen(name);
    minio?.stoppen();
    binary?.weg();
    agent?.aufraeumen();
  });

  it("sets up the example app with an entry, its backup and one run", async () => {
    const e = await auftrag(EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      einrichtung: einrichtung(PORT.original),
    });
    expect(e.ok ? "ok" : e.fehler).toBe("ok");
    expect(await gesund(PORT.original)).toBe(true);
    const neu = await fetch(`http://127.0.0.1:${PORT.original}/eintraege`, {
      method: "POST",
      body: JSON.stringify({ text: EINTRAG }),
    });
    expect(neu.status).toBe(201);
    const b = await auftrag(BACKUP_AKTIONEN.einrichten, "backup-einrichten", {
      backup: {
        repository: `s3:${minio.fuerInstallation}/${BUCKET}/b-test/${K}`,
        zugang: ADMIN,
        passwort: PASSWORT,
      },
    });
    expect(b.ok ? "ok" : b.fehler).toBe("ok");
    const j = await auftrag(BACKUP_AKTIONEN.jetzt, "jetzt");
    expect(j.ok ? "ok" : j.fehler).toBe("ok");
  }, 900_000);

  it("plays the snapshot back into a copy that serves the entry, then tears the copy down", async () => {
    const { kopie, r } = await pruefRestore("pruef", PORT.kopie);
    if (!r.ok) throw new Error(r.fehler);
    const daten = pruefRestoreDatenLesen(r.daten);
    expect(daten.teile.map((t) => [t.tag, t.zurueckgespielt])).toEqual([
      ["volume:daten", true],
      ["befehl:export", false],
    ]);
    expect(daten.dauerMs).toBeGreaterThan(0);
    expect(daten.teile[0]?.snapshot).toMatch(/^[0-9a-f]{64}$/);
    const seen = gesehen.find((g) => g.kopie === kopie);
    expect(seen?.eintraege).toContain(EINTRAG);
    await nichtsMehrDa(kopie, seen?.uid);
    // the original runs on, with its entry
    expect(await eintraege(PORT.original)).toContain(EINTRAG);
    expect(muss(alsNutzer(`sz-${K}`)("systemctl", "--user", "is-active", `${K}-app.service`))).toBe(
      "active",
    );
    expect(JSON.stringify(daten)).not.toContain(PASSWORT);
  }, 900_000);

  it("fails with a reason for a damaged backup, and tears the copy down all the same", async () => {
    const liste = await s3("GET", "/", { "list-type": "2", prefix: `b-test/${K}/data/` });
    expect(liste.status).toBe(200);
    const packs = [...liste.text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string);
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs)
      expect((await s3("PUT", `/${pack}`, {}, new TextEncoder().encode("kaputt"))).status).toBe(
        200,
      );
    const vorher = gesehen.length;
    const { kopie, r } = await pruefRestore("kaputt", PORT.kaputt);
    expect(r.ok).toBe(false);
    expect(r.fehler).toContain("Prüf-Restore gescheitert: Zurückspielen: volume:daten:");
    // torn down: no "Abbau unvollständig" beside the reason
    expect(r.fehler).not.toContain("Abbau");
    expect(gesehen).toHaveLength(vorher);
    expect(lauf(["id", "-u", `sz-${kopie}`]).code).not.toBe(0);
    expect(lauf(["sudo", "-n", "test", "-e", `/home/sz-${kopie}`]).code).not.toBe(0);
    expect(await eintraege(PORT.original)).toContain(EINTRAG);
  }, 900_000);
});
