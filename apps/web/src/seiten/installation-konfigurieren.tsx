import { Button, Dialog, Input, m } from "@steuerzentrale/ui";
import { createSignal, Show } from "solid-js";
import { einstellungenAus } from "../daten/einstellungs-formular.ts";
import { type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";
import { type InstallationsFormular, installationenQuelle } from "../daten/installationen.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { EinstellungsFelder } from "./einstellungs-felder.tsx";
import { installationsFehler } from "./installieren-texte.ts";

/*
 * "Einstellungen ändern" of an installation (BAULISTE.md Z-404; mockup, installation "Einstellungen
 * aus dem Manifest"): the values of the level `installation` as a form from its manifest, with the
 * operator's current values taken along, and a reason; the Zentrale sends the job "neu
 * konfigurieren", and the values apply once the agent reports success. Only for owner and technik
 * (docs/plan.md, "Rollen für Installationen"); the Zentrale refuses it in a freeze window and while
 * a job of the installation is open. Opened from "Mehr …" of an app's page (app-mehr.tsx).
 */

export type Konfigurierbar = InstallationAnsicht & { formular: InstallationsFormular };

export const KonfigurierenDialog = (props: {
  a: Konfigurierbar;
  open: boolean;
  onClose: () => void;
  konfiguriert: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await installationenQuelle().konfigurieren(
      props.a.id,
      einstellungenAus(props.a.formular.felder, werte, { aendern: true }),
      werte.grund ?? "",
    );
    setLaeuft(false);
    if (!antwort.ok) return setFehler(installationsFehler(antwort));
    props.konfiguriert();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={m.inst_konfigurieren_titel({ name: titelVon(props.a) })}
      description={m.inst_konfigurieren_text()}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <EinstellungsFelder
            felder={props.a.formular.felder}
            titel={m.installieren_einstellungen()}
            text={m.inst_konfigurieren_felder_text()}
            bestand={{ werte: props.a.werte, gesetzt: props.a.formular.gesetzt }}
          />
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.inst_konfigurieren_grund_platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="primary" disabled={laeuft()}>
              {m.inst_konfigurieren_knopf()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};
