import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { Plus } from "@steuerzentrale/ui/icons";
import { createSignal, For, Loading, Show } from "solid-js";
import { eingetragen, einstellungenAus } from "../daten/einstellungs-formular.ts";
import { type InstallationDerZentrale, installationenQuelle } from "../daten/installationen.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { EinstellungsFelder } from "./einstellungs-felder.tsx";
import { type Auswahl, auswahlZustand } from "./installieren-auswahl.ts";
import { DateiFeld, ManifestBefund, ZielWahl } from "./installieren-felder.tsx";
import { OptionenFelder, PlatzierungsBox } from "./installieren-teile.tsx";
import { grundText, installationsFehler } from "./installieren-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * "Installieren" (BAULISTE.md Z-402; mockup openInstall): customer, server, the signed manifest
 * (manifest.yml and its .minisig, until manifests are imported with Z-501), its options and the
 * settings of the level `installation`, the host and the reason. The placement is asked anew on
 * every change of customer, server, manifest or options; making the installation decides the same.
 * When it finds a required value of the operator missing, the dialog asks for it (Z-404) and the
 * Zentrale stores it with the installation, for every installation of the app.
 */

type Ablehnung = { text: string; gruende: string[] };

/** The refusal of the Zentrale: its text and, for `passt_nicht`, every reason */
const AblehnungsText = (props: { ablehnung: Ablehnung | undefined }) => (
  <>
    <Fehler text={props.ablehnung?.text ?? ""} />
    <Show when={props.ablehnung?.gruende.length}>
      <ul class="grid gap-1 text-xs text-danger">
        <For each={props.ablehnung?.gruende ?? []}>{(g) => <li>{g}</li>}</For>
      </ul>
    </Show>
  </>
);

/**
 * The placement, asked anew on every change of the choice; only this box waits for it, and the
 * operator's missing values it names, which follow its answer
 */
const Platzierung = (props: { a: Auswahl }) => (
  <Loading
    on={props.a.wunsch()}
    fallback={<PlatzierungsBox antwort={undefined} titel="" pruefend />}
  >
    <PlatzierungsBox antwort={props.a.platzierung()} titel={props.a.titel()} pruefend={false} />
    <EinstellungsFelder
      felder={props.a.betreiberFelder()}
      titel={m.installieren_betreiber()}
      text={m.installieren_betreiber_text()}
      praefix="betreiber"
    />
  </Loading>
);

const ManifestTeil = (props: { a: Auswahl }) => (
  <>
    <DateiFeld
      label={m.installieren_manifest()}
      hint={m.installieren_manifest_hinweis()}
      accept=".yml,.yaml"
      onText={props.a.manifestSetzen}
    />
    <DateiFeld
      label={m.installieren_signatur()}
      hint={m.installieren_signatur_hinweis()}
      accept=".minisig"
      onText={props.a.setSignatur}
    />
    <ManifestBefund geprueft={props.a.geprueft()} />
    <Show when={props.a.gelesen()}>
      {(mf) => (
        <>
          <OptionenFelder
            manifest={mf()}
            gewaehlt={props.a.optionen()}
            onWahl={props.a.setOptionen}
          />
          <EinstellungsFelder
            felder={props.a.einstellungen()}
            titel={m.installieren_einstellungen()}
            text={m.installieren_einstellungen_text()}
          />
        </>
      )}
    </Show>
  </>
);

/**
 * The host, filled with the suggested address (Z-407) until the person types another; a new
 * customer or manifest brings a new suggestion
 */
const AdressFeld = (props: { a: Auswahl }) => {
  const [host, setHost] = createSignal(() => props.a.vorschlag() ?? "");
  const hinweis = () => {
    const domain = props.a.domain();
    return domain ? m.installieren_host_hinweis_domain({ domain }) : m.installieren_host_hinweis();
  };
  return (
    <Input
      label={m.installieren_host()}
      name="host"
      required
      autocomplete="off"
      placeholder={m.installieren_host_platzhalter()}
      value={host()}
      onInput={(event) => setHost(event.currentTarget.value)}
      hint={hinweis()}
    />
  );
};

const Formular = (props: {
  kundeId: string | undefined;
  onAngelegt: (i: InstallationDerZentrale) => void;
  onAbbruch: () => void;
}) => {
  const a = auswahlZustand(() => props.kundeId);
  const [ablehnung, setAblehnung] = createSignal<Ablehnung>();
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    const w = a.wunsch();
    if (!w) return;
    setLaeuft(true);
    const neu = {
      ...w,
      host: werte.host ?? "",
      einstellungen: einstellungenAus(a.einstellungen(), werte),
      betreiberWerte: eingetragen(a.betreiberFormular(), werte, "betreiber"),
    };
    const antwort = await installationenQuelle().anlegen(neu, werte.grund ?? "");
    setLaeuft(false);
    if (antwort.ok) return props.onAngelegt(antwort.daten);
    setAblehnung({
      text: installationsFehler(antwort),
      gruende: (antwort.gruende ?? []).map(grundText),
    });
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <ZielWahl a={a} />
      <ManifestTeil a={a} />
      <Loading fallback={<p class="text-xs text-muted-foreground">{m.installieren_laden()}</p>}>
        <AdressFeld a={a} />
      </Loading>
      <Platzierung a={a} />
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.installieren_grund_platzhalter()}
        hint={m.feld_grund_hinweis()}
      />
      <AblehnungsText ablehnung={ablehnung()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onAbbruch()}>{m.knopf_abbrechen()}</Button>
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {m.installieren_knopf()}
        </Button>
      </div>
    </form>
  );
};

/**
 * The button "App installieren" and its dialog, only for a role that may install
 * (docs/plan.md, "Rollen für Installationen"); `kundeId` preselects the customer
 */
export const Installieren = (props: {
  kundeId?: string;
  onAngelegt: (i: InstallationDerZentrale) => void;
}) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <MitInstallationsRecht>
      <Button variant="primary" onClick={() => setOffen(true)}>
        <Icon icon={Plus} size={16} />
        {m.installieren()}
      </Button>
      <Dialog
        open={offen()}
        onClose={() => setOffen(false)}
        title={m.installieren()}
        description={m.installieren_text()}
      >
        <Show when={offen()}>
          <Formular
            kundeId={props.kundeId}
            onAbbruch={() => setOffen(false)}
            onAngelegt={(i) => {
              setOffen(false);
              props.onAngelegt(i);
            }}
          />
        </Show>
      </Dialog>
    </MitInstallationsRecht>
  );
};
