import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { Power } from "@steuerzentrale/ui/icons";
import { createSignal, Show } from "solid-js";
import { sperrzeitAktiv, sperrzeitenDer } from "../daten/ableitungen.ts";
import { serverQuelle } from "../daten/server.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand } from "../daten/typen.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import {
  letzterText,
  neustartFehler,
  noetigText,
  planText,
  unattendedText,
} from "./neustart-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The maintenance of a server (BAULISTE.md Z-701; mockup, server page "Wartung" and "Neustart
 * planen"): its operating system as the agent reports it (unattended-upgrades, pending packages,
 * "Neustart nötig", since when it runs), its maintenance window and the freeze windows of its apps,
 * what the plan decides for its reboot and how the last one ended; the owner (the roles
 * with `server:neustart`, the same as for installations) reboot it by hand with a reason.
 */

type Hier = { b: Bestand; a: ServerAnsicht; apps: string[] };

const leer = (wert: string | null) =>
  wert ?? <span class="text-muted-foreground">{m.server_unbekannt()}</span>;

const systemZeilen = (h: Hier) => [
  { name: m.server_unattended(), wert: leer(unattendedText(h.a.unattended, h.b.jetzt)) },
  { name: m.server_pakete(), wert: leer(h.a.updates?.toString() ?? null) },
  {
    name: m.server_neustart_noetig(),
    wert: leer(noetigText(h.a.neustartStand.noetig, h.a.kernel)),
  },
  {
    name: m.server_laeuft_seit(),
    wert: leer(h.a.gestartetAm === null ? null : zeitpunkt(h.a.gestartetAm, h.b.jetzt)),
  },
];

const wartungsZeilen = (h: Hier) => {
  const sperren = sperrzeitenDer(h.b, h.apps);
  return [
    {
      name: m.server_spalte_wartung(),
      wert: m.server_taeglich({ von: h.a.wartung.von, bis: h.a.wartung.bis }),
    },
    {
      name: m.server_sperrzeiten_hier(),
      wert: sperren.length
        ? sperren
            .map((z) => m.server_sperrzeit_tage({ app: z.appName, von: z.von, bis: z.bis }))
            .join(", ")
        : m.server_keine(),
    },
    {
      name: m.server_gesperrt(),
      wert: sperren.some((z) => sperrzeitAktiv(z, h.b.jetzt)) ? m.ja() : m.nein(),
    },
    {
      name: m.server_naechster_neustart(),
      wert: planText(h.a.neustartStand.plan, h.b.jetzt),
    },
    {
      name: m.server_letzter_neustart(),
      wert: letzterText(h.a.neustartStand.letzter, h.b.jetzt) ?? m.server_neustart_keiner(),
    },
  ];
};

/** The dialog of a reboot by hand: a reason, then the backups and the reboot */
const NeustartDialog = (props: {
  a: ServerAnsicht;
  open: boolean;
  onClose: () => void;
  angelegt: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await serverQuelle().neustart(props.a.id, werte.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(neustartFehler(antwort));
    setFehler("");
    props.angelegt();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={m.server_neustart_titel()}
      description={m.server_neustart_dialog_text({ name: props.a.name })}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.server_neustart_grund_platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="primary" disabled={laeuft()}>
              {m.server_neustart_ausfuehren()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

/** The button with its dialog, for the roles that may reboot a server */
export const NeustartKnopf = (props: { a: ServerAnsicht; neu: () => void }) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <MitInstallationsRecht>
      <Button onClick={() => setOffen(true)}>
        <Icon icon={Power} />
        {m.server_neustart_titel()}
      </Button>
      <NeustartDialog
        a={props.a}
        open={offen()}
        onClose={() => setOffen(false)}
        angelegt={() => {
          setOffen(false);
          props.neu();
        }}
      />
    </MitInstallationsRecht>
  );
};

/** The card of the tab "Technik"; the button "Neu starten" stands in the page's head */
export const Wartung = (props: Hier) => (
  <Karte>
    <KartenKopf titel={m.server_wartung()} text={m.server_wartung_text()} />
    <KartenInhalt class="grid gap-4">
      <Angaben zeilen={systemZeilen(props)} />
      <div class="border-t pt-4">
        <Angaben zeilen={wartungsZeilen(props)} />
      </div>
      <p class="text-xs text-muted-foreground">{m.server_neustart_regel()}</p>
    </KartenInhalt>
  </Karte>
);
