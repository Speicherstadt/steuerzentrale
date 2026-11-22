import { randomBytes } from "node:crypto";
import { HOST, type OeffentlicherSchluessel } from "@steuerzentrale/manifest";
import { bewertungJetzt } from "@steuerzentrale/planung";
import type { Context } from "hono";
import { z } from "zod";
import { standVon, verlaufLesen } from "../modules/bewertung/index.ts";
import {
  angeboteneAktionen,
  auftraegeDerInstallation,
  hochgeladenesManifest,
  type Installation,
  type InstallationsDeps,
  installationAnlegen,
  installationEntfernen,
  installationenListe,
  installationKonfigurieren,
  installationLesen,
  installationsFormular,
  platzPruefen,
} from "../modules/installationen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import { einstellungsWerte } from "./einstellungen.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Installations (BAULISTE.md Z-402): every role reads, owner and technik make and remove
 * (src/auth/rollen.ts); every write names its reason in `grund`. The dialog asks for the placement
 * first (a preview that writes nothing), then makes the installation with the same input. No
 * answer carries a secret: the encrypted column stays in the Zentrale. Each installation comes with
 * its state (Z-403), unknown 90 s after the last report, the page also with its history and the
 * form of its settings, with which "Einstellungen ändern" configures it anew (Z-404), and which
 * actions its manifest offers (Z-405, routes/aktionen.ts).
 */

const id = z.string().min(1).max(200);
const grund = z.string().trim().min(1).max(500);
const wunsch = {
  kundeId: id,
  serverId: id,
  // the manifest's exact text: never trimmed, its bytes are what the signature signs
  manifest: z
    .string()
    .min(1)
    .max(512 * 1024),
  signatur: z.string().min(1).max(4000),
  optionen: z.array(z.string().min(1).max(100)).max(50).default([]),
};
const platzierungSchema = z.object(wunsch).strict();
const anlegenSchema = z
  .object({
    ...wunsch,
    host: z.string().regex(HOST, "a lowercase host name with a dot"),
    einstellungen: einstellungsWerte.default({}),
    betreiberWerte: einstellungsWerte.default({}),
    grund,
  })
  .strict();
const grundSchema = z.object({ grund }).strict();
const konfigurierenSchema = z.object({ einstellungen: einstellungsWerte, grund }).strict();

const STATUS: Record<string, 400 | 404 | 409 | 422 | 500 | 503> = {
  kein_kunde: 404,
  kein_server: 404,
  keine_installation: 404,
  server_gesperrt: 409,
  passt_nicht: 409,
  host_vergeben: 409,
  keine_ports: 409,
  nicht_gescheitert: 409,
  entfernen_laeuft: 409,
  laeuft_nicht: 409,
  sperrzeit: 409,
  auftrag_offen: 409,
  einstellung_ungueltig: 400,
  signatur_ungueltig: 422,
  manifest_ungueltig: 422,
  nicht_einrichtbar: 422,
  kein_schluessel: 503,
};

type Fehler = { grund: string; detail?: string | undefined; gruende?: unknown };

const fehler = (c: Context<Anfrage>, f: Fehler) =>
  c.json(
    {
      fehler: f.grund,
      ...(f.detail === undefined ? {} : { detail: f.detail }),
      ...(f.gruende === undefined ? {} : { gruende: f.gruende }),
    },
    STATUS[f.grund] ?? 500,
  );

type Unit = { name: string; aktiv: string };

/** The rating at `jetzt` with the units of the last report (packages/planung, bewertung.ts) */
const healthAntwort = (i: Installation, jetzt: number) => {
  const { bewertung, grund, seit, gemeldetAm } = bewertungJetzt(standVon(i), jetzt);
  const meldung = JSON.parse(i.meldung ?? "{}") as { units?: Unit[] };
  return { zustand: bewertung, grund, seit, gemeldetAm, units: meldung.units ?? [] };
};

/** An installation as the API shows it: never the encrypted column, manifest or signature */
export const installationAntwort = (i: Installation, jetzt: number) => ({
  installationId: i.installationId,
  kundeId: i.kundeId,
  serverId: i.serverId,
  app: i.app,
  version: i.version,
  manifestHash: i.manifestHash,
  host: i.host,
  httpPort: i.httpPort,
  ports: JSON.parse(i.ports) as Record<string, number>,
  optionen: JSON.parse(i.optionen) as string[],
  einstellungen: JSON.parse(i.einstellungen) as unknown,
  zustand: i.zustand,
  health: healthAntwort(i, jetzt),
  angelegtVon: i.angelegtVon,
  angelegtAm: i.angelegtAm,
  geaendertAm: i.geaendertAm,
});

/** The installation's jobs with their state, the last step and, for a failed one, its reason */
const auftraegeAntwort = (deps: RoutenDeps, i: Installation) =>
  auftraegeDerInstallation(deps.db, i.betreiberId, i.installationId).map((a) => {
    const ergebnis = a.ergebnis
      ? (JSON.parse(a.ergebnis) as { ok: boolean; fehler?: string })
      : null;
    return {
      auftragId: a.auftragId,
      aktion: a.aktion,
      zustand: a.zustand,
      fortschritt: a.fortschritt,
      fehler: ergebnis && !ergebnis.ok ? (ergebnis.fehler ?? null) : null,
      angelegtAm: a.angelegtAm,
      geaendertAm: a.geaendertAm,
    };
  });

export const installationenRouten = (route: Registrar, deps: RoutenDeps): void => {
  const modul: InstallationsDeps = {
    ...deps,
    zufall: (n) => new Uint8Array(randomBytes(n)),
    verbunden: (b, s) => deps.verbindungen.verbundenSeit(b, s) !== undefined,
  };
  const kontext = (c: Context<Anfrage>, begruendung: string) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund: begruendung,
  });
  const ungueltig = (c: Context<Anfrage>) => c.json({ fehler: "ungueltig" }, 400);
  const schluessel = (): Promise<OeffentlicherSchluessel | undefined> =>
    deps.auslieferung.manifestSchluessel();
  const installationId = (c: Context<Anfrage>) => c.req.param("installationId") ?? "";
  /** The page of an installation: with its jobs and the history of its state */
  const seite = (i: Installation) => ({
    ...installationAntwort(i, deps.now()),
    auftraege: auftraegeAntwort(deps, i),
    verlauf: verlaufLesen(deps.db, i.betreiberId, i.installationId),
    formular: installationsFormular(deps.schluessel, i),
    aktionen: angeboteneAktionen(i),
  });

  route("GET /api/v1/installationen", (c) =>
    c.json({
      installationen: installationenListe(deps.db, c.get("betreiberId")).map((i) =>
        installationAntwort(i, deps.now()),
      ),
    }),
  );

  route("GET /api/v1/installationen/:installationId", (c) => {
    const i = installationLesen(deps.db, c.get("betreiberId"), installationId(c));
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json(seite(i));
  });

  route("POST /api/v1/installationen/platzierung", async (c) => {
    const angaben = await eingabe(c, platzierungSchema);
    if (!angaben) return ungueltig(c);
    const key = await schluessel();
    if (!key) return fehler(c, { grund: "kein_schluessel" });
    const geprueft = hochgeladenesManifest(key, angaben.manifest, angaben.signatur);
    if (!geprueft.ok) return fehler(c, geprueft);
    const platz = platzPruefen(modul, c.get("betreiberId"), {
      ...angaben,
      manifest: geprueft.manifest,
    });
    if (!platz.ok) return fehler(c, platz);
    return c.json({ platzierung: platz.platzierung });
  });

  route("POST /api/v1/installationen", async (c) => {
    const angaben = await eingabe(c, anlegenSchema);
    if (!angaben) return ungueltig(c);
    const key = await schluessel();
    if (!key) return fehler(c, { grund: "kein_schluessel" });
    const { grund: begruendung, ...neu } = angaben;
    const angelegt = installationAnlegen(modul, kontext(c, begruendung), key, neu);
    if (!angelegt.ok) return fehler(c, angelegt);
    return c.json(installationAntwort(angelegt.installation, deps.now()), 201);
  });

  // Only an installation whose setup failed (Z-402); one that was set up goes with Z-604
  route("DELETE /api/v1/installationen/:installationId", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, angaben.grund);
    const entfernt = installationEntfernen(modul, k, installationId(c));
    if (!entfernt.ok) return fehler(c, entfernt);
    const i = installationLesen(deps.db, k.betreiberId, installationId(c)) as Installation;
    return c.json(seite(i));
  });

  // "Einstellungen ändern" (Z-404): the values asked for apply once the agent reports success
  route("PUT /api/v1/installationen/:installationId/einstellungen", async (c) => {
    const angaben = await eingabe(c, konfigurierenSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, angaben.grund);
    const konfiguriert = installationKonfigurieren(
      modul,
      k,
      installationId(c),
      angaben.einstellungen,
    );
    if (!konfiguriert.ok) return fehler(c, konfiguriert);
    const i = installationLesen(deps.db, k.betreiberId, installationId(c)) as Installation;
    return c.json(seite(i));
  });
};
