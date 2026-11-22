import { Button, Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, For, Loading, refresh } from "solid-js";
import { type BetreiberEinstellungen, einstellungenQuelle } from "../daten/einstellungen.ts";
import { einstellungenAus } from "../daten/einstellungs-formular.ts";
import { bestand } from "../daten/quelle.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { EinstellungsFelder } from "./einstellungs-felder.tsx";
import { installationsFehler } from "./installieren-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The area "Apps" of the settings (BAULISTE.md Z-404; mockup viewEinstellungen, "werte"): the
 * operator's values of each app it has installations of, as a form from the schema of the app's
 * newest manifest, saved with a reason by owner and technik; support sees them read-only. A secret
 * shows only as set; an empty secret field keeps it. A new value reaches a running installation
 * with "Einstellungen ändern" on its page, not by itself.
 */

const appName = (app: string) => bestand().apps.find((a) => a.id === app)?.name ?? app;

const NurLesen = (props: { e: BetreiberEinstellungen }) => (
  <Angaben
    zeilen={props.e.felder.map((f) => ({
      name: f.name,
      wert: f.geheim
        ? props.e.gesetzt.includes(f.name)
          ? m.inst_wert_gesetzt()
          : m.einst_nicht_gesetzt()
        : String(props.e.werte[f.name] ?? m.inst_wert_fehlt()),
    }))}
  />
);

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
    <form class="grid gap-4" onSubmit={senden}>
      <EinstellungsFelder
        felder={props.e.felder}
        titel={m.einst_apps_felder()}
        text={m.einst_apps_felder_text({ version: props.e.version })}
        bestand={{ werte: props.e.werte, gesetzt: props.e.gesetzt }}
      />
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.einst_apps_grund_platzhalter()}
        hint={m.feld_grund_hinweis()}
      />
      <Fehler text={fehler()} />
      <div class="flex justify-end">
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {m.knopf_speichern()}
        </Button>
      </div>
    </form>
  );
};

const AppKarte = (props: { e: BetreiberEinstellungen; gespeichert: () => void }) => (
  <Karte>
    <KartenKopf titel={appName(props.e.app)} text={m.einst_werte_text()} />
    <KartenInhalt>
      <MitInstallationsRecht sonst={<NurLesen e={props.e} />}>
        <AppFormular e={props.e} gespeichert={props.gespeichert} />
      </MitInstallationsRecht>
    </KartenInhalt>
  </Karte>
);

/** Only apps whose manifest has values of the operator */
const mitFeldern = (liste: BetreiberEinstellungen[]) => liste.filter((e) => e.felder.length > 0);

export const AppWerte = () => {
  const antwort = createMemo(() => einstellungenQuelle().apps());
  const [hinweis, setHinweis] = createSignal("");
  const liste = () => {
    const a = antwort();
    return a.ok ? mitFeldern(a.daten) : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : installationsFehler(a);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
      <Fehler text={fehler()} />
      <p role="status" class="text-xs text-muted-foreground">
        {hinweis()}
      </p>
      <For each={liste()} fallback={<p class="text-muted-foreground">{m.einst_apps_leer()}</p>}>
        {(e) => (
          <AppKarte
            e={e}
            gespeichert={() => {
              setHinweis(m.einst_apps_gespeichert({ app: appName(e.app) }));
              refresh(antwort);
            }}
          />
        )}
      </For>
    </Loading>
  );
};
