import { manifestPruefen } from "@steuerzentrale/manifest";
import { angeboteneVersionen, istVorabversion, versionVergleichen } from "@steuerzentrale/planung";
import type { Fehlschlag } from "../anmeldung/api.ts";
import type {
  AppDerZentrale,
  AppsQuelle,
  AppVersion,
  ImportAntwort,
  ManifestDerZentrale,
  UpdateStand,
} from "../daten/apps.ts";
import type { Manifest } from "../daten/typen.ts";
import { apps } from "./apps.ts";
import { installationen } from "./installationen.ts";
import { kunden } from "./kunden.ts";
import { PROBE_MANIFEST, PROBE_VORAB } from "./probe-manifest.ts";
import { JETZT } from "./zeit.ts";

/*
 * The imported manifests and the registries' versions of the demo in memory, answering as the
 * Zentrale's API would (apps/zentrale, routes/manifeste.ts): the eight apps with the version their
 * manifest in manifeste/ names and, for Kontext, a newer one only the registry has; the probe app of
 * the dialog's tests with its text, also as a pre-release. The demo has no public key: an import
 * needs only some signature and a manifest that reads. An update by hand (Z-503) stays at its
 * backup: the demo has no agent. A change lasts until the page reloads.
 */

type Eintrag = { app: string; version: string; text: string | null; dringend: boolean };

const ok = <T>(daten: T, status = 200) => ({ ok: true, status, daten }) as const;
const nein = (status: number, fehler: string, detail?: string): Fehlschlag => ({
  ok: false,
  status,
  fehler,
  ...(detail ? { detail } : {}),
});

const ausText = (text: string): Eintrag => {
  const g = manifestPruefen(text);
  if (!g.ok) throw new Error(g.fehler.join("; "));
  return { app: g.manifest.id, version: g.manifest.version, text, dringend: g.manifest.dringend };
};

/** The apps' manifests of the demo: no text, the dialog cannot read their form */
const ausBeschreibung = (a: Manifest): Eintrag[] =>
  a.version ? [{ app: a.id, version: a.version, text: null, dringend: false }] : [];

const START: Eintrag[] = [
  ...apps.flatMap(ausBeschreibung),
  ausText(PROBE_MANIFEST),
  ausText(PROBE_VORAB),
];

/** What the registries listed at the demo's morning: the newer tag of an app without manifest */
const registry = (a: Manifest) => ({
  abgefragtAm: JETZT - 2 * 3_600_000,
  image: `ghcr.io/speicherstadt/${a.id}`,
  versionen: [a.ohneManifest, a.version].filter((v): v is string => Boolean(v)),
  fehler: null,
});

const version = (e: Eintrag, am: number): AppVersion => ({
  version: e.version,
  zustand: "verfuegbar",
  dringend: e.dringend,
  vorabversion: istVorabversion(e.version),
  sha256: "0".repeat(64),
  importiert: { am, durch: "befehl" },
});

const fehlt = (v: string): AppVersion => ({
  version: v,
  zustand: "manifest_fehlt",
  dringend: false,
  vorabversion: istVorabversion(v),
  sha256: null,
  importiert: null,
});

const KEIN_UPDATE: UpdateStand = { letzter: null, laeuft: false };

export const demoAppsQuelle = (jetzt: () => number): AppsQuelle => {
  let liste: Eintrag[] = START;
  const updates = new Map<string, UpdateStand>();
  const beschreibung = (app: string) => apps.find((a) => a.id === app);
  const appsJetzt = (): AppDerZentrale[] =>
    [...new Set(liste.map((e) => e.app))].sort().map((app) => {
      const eigene = liste.filter((e) => e.app === app);
      const b = beschreibung(app);
      const neu = b?.ohneManifest && !eigene.some((e) => e.version === b.ohneManifest);
      const versionen = [
        ...eigene.map((e) => version(e, JETZT)),
        ...(neu && b.ohneManifest ? [fehlt(b.ohneManifest)] : []),
      ].sort((x, y) => versionVergleichen(y.version, x.version));
      return { app, versionen, registry: b ? registry(b) : null };
    });

  const importieren: AppsQuelle["importieren"] = async (eingabe) => {
    if (!eingabe.signatur.trim()) return nein(422, "signatur_ungueltig");
    const g = manifestPruefen(eingabe.manifest);
    if (!g.ok) return nein(422, "manifest_ungueltig", g.fehler.join("; "));
    const { id: app, version: v, dringend } = g.manifest;
    const vorhanden = liste.find((e) => e.app === app && e.version === v);
    if (vorhanden && vorhanden.text !== eingabe.manifest) return nein(409, "version_vergeben");
    if (!vorhanden) liste = [...liste, { app, version: v, text: eingabe.manifest, dringend }];
    const antwort: ImportAntwort = {
      neu: !vorhanden,
      app,
      version: v,
      dringend,
      vorabversion: istVorabversion(v),
      sha256: "0".repeat(64),
      importiert: { am: jetzt(), durch: "mitglied", nutzerId: "demo" },
    };
    return ok(antwort, vorhanden ? 200 : 201);
  };

  return {
    liste: async () => ok(appsJetzt()),
    manifest: async (app, v) => {
      const e = liste.find((x) => x.app === app && x.version === v && x.text !== null);
      if (!e?.text) return nein(404, "kein_manifest");
      const m: ManifestDerZentrale = {
        app,
        version: e.version,
        text: e.text,
        sha256: "0".repeat(64),
        dringend: e.dringend,
        vorabversion: istVorabversion(e.version),
        importiert: { am: JETZT, durch: "befehl" },
      };
      return ok(m);
    },
    importieren,
    abfragen: async () => ok(appsJetzt()),
    angebote: async () =>
      ok(
        installationen.map((i) => {
          const intern = kunden.find((k) => k.id === i.kunde)?.intern ?? false;
          const eigene = liste.filter((e) => e.app === i.app);
          return {
            installationId: i.id,
            kundeId: i.kunde,
            app: i.app,
            version: i.version,
            intern,
            angeboten: angeboteneVersionen({ version: i.version, intern }, eigene),
            plan: null,
            update: updates.get(i.id) ?? KEIN_UPDATE,
          };
        }),
      ),
    update: async (installationId, version, grund) => {
      const i = installationen.find((x) => x.id === installationId);
      if (!i) return nein(404, "keine_installation");
      if (!grund.trim()) return nein(400, "ungueltig");
      if (updates.get(installationId)?.laeuft) return nein(409, "auftrag_offen");
      if (!liste.some((e) => e.app === i.app && e.version === version))
        return nein(422, "kein_manifest");
      updates.set(installationId, {
        laeuft: true,
        letzter: {
          vonVersion: i.version,
          nachVersion: version,
          anlass: "hand",
          welle: null,
          sperrzeitUebergangen: false,
          angefordertAm: jetzt(),
          phase: "sichern",
          endeAm: null,
          fehler: null,
          dauerMs: null,
        },
      });
      const auftrag = (n: number) => ({
        auftragId: `demo-update-${installationId}-${n}`,
        zustand: "zugestellt",
      });
      return ok({ backup: auftrag(1), update: { ...auftrag(2), zustand: "wartend" } }, 201);
    },
  };
};
