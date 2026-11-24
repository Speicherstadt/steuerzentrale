import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { CircleX, Trash2 } from "@steuerzentrale/ui/icons";
import { createSignal, For, Show } from "solid-js";
import {
  type InstallationAnsicht,
  linuxNutzerVon,
  titelVon,
} from "../daten/installation-ansicht.ts";
import type { AuftragDerInstallation } from "../daten/installationen.ts";
import { installationenQuelle } from "../daten/installationen.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Angaben, Hinweisbox, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { ZuKunde, ZuServer } from "../teile/verweise.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { aktionsText, auftragsZustandText, installationsFehler } from "./installieren-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * What the Zentrale knows of an installation (BAULISTE.md Z-402): where it runs, its ports and
 * values, its setup jobs with their state, and, after a failed setup, the way out: removing it with
 * a reason. A removal of one that was set up comes with Z-604, after a backup.
 */

const mono = (text: string) => <span class="font-mono text-xs">{text}</span>;

/** Where the installation runs and what the Zentrale assigned it */
export const EinrichtungsAngaben = (props: { a: InstallationAnsicht }) => (
  <Karte>
    <KartenKopf titel={m.inst_installation()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          {
            name: m.inst_spalte_kunde(),
            wert: <ZuKunde id={props.a.kundeId}>{props.a.kundeName}</ZuKunde>,
          },
          {
            name: m.server_spalte_server(),
            wert: <ZuServer id={props.a.serverId}>{props.a.serverName}</ZuServer>,
          },
          { name: m.inst_linux_nutzer(), wert: mono(linuxNutzerVon(props.a)) },
          { name: m.inst_adresse(), wert: mono(props.a.host) },
          {
            name: m.inst_http_port(),
            wert: props.a.httpPort === null ? "–" : mono(`127.0.0.1:${props.a.httpPort}`),
          },
          {
            name: m.inst_ports(),
            wert:
              Object.entries(props.a.ports)
                .map(([dienst, port]) => `${dienst} → ${port}`)
                .join(", ") || "–",
          },
          { name: m.inst_optionen(), wert: props.a.optionen.join(", ") || m.server_keine() },
          { name: m.server_version(), wert: props.a.version },
          {
            name: m.inst_manifest(),
            wert: mono(
              `${props.a.app} ${props.a.version} · sha256 ${props.a.manifestHash.slice(0, 12)}`,
            ),
          },
          { name: m.inst_angelegt(), wert: zeitpunkt(props.a.angelegtAm, Date.now()) },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const AuftragsZeile = (props: { auftrag: AuftragDerInstallation }) => (
  <li class="grid gap-0.5 rounded-lg border p-3">
    <span class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium">{aktionsText(props.auftrag.aktion)}</span>
      <span class="text-xs text-muted-foreground">
        {auftragsZustandText(props.auftrag.zustand)} ·{" "}
        {zeitpunkt(props.auftrag.geaendertAm, Date.now())}
      </span>
    </span>
    <Show when={props.auftrag.fortschritt}>
      {(schritt) => <span class="text-xs text-muted-foreground">{schritt()}</span>}
    </Show>
    <Show when={props.auftrag.fehler}>
      {(fehler) => (
        <span class="text-xs text-danger">{m.inst_auftrag_fehler({ fehler: fehler() })}</span>
      )}
    </Show>
  </li>
);

/** The setup jobs of the installation, as the agent reported them */
export const EinrichtungsAuftraege = (props: { auftraege: AuftragDerInstallation[] }) => (
  <Karte>
    <KartenKopf titel={m.inst_einrichtung()} text={m.inst_einrichtung_text()} />
    <KartenInhalt>
      <ul class="grid gap-2">
        <For each={props.auftraege} fallback={<li class="text-muted-foreground">–</li>}>
          {(a) => <AuftragsZeile auftrag={a} />}
        </For>
      </ul>
    </KartenInhalt>
  </Karte>
);

/** The values of the level `installation` that are not secret; a secret never comes back */
export const InstallationsWerte = (props: { a: InstallationAnsicht }) => (
  <Karte>
    <KartenKopf titel={m.inst_werte_titel()} text={m.inst_werte_text()} />
    <KartenInhalt>
      <Show
        when={Object.keys(props.a.werte).length > 0}
        fallback={<p class="text-muted-foreground">{m.inst_keine_werte()}</p>}
      >
        <Angaben
          zeilen={Object.entries(props.a.werte).map(([name, wert]) => ({
            name,
            wert: mono(String(wert)),
          }))}
        />
      </Show>
    </KartenInhalt>
  </Karte>
);

const EntfernenDialog = (props: {
  a: InstallationAnsicht;
  open: boolean;
  onClose: () => void;
  entfernt: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    const antwort = await installationenQuelle().entfernen(props.a.id, werte.grund ?? "");
    if (!antwort.ok) return setFehler(installationsFehler(antwort));
    props.entfernt();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={m.inst_entfernen_titel({ name: titelVon(props.a) })}
      description={m.inst_entfernen_text()}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.inst_entfernen_grund_platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="danger">
              {m.inst_entfernen_knopf()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

/**
 * After a failed setup: what happened, and removing it for a role that may (docs/plan.md,
 * "Entfernen einer gescheiterten Installation"); `entfernt` once the removal job is there
 */
export const Gescheitert = (props: { a: InstallationAnsicht; entfernt: () => void }) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <Hinweisbox icon={<Icon icon={CircleX} />} titel={m.inst_gescheitert_titel()} ton="warn">
      <p>{m.inst_gescheitert_text()}</p>
      <MitInstallationsRecht>
        <Button class="mt-3" onClick={() => setOffen(true)}>
          <Icon icon={Trash2} />
          {m.inst_entfernen()}
        </Button>
        <EntfernenDialog
          a={props.a}
          open={offen()}
          onClose={() => setOffen(false)}
          entfernt={() => {
            setOffen(false);
            props.entfernt();
          }}
        />
      </MitInstallationsRecht>
    </Hinweisbox>
  );
};
