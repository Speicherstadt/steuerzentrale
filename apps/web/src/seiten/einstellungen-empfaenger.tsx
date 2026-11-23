import { Button, Dialog, Input, m } from "@steuerzentrale/ui";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import {
  benachrichtigungsQuelle,
  type Empfaenger,
  neuerSchluessel,
  type Schwere,
} from "../daten/benachrichtigungen.ts";
import { datum } from "../format/zeit.ts";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The recipients of the settings' tab "Benachrichtigungen" (BAULISTE.md Z-703): a mail address or a
 * webhook, each from a severity upwards. Owner and technik add one with a reason, send it a test
 * message and remove it with a reason; support sees the list. A webhook's signing key is made in
 * the browser and shown here once, before saving; afterwards the Zentrale shows only the URL's host.
 */

export const SCHWERE: Record<Schwere, () => string> = {
  info: m.melden_schwere_info,
  warn: m.melden_schwere_warn,
  fehler: m.melden_schwere_fehler,
};

/** A severity's name; one the interface does not know as it came */
export const schwereText = (s: string): string => (SCHWERE[s as Schwere] ?? (() => s))();

const FEHLER: Record<string, () => string> = {
  ungueltig: m.melden_fehler_empfaenger,
  nicht_gefunden: m.melden_fehler_nicht_gefunden,
  kein_versand: m.melden_fehler_kein_versand,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

const fehlerVon = (code: string) => (FEHLER[code] ?? m.fehler_unbekannt)();

const feld =
  "h-8 w-full rounded-lg border bg-background px-2.5 focus-visible:outline-2 focus-visible:outline-foreground";

const Wahl = (props: {
  label: string;
  name: string;
  werte: readonly string[];
  text: (wert: string) => string;
  wert: string;
  onChange?: (wert: string) => void;
}) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {props.label}
      </label>
      <select
        id={id}
        name={props.name}
        class={feld}
        value={props.wert}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
      >
        <For each={props.werte}>{(w) => <option value={w}>{props.text(w)}</option>}</For>
      </select>
    </div>
  );
};

const GrundFeld = (props: { platzhalter: string }) => (
  <Input
    label={m.feld_grund()}
    name="grund"
    required
    maxlength={500}
    placeholder={props.platzhalter}
    hint={m.feld_grund_hinweis()}
  />
);

const Knoepfe = (props: {
  onClose: () => void;
  knopf: string;
  gefahr?: boolean;
  laeuft: boolean;
}) => (
  <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
    <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
    <Button type="submit" variant={props.gefahr ? "danger" : "primary"} disabled={props.laeuft}>
      {props.knopf}
    </Button>
  </div>
);

/** The webhook's fields: the URL and a key made here, which the operator copies to the receiver */
const WebhookFelder = (props: { schluessel: string; neu: () => void }) => (
  <>
    <Input
      label={m.melden_url()}
      name="url"
      type="url"
      required
      autocomplete="off"
      placeholder={m.melden_url_platzhalter()}
      hint={m.melden_url_hinweis()}
    />
    <Input
      label={m.melden_schluessel()}
      name="schluessel"
      required
      readonly
      autocomplete="off"
      class="font-mono"
      value={props.schluessel}
      hint={m.melden_schluessel_hinweis()}
    />
    <div>
      <Button size="sm" onClick={() => props.neu()}>
        {m.melden_schluessel_neu()}
      </Button>
    </div>
  </>
);

const HinzufuegenFormular = (props: { onClose: () => void; angelegt: () => void }) => {
  const [art, setArt] = createSignal<"mail" | "webhook">("mail");
  const [schluessel, setSchluessel] = createSignal(neuerSchluessel());
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const w = felder(event);
    const abSchwere = (w.abSchwere ?? "warn") as Schwere;
    const neu =
      art() === "mail"
        ? { art: "mail" as const, adresse: w.adresse ?? "", abSchwere }
        : { art: "webhook" as const, url: w.url ?? "", schluessel: w.schluessel ?? "", abSchwere };
    setLaeuft(true);
    const antwort = await benachrichtigungsQuelle().anlegen(neu, w.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort.fehler));
    props.angelegt();
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <Wahl
        label={m.melden_art()}
        name="art"
        werte={["mail", "webhook"]}
        text={(w) => (w === "mail" ? m.melden_art_mail() : m.einst_webhook())}
        wert={art()}
        onChange={(w) => setArt(w === "webhook" ? "webhook" : "mail")}
      />
      <Show
        when={art() === "webhook"}
        fallback={
          <Input
            label={m.melden_adresse()}
            name="adresse"
            type="email"
            required
            autocomplete="off"
          />
        }
      >
        <WebhookFelder schluessel={schluessel()} neu={() => setSchluessel(neuerSchluessel())} />
      </Show>
      <Wahl
        label={m.melden_ab_schwere()}
        name="abSchwere"
        werte={["info", "warn", "fehler"]}
        text={(w) => SCHWERE[w as Schwere]()}
        wert="warn"
      />
      <GrundFeld platzhalter={m.melden_anlegen_platzhalter()} />
      <Fehler text={fehler()} />
      <Knoepfe onClose={props.onClose} knopf={m.melden_hinzufuegen()} laeuft={laeuft()} />
    </form>
  );
};

const EntfernenFormular = (props: { r: Empfaenger; onClose: () => void; entfernt: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const w = felder(event);
    setLaeuft(true);
    const antwort = await benachrichtigungsQuelle().entfernen(props.r.empfaengerId, w.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort.fehler));
    props.entfernt();
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <GrundFeld platzhalter={m.melden_entfernen_platzhalter()} />
      <Fehler text={fehler()} />
      <Knoepfe onClose={props.onClose} knopf={m.melden_entfernen()} gefahr laeuft={laeuft()} />
    </form>
  );
};

const Zeile = (props: {
  r: Empfaenger;
  testen: (r: Empfaenger) => void;
  entfernen: (r: Empfaenger) => void;
}) => (
  <Reihe>
    <td class="text-xs">{props.r.art === "mail" ? m.melden_art_mail() : m.einst_webhook()}</td>
    <td class="font-mono text-xs">{props.r.anzeige}</td>
    <td class="text-xs">{SCHWERE[props.r.abSchwere]()}</td>
    <td class="text-xs text-muted-foreground">{datum(props.r.angelegtAm)}</td>
    <MitInstallationsRecht sonst={<td />}>
      <td>
        <div class="flex gap-2">
          <Button
            size="sm"
            aria-label={m.melden_test_name({ empfaenger: props.r.anzeige })}
            onClick={() => props.testen(props.r)}
          >
            {m.melden_test()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={m.melden_entfernen_name({ empfaenger: props.r.anzeige })}
            onClick={() => props.entfernen(props.r)}
          >
            {m.melden_entfernen()}
          </Button>
        </div>
      </td>
    </MitInstallationsRecht>
  </Reihe>
);

/** The list with its dialogs; `geaendert` after a recipient was added or removed */
export const EmpfaengerListe = (props: {
  liste: Empfaenger[];
  geaendert: (text: string) => void;
}) => {
  const [hinzufuegen, setHinzufuegen] = createSignal(false);
  const [weg, setWeg] = createSignal<Empfaenger>();
  const [meldung, setMeldung] = createSignal("");
  const testen = async (r: Empfaenger) => {
    setMeldung("");
    const a = await benachrichtigungsQuelle().testen(r.empfaengerId);
    setMeldung(
      a.ok
        ? m.melden_test_ok({ empfaenger: r.anzeige })
        : m.melden_test_fehler({ empfaenger: r.anzeige, detail: a.detail ?? fehlerVon(a.fehler) }),
    );
  };
  return (
    <div class="grid gap-3">
      <p role="status" class="text-xs text-muted-foreground">
        {meldung()}
      </p>
      <Tabelle
        name={m.melden_empfaenger()}
        minBreite={640}
        leer={m.melden_empfaenger_keine()}
        anzahl={props.liste.length}
        spalten={[
          { name: m.melden_art() },
          { name: m.melden_adresse() },
          { name: m.melden_ab_schwere() },
          { name: m.melden_seit() },
          { name: m.melden_aktionen() },
        ]}
      >
        <For each={props.liste}>
          {(r) => <Zeile r={r} testen={(x) => void testen(x)} entfernen={(x) => setWeg(x)} />}
        </For>
      </Tabelle>
      <MitInstallationsRecht>
        <div>
          <Button variant="primary" size="sm" onClick={() => setHinzufuegen(true)}>
            {m.melden_hinzufuegen()}
          </Button>
        </div>
      </MitInstallationsRecht>
      <Dialog
        open={hinzufuegen()}
        onClose={() => setHinzufuegen(false)}
        title={m.melden_hinzufuegen()}
        description={m.melden_hinzufuegen_text()}
      >
        <Show when={hinzufuegen()}>
          <HinzufuegenFormular
            onClose={() => setHinzufuegen(false)}
            angelegt={() => {
              setHinzufuegen(false);
              props.geaendert(m.melden_angelegt());
            }}
          />
        </Show>
      </Dialog>
      <Dialog
        open={weg() !== undefined}
        onClose={() => setWeg(undefined)}
        title={m.melden_entfernen_titel()}
        description={m.melden_entfernen_text({ empfaenger: weg()?.anzeige ?? "" })}
      >
        <Show when={weg()}>
          {(r) => (
            <EntfernenFormular
              r={r()}
              onClose={() => setWeg(undefined)}
              entfernt={() => {
                setWeg(undefined);
                props.geaendert(m.melden_entfernt());
              }}
            />
          )}
        </Show>
      </Dialog>
    </div>
  );
};
