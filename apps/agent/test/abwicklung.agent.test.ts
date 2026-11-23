import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABWICKLUNG_AKTIONEN,
  BACKUP_AKTIONEN,
  backupPraefix,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  sha256Hex,
  signieren,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { praefixLoeschen } from "../../zentrale/src/modules/backups/objekte.ts";
import {
  ADMIN,
  agentInstallieren,
  BUCKET,
  type Minio,
  minioStarten,
  objekte,
  type S3Schluessel,
  s3Anfrage,
  zugangAnlegen,
} from "./backup-hilfen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { lauf } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-604 with real Podman, systemd and MinIO (CI only, `bun run test:agent`), the
 * "Fertig, wenn" of the deletion: the example app set up by a job, its backup set up with the
 * installation's own access (made as the Zentrale makes it, backupPolicy) and run; then
 * `installation_archiv` writes the newest snapshot of each part and uploads it below the prefix
 * (`archiv/`), and `installation_loeschen` takes the installation down: afterwards neither its
 * Linux user nor its home exist. The Zentrale's step `repository` (praefixLoeschen, with the
 * installation's own access) then leaves no object below the prefix, and an object of a
 * neighbouring prefix that starts with the same name is still there. MinIO on a port of its own.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the deletion test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-l${ZUFALL}`;
const AGENT = `/usr/local/bin/sz-test-agent-l${ZUFALL}`;
const PASSWORT = `pw-${crypto.randomUUID()}`;
/** Ports of this file alone: the other agent test files run side by side (echte-apps uses 29441, 29191) */
const MINIO_PORT = 29451;
const PORT = 29211;
/** The test MinIO has no region set (backup-hilfen.ts) */
const REGION = "us-east-1";

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

/** An object put with the admin access, signed by the Zentrale's SigV4 */
const ablegen = async (schluessel: string, inhalt: Uint8Array<ArrayBuffer>) => {
  const url = new URL(`http://127.0.0.1:${MINIO_PORT}/${BUCKET}/${schluessel}`);
  const koepfe = await signieren({
    methode: "PUT",
    url,
    inhaltHash: await sha256Hex(inhalt),
    zugang: { accessKey: ADMIN.schluesselId, secretKey: ADMIN.geheim },
    region: REGION,
    jetzt: Date.now(),
  });
  const a = await fetch(url, { method: "PUT", headers: koepfe, body: inhalt });
  if (a.status !== 200) throw new Error(`PUT ${schluessel}: HTTP ${a.status}`);
};

type Antwort = { ok: boolean; fehler?: string; daten?: Record<string, unknown> };

describe.skipIf(!bereit)("archive and deletion of the example app after a contract (Z-604)", () => {
  let agent: EchterAgent;
  let minio: Minio;
  let binary: { weg: () => void } | undefined;
  let zugang: S3Schluessel;
  const ort = backupPraefix({ bucket: BUCKET, betreiberId: "b-test", installationId: K });
  if (!ort.ok) throw new Error(ort.grund);
  const praefix = ort.praefix;
  const nachbar = `b-test/${K}x/fremd`;

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
    }) as Promise<Antwort>;
  };

  beforeAll(async () => {
    binary = agentInstallieren(AGENT);
    minio = await minioStarten(`sz-test-minio-l${ZUFALL}`, MINIO_PORT);
    agent = echterAgent({ agent: AGENT });
    zugang = await zugangAnlegen(`sz-${K}`, praefix, MINIO_PORT);
  }, 600_000);

  afterAll(() => {
    wegraeumen(K);
    minio?.stoppen();
    binary?.weg();
    agent?.aufraeumen();
  });

  it("sets up the example app, its backup with its own access, and one run", async () => {
    const e = await auftrag(EINRICHTUNG_AKTIONEN.einrichten, "einrichten", {
      einrichtung: einrichtung(PORT),
    });
    expect(e.ok ? "ok" : e.fehler).toBe("ok");
    expect(await gesund(PORT)).toBe(true);
    const b = await auftrag(BACKUP_AKTIONEN.einrichten, "backup-einrichten", {
      backup: {
        repository: `s3:${minio.fuerInstallation}/${BUCKET}/${praefix.replace(/\/$/, "")}`,
        zugang,
        passwort: PASSWORT,
      },
    });
    expect(b.ok ? "ok" : b.fehler).toBe("ok");
    const j = await auftrag(BACKUP_AKTIONEN.jetzt, "jetzt");
    expect(j.ok ? "ok" : j.fehler).toBe("ok");
  }, 900_000);

  it("uploads the archive below the installation's prefix with its own access", async () => {
    const r = await auftrag(ABWICKLUNG_AKTIONEN.archiv, "archiv", {
      argumente: { region: REGION },
      zeitlimitS: 3600,
    });
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    const gemeldet = (r.daten?.objekte ?? []) as { datei: string; bytes: number }[];
    expect(gemeldet.map((o) => o.datei)).toContain("volume-daten.tar");
    const archiv = await objekte(`${praefix}archiv/`, ADMIN, MINIO_PORT);
    expect(archiv).toEqual(gemeldet.map((o) => `${praefix}archiv/${o.datei}`).sort());
    const tar = await s3Anfrage(
      zugang,
      "GET",
      `/${praefix}archiv/volume-daten.tar`,
      {},
      MINIO_PORT,
    );
    expect(tar.status).toBe(200);
    expect(tar.text).toContain("beispiel.db");
    // nothing of the archive is left in the user's home
    expect(
      lauf(["sudo", "-n", "find", `/home/sz-${K}/.cache/steuerzentrale/archiv`, "-type", "f"]).aus,
    ).toBe("");
  }, 900_000);

  it("takes the installation down: no Linux user and no home afterwards", async () => {
    const r = await auftrag(ABWICKLUNG_AKTIONEN.loeschen, "loeschen");
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    expect(lauf(["id", "-u", `sz-${K}`]).code).not.toBe(0);
    expect(lauf(["sudo", "-n", "test", "-e", `/home/sz-${K}`]).code).not.toBe(0);
    expect(
      (await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => undefined))?.status,
    ).not.toBe(200);
  }, 600_000);

  it("leaves no object below the prefix after the Zentrale's step, and none outside it deleted", async () => {
    await ablegen(nachbar, new Uint8Array(new TextEncoder().encode("fremd")));
    expect((await objekte(praefix, ADMIN, MINIO_PORT)).length).toBeGreaterThan(0);
    const r = await praefixLoeschen(
      {
        fetch,
        endpunkt: `http://127.0.0.1:${MINIO_PORT}`,
        region: REGION,
        bucket: BUCKET,
        zugang: { accessKey: zugang.schluesselId, secretKey: zugang.geheim },
        jetzt: Date.now,
      },
      praefix,
    );
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    expect(await objekte(praefix, ADMIN, MINIO_PORT)).toEqual([]);
    expect(await objekte(`b-test/${K}x/`, ADMIN, MINIO_PORT)).toEqual([nachbar]);
  }, 300_000);
});
