import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { Fehlschlag } from "../anmeldung/api.ts";
import {
  type BackupLauf,
  type BackupsDerInstallation,
  backupQuelle,
  type WiederherstellenStand,
} from "../daten/backups.ts";
import { type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Zustand } from "../teile/zeichen.tsx";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";

/*
 * Restoring a run (BAULISTE.md Z-603; mockup, installation page, tab "Backups", "Snapshot
 * wiederherstellen?"): a button beside each successful run for owner and technik, one dialog for
 * the run chosen that asks for a reason and says plainly that the current state is backed up first,
 * then where the restore stands: backing up, playing back, succeeded or failed with its reason.
 * Offered only for a running installation whose backups are set up and while neither a restore nor
 * a test restore is under way; the Zentrale refuses everything else anyway.
 */

const FEHLER: Record<string, () => string> = {
  lauf_unbekannt: m.aktion_fehler_lauf_unbekannt,
  lauf_gescheitert: m.aktion_fehler_lauf_gescheitert,
  nicht_eingerichtet: m.aktion_fehler_nicht_eingerichtet,
  laeuft_nicht: m.aktion_fehler_laeuft_nicht,
  auftrag_offen: m.inst_fehler_auftrag_offen,
  nicht_ausfuehrbar: m.aktion_fehler_nicht_ausfuehrbar,
};

const fehlerVon = (f: Fehlschlag) => (FEHLER[f.fehler] ?? (() => fehlerText(f)))();

const zeit = (t: number) => zeitpunkt(t, bestand().jetzt);

/** Whether a run can be restored now */
export const wiederherstellbar = (
  a: InstallationAnsicht,
  b: BackupsDerInstallation,
  lauf: BackupLauf,
): boolean =>
  lauf.ok &&
  a.zustand === "laeuft" &&
  b.eingerichtet &&
  !b.wiederherstellen.laeuft &&
  !b.pruefRestore.laeuft;

/** Where the newest restore stands, in words */
export const wiederherstellenText = (w: WiederherstellenStand): string => {
  const l = w.letzter;
  if (!l) return "";
  const stand = zeit(l.laufZeitpunkt);
  if (l.phase === "sichern") return m.wh_sichern({ stand });
  if (l.phase === "zurueckspielen") return m.wh_zurueckspielen({ stand });
  const ende = zeit(l.endeAm ?? l.angefordertAm);
  return l.phase === "gelungen"
    ? m.wh_gelungen({ zeit: ende, stand })
    : m.wh_gescheitert({ zeit: ende, grund: l.fehler ?? "–" });
};

/** The newest restore: a good one as a sign, a failed one in the warning's colour */
export const WiederherstellenZustand = (props: { w: WiederherstellenStand }) => (
  <Switch fallback={<span>{wiederherstellenText(props.w)}</span>}>
    <Match when={props.w.letzter?.phase === "gelungen"}>
      <Zustand icon={CircleCheck} farbe="text-ok" text={wiederherstellenText(props.w)} />
    </Match>
    <Match when={props.w.letzter?.phase === "gescheitert"}>
      <span class="font-medium text-warn">{wiederherstellenText(props.w)}</span>
    </Match>
  </Switch>
);

/** The plain warning in the dialog: nothing is played back before the current state is safe */
const Hinweis = () => (
  <div role="note" class="flex items-start gap-3 rounded-lg border border-warn/50 px-4 py-3">
    <Icon icon={TriangleAlert} size={16} class="mt-0.5 shrink-0 text-warn" />
    <div class="grid min-w-0 gap-1">
      <p class="font-medium text-warn">{m.wh_hinweis_titel()}</p>
      <p class="text-muted-foreground">{m.wh_hinweis()}</p>
    </div>
  </div>
);

/** The dialog for the run chosen, if one is; `angefordert` once the jobs are made */
export const WiederherstellenDialog = (props: {
  a: InstallationAnsicht;
  lauf: BackupLauf | undefined;
  onClose: () => void;
  angefordert: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const schliessen = () => {
    setFehler("");
    props.onClose();
  };
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    const lauf = props.lauf;
    if (!lauf) return;
    setLaeuft(true);
    const antwort = await backupQuelle().wiederherstellen(props.a.id, lauf.id, werte.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort));
    setFehler("");
    props.angefordert();
  };
  return (
    <Dialog
      open={props.lauf !== undefined}
      onClose={schliessen}
      title={m.wh_titel()}
      description={m.wh_text({ name: titelVon(props.a), zeit: zeit(props.lauf?.zeitpunkt ?? 0) })}
    >
      <Show when={props.lauf}>
        <form class="grid gap-4" onSubmit={senden}>
          <Hinweis />
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.wh_grund_platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={schliessen}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="danger" disabled={laeuft()}>
              {m.wh_knopf()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

/** The button beside a run that can be restored now */
export const WiederherstellenKnopf = (props: {
  lauf: BackupLauf;
  angeboten: boolean;
  waehlen: (lauf: BackupLauf) => void;
}) => (
  <Show when={props.angeboten}>
    <Button
      size="sm"
      aria-label={m.wh_knopf_lauf({ zeit: zeit(props.lauf.zeitpunkt) })}
      onClick={() => props.waehlen(props.lauf)}
    >
      {m.wh_knopf()}
    </Button>
  </Show>
);
