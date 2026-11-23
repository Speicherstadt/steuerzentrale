import type { BackupPolicy } from "@steuerzentrale/manifest";
import { sha256Hex, signieren } from "@steuerzentrale/manifest";
import { madminVerschluesseln } from "./madmin-daten.ts";

/*
 * The two calls of MinIO's admin API the Zentrale makes (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel
 * und Zugang je Installation (Z-601)"), with the `fetch` passed in, so the tests run them against
 * the stand-in in testhilfen/minio.ts. Source: minio/madmin-go, user-commands.go (AddServiceAccount,
 * DeleteServiceAccount; commit 98483d3c6f42) and minio/minio, cmd/admin-handlers-users.go:
 *
 * - PUT /minio/admin/v3/add-service-account, the JSON `{ policy, accessKey, secretKey, name,
 *   description }` encrypted with the admin's secret key (madmin-daten.ts); 200 on success. The
 *   Zentrale chooses access and secret key itself, so it never needs to read the encrypted answer.
 * - DELETE /minio/admin/v3/delete-service-account?accessKey=…; 204, or 404 with the code
 *   `XMinioInvalidIAMCredentials` for one that does not exist, which counts as deleted.
 *
 * Every request is signed with the admin's access (sigv4.ts). The secret keys go only into the
 * signature and the encrypted body: they are replaced in every error text, so no log, event or
 * answer can carry them.
 */

const ZEITLIMIT_MS = 10_000;
const FEHLER_MAX = 300;
const NICHT_GEFUNDEN = "XMinioInvalidIAMCredentials";

export type S3Zugang = { accessKey: string; secretKey: string };

export type MinioZiel = {
  fetch: typeof fetch;
  endpunkt: string;
  region: string;
  admin: S3Zugang;
  jetzt: () => number;
};

export type Ergebnis = { ok: true } | { ok: false; fehler: string };

export type NeuesDienstkonto = {
  zugang: S3Zugang;
  policy: BackupPolicy;
  name: string;
  beschreibung: string;
};

/** The text with every secret replaced, cut short: what may stand in a log or an event */
export const ohneGeheimnis = (text: string, geheim: readonly string[]): string =>
  geheim
    .filter((g) => g !== "")
    .reduce((t, g) => t.split(g).join("[geheim]"), text)
    .slice(0, FEHLER_MAX);

/** MinIO's error as `HTTP <status> <Code>: <Message>` */
const fehlerText = async (antwort: Response): Promise<string> => {
  const roh = (await antwort.json().catch(() => null)) as { Code?: unknown; Message?: unknown };
  const code = typeof roh?.Code === "string" ? ` ${roh.Code}` : "";
  const text = typeof roh?.Message === "string" ? `: ${roh.Message}` : "";
  return `HTTP ${antwort.status}${code}${text}`;
};

const aufruf = async (
  ziel: MinioZiel,
  methode: "PUT" | "DELETE",
  pfad: string,
  koerper: Uint8Array<ArrayBuffer>,
  erfolg: (antwort: Response) => Promise<boolean>,
  geheim: readonly string[],
): Promise<Ergebnis> => {
  const nein = (text: string) => ({ ok: false, fehler: ohneGeheimnis(text, geheim) }) as const;
  try {
    const url = new URL(`${ziel.endpunkt.replace(/\/+$/, "")}/minio/admin/v3/${pfad}`);
    const koepfe = await signieren({
      methode,
      url,
      inhaltHash: await sha256Hex(koerper),
      zugang: ziel.admin,
      region: ziel.region,
      jetzt: ziel.jetzt(),
    });
    const antwort = await ziel.fetch(url, {
      method: methode,
      headers: koepfe,
      ...(koerper.length > 0 ? { body: koerper } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    if (await erfolg(antwort)) return { ok: true };
    return nein(await fehlerText(antwort));
  } catch (fehler) {
    return nein(String(fehler));
  }
};

/** Makes the service account under the admin, with the policy that limits it to one prefix */
export const dienstkontoAnlegen = async (
  ziel: MinioZiel,
  neu: NeuesDienstkonto,
): Promise<Ergebnis> => {
  const json = JSON.stringify({
    policy: neu.policy,
    accessKey: neu.zugang.accessKey,
    secretKey: neu.zugang.secretKey,
    name: neu.name,
    description: neu.beschreibung,
  });
  const geheim = [ziel.admin.secretKey, neu.zugang.secretKey];
  const koerper = await madminVerschluesseln(ziel.admin.secretKey, json);
  return aufruf(ziel, "PUT", "add-service-account", koerper, async (a) => a.status === 200, geheim);
};

/** Deletes the service account; one that is not there counts as deleted */
export const dienstkontoLoeschen = (ziel: MinioZiel, accessKey: string): Promise<Ergebnis> =>
  aufruf(
    ziel,
    "DELETE",
    `delete-service-account?${new URLSearchParams({ accessKey })}`,
    new Uint8Array(0),
    async (a) => {
      if (a.status === 204) return true;
      if (a.status !== 404) return false;
      const roh = (await a
        .clone()
        .json()
        .catch(() => null)) as { Code?: unknown } | null;
      return roh?.Code === NICHT_GEFUNDEN;
    },
    [ziel.admin.secretKey],
  );
