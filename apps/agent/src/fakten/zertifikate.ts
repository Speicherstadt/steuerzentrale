import { X509Certificate } from "node:crypto";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * The certificates of the Pforte (BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines Servers"), read
 * as files like every other fact: Caddy keeps its data in /data of its container (XDG_DATA_HOME of
 * the image), the named volume sz-pforte-daten of the rootless user sz-pforte
 * (packages/manifest, pforte/unit.ts), which Podman keeps under that user's storage
 * (containers-storage.conf(5): $XDG_DATA_HOME/containers/storage; volumes/<name>/_data). Each
 * certificate lies at certificates/<issuer>/<host>/<host>.crt (certmagic, StorageKeys.SiteCert),
 * the leaf first. The agent runs as root and reads them; it changes nothing there.
 */

const DATEN = "/home/sz-pforte/.local/share/containers/storage/volumes/sz-pforte-daten/_data";
export const ZERTIFIKATE = `${DATEN}/caddy/certificates`;

/** No more than the message takes (packages/protokoll, `fakten`) */
const HOECHSTENS = 1000;

/** The end of the first certificate in a PEM file, undefined when it is none */
const gueltigBis = (pem: string): number | undefined => {
  try {
    return new X509Certificate(pem).validToDate.getTime();
  } catch {
    return undefined;
  }
};

const hostsDes = async (q: FaktenQuellen, aussteller: string) =>
  ((await q.liste(`${ZERTIFIKATE}/${aussteller}`)) ?? [])
    .filter((host) => host.length > 0 && host.length <= 253)
    .map((host) => ({ host, pfad: `${ZERTIFIKATE}/${aussteller}/${host}/${host}.crt` }));

/**
 * Host and end of validity of every certificate Caddy holds; an empty list while it has none yet,
 * null when the Pforte's data cannot be read (no Pforte, or not as root)
 */
export const zertifikateLesen = async (
  q: FaktenQuellen,
): Promise<{ host: string; gueltigBis: number }[] | null> => {
  const aussteller = await q.liste(ZERTIFIKATE);
  if (aussteller === undefined) return (await q.liste(DATEN)) === undefined ? null : [];
  const dateien = (await Promise.all(aussteller.map((a) => hostsDes(q, a)))).flat();
  const gelesen = await Promise.all(
    dateien.slice(0, HOECHSTENS).map(async ({ host, pfad }) => {
      const pem = await q.lesen(pfad);
      const bis = pem === undefined ? undefined : gueltigBis(pem);
      return bis === undefined ? [] : [{ host, gueltigBis: bis }];
    }),
  );
  return gelesen.flat();
};
