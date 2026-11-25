import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type OeffentlicherSchluessel, schluesselLesen } from "@steuerzentrale/manifest";
import { VOM_AGENTEN_V1 } from "../../../../packages/protokoll/src/beispiele-v1.ts";
import { schreiben } from "../modules/audit/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import type { InstallationsDeps, NeueInstallation } from "../modules/installationen/index.ts";
import { manifestImportieren } from "../modules/manifeste/index.ts";
import { auftragsUmgebung } from "./auftraege.ts";

/*
 * For the tests of installing (Z-402): the job environment with customers, server facts and the
 * operator's values for an app, and two manifests signed with the public test key
 * (testhilfen/manifeste/), the key install.sh hands the agents in tests; `gesperrt` is `probe`
 * with a freeze window (Z-404), `aktionen` with "nur lesen" and without restart (Z-405),
 * `gesichert` with two parts to back up (Z-601), the versions of probe of Z-501 (testhilfen/
 * manifeste.ts), the newer versions of `gesichert` an update goes to (`update-…`, Z-503). An
 * installation is made from an imported manifest (Z-501): `bereit` imports one, and since the variants of probe are all version 1.0.0, a test imports only the one it installs.
 */
const ORDNER = join(import.meta.dirname, "manifeste");
const REPO = join(import.meta.dirname, "../../../..");

export type Testmanifest =
  | "probe"
  | "stumm"
  | "gesperrt"
  | "aktionen"
  | "gesichert"
  | "gesichert-gesperrt"
  | "probe-1.1.0"
  | "probe-1.2.0"
  | "probe-1.10.0"
  | "probe-2.0.0-rc.1"
  | "probe-2.0.0"
  | "probe-anders"
  | "probe-01.0.0"
  | "update-1.3.0"
  | "update-pflicht"
  | "update-ohne-health"
  | "update-dringend"
  | "update-teile"
  | "update-neuer-teil"
  | "kaputt";

export const signiert = (app: Testmanifest) => ({
  manifest: readFileSync(join(ORDNER, `${app}.yml`), "utf8"),
  signatur: readFileSync(join(ORDNER, `${app}.yml.minisig`), "utf8"),
});

/** The database file and its write-ahead log, as bytes an attacker with the disk would read */
export const dateiInhalt = (pfad: string): string =>
  [pfad, `${pfad}-wal`]
    .map((datei) => {
      try {
        return readFileSync(datei).toString("latin1");
      } catch {
        return "";
      }
    })
    .join("");

export const TEST_SCHLUESSEL = schluesselLesen(
  readFileSync(join(REPO, "test/schluessel/test.pub"), "utf8"),
) as OeffentlicherSchluessel;

/** The secret values of the tests, searched for wherever no secret may stand */
export const LIZENZ = "lizenz-des-betreibers-7f3a91";
export const KENNWORT = "kennwort-der-installation-2c8e44";

/** The facts of a server as its agent reports them (packages/protokoll, beispiele-v1.ts) */
export const FAKTEN = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") as Record<string, unknown>;

export const neueInstallation = (teil: Partial<NeueInstallation> = {}): NeueInstallation => ({
  kundeId: "k1",
  serverId: "s1",
  app: "probe",
  version: "1.0.0",
  optionen: [],
  host: "probe.kunde.example",
  einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
  ...teil,
});

export const installationsUmgebung = () => {
  const u = auftragsUmgebung();
  const deps: InstallationsDeps = {
    ...u.deps,
    zufall: (n) => new Uint8Array(randomBytes(n)),
    verbunden: (b, s) => u.deps.verbindungen.verbundenSeit(b, s) !== undefined,
  };

  /** A customer with its contract */
  const kunde = (betreiberId: string, kundeId: string) =>
    schreiben(u.schreibDb, u.kontext(betreiberId), "test", (w) => {
      w.einfuegen("kunden", {
        betreiberId,
        kundeId,
        name: kundeId,
        kontaktName: "Kim",
        kontaktEmail: "kim@kunde.test",
        kuerzel: kundeId,
        angelegtAm: u.uhr.ms,
      });
      w.einfuegen("vertraege", {
        betreiberId,
        vertragId: `v-${kundeId}`,
        kundeId,
        beginn: u.uhr.ms,
        angelegtAm: u.uhr.ms,
      });
    });

  /** The server's newest facts, changed by `teil` */
  const fakten = (betreiberId: string, serverId: string, teil: Record<string, unknown> = {}) =>
    schreiben(u.schreibDb, u.kontext(betreiberId), "test", (w) =>
      w.aendern(
        "server",
        { serverId },
        { fakten: JSON.stringify({ ...FAKTEN, ...teil }), faktenAm: u.uhr.ms },
      ),
    );

  /** A value of the operator for an app; a secret one encrypted, as Z-404 will write it */
  const betreiberWert = (
    betreiberId: string,
    app: string,
    name: string,
    wert: string | number | boolean,
    geheim = false,
  ) =>
    schreiben(u.schreibDb, u.kontext(betreiberId), "test", (w) =>
      w.einfuegen("appEinstellungen", {
        betreiberId,
        app,
        name,
        wert: geheim ? null : JSON.stringify(wert),
        wertVerschluesselt: geheim
          ? spalteVerschluesseln(
              u.schluessel,
              "appEinstellungen",
              betreiberId,
              { app, name },
              JSON.stringify(wert),
            )
          : null,
        geaendertAm: u.uhr.ms,
      }),
    );

  /** Imports a test manifest (Z-501), as an owner of `betreiberId` would; the same one again is a no-op */
  const manifest = (name: Testmanifest, betreiberId = "b1") => {
    const r = manifestImportieren(
      u,
      u.kontext(betreiberId),
      TEST_SCHLUESSEL,
      signiert(name),
      "betreiber",
    );
    if (!r.ok) throw new Error(`${name}: ${r.grund} ${r.detail ?? ""}`);
    return { app: r.eintrag.app, version: r.eintrag.version };
  };

  /**
   * An operator with a customer `k1`, server `s1` with facts and connected agent, and its value;
   * the manifest `manifest` imported, none with null
   */
  const bereit = (betreiberId = "b1", mit: Testmanifest | null = "probe") => {
    u.betreiber(betreiberId, "s1");
    kunde(betreiberId, "k1");
    fakten(betreiberId, "s1");
    betreiberWert(betreiberId, "probe", "PROBE_LIZENZ", LIZENZ, true);
    if (mit) manifest(mit, betreiberId);
    return u.verbinden(betreiberId, "s1");
  };

  return { ...u, deps, kunde, fakten, betreiberWert, manifest, bereit };
};
