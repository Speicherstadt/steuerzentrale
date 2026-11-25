import { Button, m, Tabs } from "@steuerzentrale/ui";
import { createMemo, createSignal, createUniqueId, For, Loading, refresh, Show } from "solid-js";
import { installationenJeApp, werteGesetzt } from "../daten/app-werte.ts";
import { type BetreiberEinstellungen, einstellungenQuelle } from "../daten/einstellungen.ts";
import { einstellungenAus } from "../daten/einstellungs-formular.ts";
import { installationenQuelle } from "../daten/installationen.ts";
import { bestand } from "../daten/quelle.ts";
import { Angaben, Karte, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { WertFeld } from "./app-wert-feld.tsx";
import { installationsFehler } from "./installieren-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The section "Werte für Apps" of the settings (BAULISTE.md Z-404; the approved mockup
 * "Einstellungen"): the operator's values of each app it has installations of and whose newest
 * manifest has values of the operator, one app at a time, as a form from that manifest, saved with
 * one reason by the owner; a member sees them read-only. A secret shows only as set. A new
 * value reaches a running installation with "Einstellungen ändern" on its page, not by itself.
 */

const appName = (app: string) => bestand().apps.find((a) => a.id === app)?.name ?? app;

const NurLesen = (props: { e: BetreiberEinstellungen }) => (
  <div class="border-t pt-4">
    <Angaben
      zeilen={props.e.felder.map((f) => ({
        name: f.titel,
        wert: f.geheim
          ? props.e.gesetzt.includes(f.name)
            ? m.inst_wert_gesetzt()
            : m.einst_nicht_gesetzt()
          : String(props.e.werte[f.name] ?? m.inst_wert_fehlt()),
      }))}
    />
  </div>
);

/** One reason for the whole form and "Speichern", as the audit log writes it */
const GrundZeile = (props: { laeuft: boolean }) => {
  const id = createUniqueId();
  return (
    <div class="flex flex-col gap-3 border-t pt-4 sm:flex-row">
      <label for={id} class="sr-only">
        {m.feld_grund()}
      </label>
      <input
        id={id}
        name="grund"
        required
        maxlength={500}
        placeholder={m.einst_grund_platzhalter()}
        class="h-9 w-full min-w-0 rounded-lg sm:flex-1 border border-border bg-background px-3 text-[13px] placeholder:text-muted-foreground"
      />
      <Button type="submit" variant="primary" class="h-9" disabled={props.laeuft}>
        {m.knopf_speichern()}
      </Button>
    </div>
  );
};

const AppFormular = (props: { e: BetreiberEinstellungen; gespeichert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await einstellungenQuelle().aendern(
      props.e.app,
      einstellungenAus(props.e.felder, werte, { aendern: true }),
      werte.grund ?? "",
    );
    setLaeuft(false);
    if (!antwort.ok) return setFehler(installationsFehler(antwort));
    setFehler("");
    props.gespeichert();
  };
  return (
    <form class="grid gap-0" onSubmit={senden}>
      <For each={props.e.felder}>
        {(f) => <WertFeld f={f} bestand={{ werte: props.e.werte, gesetzt: props.e.gesetzt }} />}
      </For>
      <div class={fehler() ? "pb-3" : undefined}>
        <Fehler text={fehler()} />
      </div>
      <GrundZeile laeuft={laeuft()} />
    </form>
  );
};

/** "Gilt für alle 9 Installationen von Haben · 3 von 4 Werten gesetzt" */
const stand = (e: BetreiberEinstellungen, anzahl: number | undefined) => {
  const app = appName(e.app);
  const gilt =
    anzahl === undefined || anzahl === 0
      ? m.einst_werte_gilt_jede({ app })
      : anzahl === 1
        ? m.einst_werte_gilt_eins({ app })
        : m.einst_werte_gilt({ app, anzahl });
  return `${gilt} · ${m.einst_werte_gesetzt(werteGesetzt(e))}`;
};

/** Only apps whose manifest has values of the operator */
const mitFeldern = (liste: BetreiberEinstellungen[]) => liste.filter((e) => e.felder.length > 0);

const AppReiter = (props: {
  liste: BetreiberEinstellungen[];
  anzahl: Map<string, number>;
  gespeichert: (app: string) => void;
}) => (
  <Tabs
    label={m.einst_werte_apps()}
    aside={(app) => {
      const e = props.liste.find((x) => x.app === app);
      return e ? stand(e, props.anzahl.get(app)) : null;
    }}
    tabs={props.liste.map((e) => ({
      id: e.app,
      label: appName(e.app),
      content: () => (
        <MitInstallationsRecht sonst={<NurLesen e={e} />}>
          <AppFormular e={e} gespeichert={() => props.gespeichert(e.app)} />
        </MitInstallationsRecht>
      ),
    }))}
  />
);

export const AppWerte = () => {
  const antwort = createMemo(() => einstellungenQuelle().apps());
  const installationen = createMemo(() => installationenQuelle().liste());
  const [hinweis, setHinweis] = createSignal("");
  const liste = () => {
    const a = antwort();
    return a.ok ? mitFeldern(a.daten) : [];
  };
  const anzahl = () => {
    const a = installationen();
    return installationenJeApp(a.ok ? a.daten : []);
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : installationsFehler(a);
  };
  return (
    <Karte>
      <KartenKopf titel={m.einst_nav_werte()} text={m.einst_werte_text()} />
      <div class="px-5 pb-5">
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <Fehler text={fehler()} />
          <Show
            when={liste().length > 0}
            fallback={<p class="text-muted-foreground">{m.einst_apps_leer()}</p>}
          >
            <AppReiter
              liste={liste()}
              anzahl={anzahl()}
              gespeichert={(app) => {
                setHinweis(m.einst_apps_gespeichert({ app: appName(app) }));
                refresh(antwort);
              }}
            />
          </Show>
          <p role="status" class="mt-3 text-xs text-muted-foreground empty:mt-0">
            {hinweis()}
          </p>
        </Loading>
      </div>
    </Karte>
  );
};
