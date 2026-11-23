import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { Archive } from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import type { Fehlschlag } from "../anmeldung/api.ts";
import { type BackupsDerInstallation, backupQuelle } from "../daten/backups.ts";
import { type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";
import { Ergebnis, laufTeilText, teileText, zugangText } from "./backup-teile.tsx";

/*
 * The backups of one installation (BAULISTE.md Z-601; mockup, installation page, tab "Backups" and
 * "Backup jetzt"): the parts of its manifest, where its own S3 access stands and the runs its agent
 * reported, newest first, each part with its snapshot; "Backup jetzt" with a reason for owner and
 * technik once its backups are set up. Read anew whenever the page is (`a` changes).
 */

const FEHLER: Record<string, () => string> = {
  nicht_eingerichtet: m.aktion_fehler_nicht_eingerichtet,
  backup_laeuft: m.aktion_fehler_backup_laeuft,
  laeuft_nicht: m.aktion_fehler_laeuft_nicht,
  nicht_ausfuehrbar: m.aktion_fehler_nicht_ausfuehrbar,
};

const fehlerVon = (f: Fehlschlag) => (FEHLER[f.fehler] ?? (() => fehlerText(f)))();

/** The installation's backups, read again whenever the page is */
const backupsLaden = (a: () => InstallationAnsicht) =>
  createMemo(() => backupQuelle().derInstallation(a().id));

const Laeufe = (props: { b: BackupsDerInstallation }) => (
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
        </Reihe>
      )}
    </For>
  </Tabelle>
);

export const InstallationBackups = (props: { a: InstallationAnsicht }) => {
  const antwort = backupsLaden(() => props.a);
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
                  <Angaben zeilen={[{ name: m.inst_backup_stand(), wert: zugangText(b()) }]} />
                </KartenInhalt>
                <div class="border-t">
                  <Laeufe b={b()} />
                </div>
              </Show>
            </>
          )}
        </Show>
      </Loading>
    </Karte>
  );
};

const JetztDialog = (props: {
  a: InstallationAnsicht;
  open: boolean;
  onClose: () => void;
  angefordert: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await backupQuelle().jetzt(props.a.id, werte.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort));
    setFehler("");
    props.angefordert();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={m.aktion_backup()}
      description={m.aktion_backup_text({ name: titelVon(props.a) })}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.aktion_backup_grund_platzhalter()}
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

/**
 * "Backup jetzt" for an installation whose backups are set up; `neu` once the job is made, so the
 * page reads it again
 */
export const BackupJetzt = (props: { a: InstallationAnsicht; neu: () => void }) => {
  const antwort = backupsLaden(() => props.a);
  const [offen, setOffen] = createSignal(false);
  const [hinweis, setHinweis] = createSignal("");
  const eingerichtet = () => {
    const r = antwort();
    return r.ok && r.daten.eingerichtet;
  };
  return (
    <Loading fallback={null}>
      <Show when={eingerichtet()}>
        <Button onClick={() => setOffen(true)}>
          <Icon icon={Archive} />
          {m.aktion_backup()}
        </Button>
        <JetztDialog
          a={props.a}
          open={offen()}
          onClose={() => setOffen(false)}
          angefordert={() => {
            setOffen(false);
            setHinweis(m.aktion_backup_angefordert());
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
