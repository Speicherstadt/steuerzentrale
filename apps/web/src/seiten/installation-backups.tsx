import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { Archive, ArchiveRestore } from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import type { Antwort, Fehlschlag } from "../anmeldung/api.ts";
import {
  type BackupAuftrag,
  type BackupLauf,
  type BackupsDerInstallation,
  backupQuelle,
} from "../daten/backups.ts";
import { type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";
import {
  Ergebnis,
  laufTeilText,
  PruefZustand,
  pruefTeilText,
  teileText,
  zugangText,
} from "./backup-teile.tsx";
import {
  WiederherstellenDialog,
  WiederherstellenKnopf,
  WiederherstellenZustand,
  wiederherstellbar,
} from "./installation-wiederherstellen.tsx";
import { installationsRecht } from "./recht.tsx";

/*
 * The backups of one installation (BAULISTE.md Z-601; mockup, installation page, tab "Backups" and
 * "Backup jetzt"): the parts of its manifest, where its own S3 access stands and the runs its agent
 * reported, newest first, each part with its snapshot, and its newest test restore (Z-602) with the
 * snapshot each part was restored from, and its newest restore (Z-603); "Backup jetzt" with a reason
 * for owner and technik once its backups are set up, "Prüf-Restore jetzt" once a run succeeded, and
 * beside each successful run its restore (installation-wiederherstellen.tsx). Read anew whenever
 * the page is (`a` changes) and once a restore is asked for.
 */

const FEHLER: Record<string, () => string> = {
  nicht_eingerichtet: m.aktion_fehler_nicht_eingerichtet,
  backup_laeuft: m.aktion_fehler_backup_laeuft,
  laeuft_nicht: m.aktion_fehler_laeuft_nicht,
  nicht_ausfuehrbar: m.aktion_fehler_nicht_ausfuehrbar,
  kein_backup: m.aktion_fehler_kein_backup,
  auftrag_offen: m.inst_fehler_auftrag_offen,
  server_belegt: m.aktion_fehler_server_belegt,
  kein_platz: m.aktion_fehler_kein_platz,
  keine_ports: m.aktion_fehler_keine_ports,
};

const fehlerVon = (f: Fehlschlag) => (FEHLER[f.fehler] ?? (() => fehlerText(f)))();

/** The installation's backups, read again whenever the page is */
const backupsLaden = (a: () => InstallationAnsicht) =>
  createMemo(() => backupQuelle().derInstallation(a().id));

/** The runs; with the right to restore, a column with the button of each run that can be */
const Laeufe = (props: {
  a: InstallationAnsicht;
  b: BackupsDerInstallation;
  darf: boolean;
  waehlen: (lauf: BackupLauf) => void;
}) => (
  <Tabelle
    name={m.inst_backup_laeufe()}
    rahmen={false}
    minBreite={560}
    leer={m.inst_backup_keine_laeufe()}
    anzahl={props.b.laeufe.length}
    spalten={[
      { name: m.inst_zeitpunkt() },
      { name: m.inst_backup_ergebnis() },
      { name: m.bak_spalte_snapshots() },
      ...(props.darf ? [{ name: m.wh_spalte(), class: "sr-only" }] : []),
    ]}
  >
    <For each={props.b.laeufe}>
      {(lauf) => (
        <Reihe>
          <td class="tabular-nums">{zeitpunkt(lauf.zeitpunkt, bestand().jetzt)}</td>
          <td>
            <Ergebnis lauf={lauf} />
          </td>
          <td class="font-mono text-xs">{lauf.teile.map(laufTeilText).join(", ") || "–"}</td>
          <Show when={props.darf}>
            <td class="text-right">
              <WiederherstellenKnopf
                lauf={lauf}
                angeboten={wiederherstellbar(props.a, props.b, lauf)}
                waehlen={(l) => props.waehlen(l)}
              />
            </td>
          </Show>
        </Reihe>
      )}
    </For>
  </Tabelle>
);

/** Where the backups stand and the newest test restore with what it restored and how long it took */
const angaben = (b: BackupsDerInstallation) => {
  const letzter = b.pruefRestore.letzter;
  return [
    { name: m.inst_backup_stand(), wert: zugangText(b) },
    { name: m.inst_pruef(), wert: <PruefZustand p={b.pruefRestore} jetzt={bestand().jetzt} /> },
    ...(letzter && letzter.teile.length > 0
      ? [
          {
            name: m.pruef_zurueckgespielt(),
            wert: (
              <span class="font-mono text-xs">{letzter.teile.map(pruefTeilText).join(", ")}</span>
            ),
          },
        ]
      : []),
    ...(b.wiederherstellen.letzter
      ? [{ name: m.wh_name(), wert: <WiederherstellenZustand w={b.wiederherstellen} /> }]
      : []),
    ...(letzter?.dauerMs != null
      ? [
          {
            name: m.pruef_dauer_name(),
            wert: m.pruef_dauer({ dauer: Math.round(letzter.dauerMs / 1000) }),
          },
        ]
      : []),
  ];
};

export const InstallationBackups = (props: { a: InstallationAnsicht }) => {
  const antwort = backupsLaden(() => props.a);
  const darf = installationsRecht();
  const [gewaehlt, setGewaehlt] = createSignal<BackupLauf | undefined>();
  const [hinweis, setHinweis] = createSignal("");
  const gelesen = () => {
    const r = antwort();
    return r.ok ? r.daten : undefined;
  };
  const fehler = () => {
    const r = antwort();
    return r.ok ? "" : fehlerText(r);
  };
  return (
    <Karte class="overflow-hidden">
      <Loading fallback={<p class="p-6 text-muted-foreground">{m.bak_laden()}</p>}>
        <Show when={gelesen()} fallback={<Fehler text={fehler()} />}>
          {(b) => (
            <>
              <KartenKopf
                titel={m.inst_backup_titel()}
                text={
                  b().teile.length > 0
                    ? m.inst_backup_teile({ teile: teileText(b().teile) })
                    : m.inst_backup_ohne_teile()
                }
              />
              <Show when={b().teile.length > 0}>
                <KartenInhalt>
                  <Angaben zeilen={angaben(b())} />
                </KartenInhalt>
                <div class="border-t">
                  <Laeufe a={props.a} b={b()} darf={darf()} waehlen={(l) => setGewaehlt(l)} />
                </div>
                <p
                  role="status"
                  class={[
                    "border-t px-5 py-3 text-xs text-muted-foreground",
                    { hidden: !hinweis() },
                  ]}
                >
                  {hinweis()}
                </p>
                <WiederherstellenDialog
                  a={props.a}
                  lauf={gewaehlt()}
                  onClose={() => setGewaehlt(undefined)}
                  angefordert={() => {
                    setGewaehlt(undefined);
                    setHinweis(m.wh_angefordert());
                    refresh(antwort);
                  }}
                />
              </Show>
            </>
          )}
        </Show>
      </Loading>
    </Karte>
  );
};

/** What "Backup jetzt" and "Prüf-Restore jetzt" each say, send, and when they are offered */
type Art = {
  knopf: () => string;
  text: (name: string) => string;
  platzhalter: () => string;
  angefordert: () => string;
  icon: typeof Archive;
  senden: (id: string, grund: string) => Promise<Antwort<BackupAuftrag>>;
  angeboten: (b: BackupsDerInstallation) => boolean;
};

const BACKUP: Art = {
  knopf: m.aktion_backup,
  text: (name) => m.aktion_backup_text({ name }),
  platzhalter: m.aktion_backup_grund_platzhalter,
  angefordert: m.aktion_backup_angefordert,
  icon: Archive,
  senden: (id, grund) => backupQuelle().jetzt(id, grund),
  angeboten: (b) => b.eingerichtet,
};

/** Only once a run succeeded, and not while one runs (the Zentrale refuses both) */
const PRUEF: Art = {
  knopf: m.aktion_pruef,
  text: (name) => m.aktion_pruef_text({ name }),
  platzhalter: m.aktion_pruef_grund_platzhalter,
  angefordert: m.aktion_pruef_angefordert,
  icon: ArchiveRestore,
  senden: (id, grund) => backupQuelle().pruefRestore(id, grund),
  angeboten: (b) => b.eingerichtet && !b.pruefRestore.laeuft && b.laeufe.some((l) => l.ok),
};

const JetztDialog = (props: {
  a: InstallationAnsicht;
  art: Art;
  open: boolean;
  onClose: () => void;
  angefordert: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await props.art.senden(props.a.id, werte.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort));
    setFehler("");
    props.angefordert();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={props.art.knopf()}
      description={props.art.text(titelVon(props.a))}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={props.art.platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="primary" disabled={laeuft()}>
              {m.aktion_ausfuehren()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

/** The button and dialog of one kind, once the installation's backups offer it */
const Jetzt = (props: { a: InstallationAnsicht; art: Art; neu: () => void }) => {
  const antwort = backupsLaden(() => props.a);
  const [offen, setOffen] = createSignal(false);
  const [hinweis, setHinweis] = createSignal("");
  const angeboten = () => {
    const r = antwort();
    return r.ok && props.art.angeboten(r.daten);
  };
  return (
    <Loading fallback={null}>
      <Show when={angeboten()}>
        <Button onClick={() => setOffen(true)}>
          <Icon icon={props.art.icon} />
          {props.art.knopf()}
        </Button>
        <JetztDialog
          a={props.a}
          art={props.art}
          open={offen()}
          onClose={() => setOffen(false)}
          angefordert={() => {
            setOffen(false);
            setHinweis(props.art.angefordert());
            props.neu();
          }}
        />
      </Show>
      <p role="status" class={["basis-full text-xs text-muted-foreground", { hidden: !hinweis() }]}>
        {hinweis()}
      </p>
    </Loading>
  );
};

/**
 * "Backup jetzt" for an installation whose backups are set up; `neu` once the job is made, so the
 * page reads it again
 */
export const BackupJetzt = (props: { a: InstallationAnsicht; neu: () => void }) => (
  <Jetzt a={props.a} art={BACKUP} neu={() => props.neu()} />
);

/** "Prüf-Restore jetzt" (Z-602) for an installation with a successful backup run */
export const PruefRestoreJetzt = (props: { a: InstallationAnsicht; neu: () => void }) => (
  <Jetzt a={props.a} art={PRUEF} neu={() => props.neu()} />
);
