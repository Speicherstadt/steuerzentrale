import { Button, Input, m } from "@steuerzentrale/ui";
import { createSignal, createUniqueId, For } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import {
  type Benachrichtigungen,
  benachrichtigungsQuelle,
  type Sicherheit,
} from "../daten/benachrichtigungen.ts";
import { Angaben } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";

/*
 * The mail server and the quiet hours of the settings' tab "Benachrichtigungen" (BAULISTE.md
 * Z-703): the owner sets them with a reason, a member reads them. The password never comes
 * back: it shows only as set, and an empty field keeps it. An empty server means webhooks only;
 * both times empty mean no quiet hours.
 */

export const FEHLER: Record<string, () => string> = {
  ungueltig: m.melden_fehler_ungueltig,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

export const fehlerText = (a: Antwort<unknown>) =>
  a.ok ? "" : (FEHLER[a.fehler] ?? m.fehler_unbekannt)();

const mono = (text: string) => <span class="font-mono text-xs">{text}</span>;

const SICHERHEIT: Record<Sicherheit, () => string> = {
  starttls: m.melden_sicherheit_starttls,
  tls: m.melden_sicherheit_tls,
  keine: m.melden_sicherheit_keine,
};

const ruhezeitText = (b: Benachrichtigungen) =>
  b.ruhezeit
    ? m.melden_ruhezeit_wert({ von: b.ruhezeit.von, bis: b.ruhezeit.bis })
    : m.melden_keine();

export const VersandLesen = (props: { b: Benachrichtigungen }) => (
  <Angaben
    zeilen={[
      {
        name: m.einst_smtp(),
        wert: props.b.smtp
          ? mono(`${props.b.smtp.host}:${props.b.smtp.port}`)
          : m.melden_nur_webhooks(),
      },
      ...(props.b.smtp
        ? [
            { name: m.melden_sicherheit(), wert: SICHERHEIT[props.b.smtp.sicherheit]() },
            { name: m.melden_absender(), wert: mono(props.b.smtp.absender) },
            { name: m.melden_benutzer(), wert: mono(props.b.smtp.benutzer ?? "–") },
            {
              name: m.melden_passwort(),
              wert: props.b.smtp.passwortGesetzt ? m.inst_wert_gesetzt() : m.einst_nicht_gesetzt(),
            },
          ]
        : []),
      { name: m.einst_ruhezeit(), wert: ruhezeitText(props.b) },
    ]}
  />
);

const feld =
  "h-8 w-full rounded-lg border bg-background px-2.5 focus-visible:outline-2 focus-visible:outline-foreground";

const SicherheitWahl = (props: { wert: Sicherheit }) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {m.melden_sicherheit()}
      </label>
      <select id={id} name="sicherheit" class={feld} value={props.wert}>
        <For each={["starttls", "tls", "keine"] as const}>
          {(s) => <option value={s}>{SICHERHEIT[s]()}</option>}
        </For>
      </select>
    </div>
  );
};

/** What the form's fields say, as the Zentrale takes it */
const aenderung = (w: Record<string, string>) => ({
  smtp: w.host
    ? {
        host: w.host.toLowerCase(),
        port: Number(w.port),
        sicherheit: (w.sicherheit ?? "starttls") as Sicherheit,
        benutzer: w.benutzer ?? null,
        absender: w.absender ?? "",
        ...(w.passwort ? { passwort: w.passwort } : {}),
      }
    : null,
  ruhezeit: w.von && w.bis ? { von: w.von, bis: w.bis } : null,
});

export const VersandFormular = (props: { b: Benachrichtigungen; gespeichert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const formular = event.currentTarget as HTMLFormElement;
    const w = felder(event);
    setLaeuft(true);
    const antwort = await benachrichtigungsQuelle().setzen(aenderung(w), w.grund ?? "");
    setLaeuft(false);
    setFehler(fehlerText(antwort));
    if (!antwort.ok) return;
    // the password stays in the Zentrale; the field starts empty again, as after a reload
    const passwort = formular.elements.namedItem("passwort");
    if (passwort instanceof HTMLInputElement) passwort.value = "";
    props.gespeichert();
  };
  return (
    <form class="grid max-w-xl gap-4" onSubmit={senden}>
      <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Input
          label={m.einst_smtp()}
          name="host"
          autocomplete="off"
          placeholder={m.melden_host_platzhalter()}
          value={props.b.smtp?.host ?? ""}
          hint={m.melden_host_hinweis()}
        />
        <Input
          label={m.melden_port()}
          name="port"
          type="number"
          min={1}
          max={65535}
          value={String(props.b.smtp?.port ?? 587)}
        />
      </div>
      <SicherheitWahl wert={props.b.smtp?.sicherheit ?? "starttls"} />
      <Input
        label={m.melden_absender()}
        name="absender"
        type="email"
        autocomplete="off"
        value={props.b.smtp?.absender ?? ""}
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <Input
          label={m.melden_benutzer()}
          name="benutzer"
          autocomplete="off"
          value={props.b.smtp?.benutzer ?? ""}
          hint={m.melden_benutzer_hinweis()}
        />
        <Input
          label={m.melden_passwort()}
          name="passwort"
          type="password"
          autocomplete="off"
          hint={
            props.b.smtp?.passwortGesetzt ? m.melden_passwort_gesetzt() : m.melden_passwort_neu()
          }
        />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <Input
          label={m.melden_ruhe_von()}
          // i18n-ignore: the form field name aenderung() reads, no text
          name="von"
          type="time"
          value={props.b.ruhezeit?.von ?? ""}
        />
        <Input
          label={m.melden_ruhe_bis()}
          name="bis"
          type="time"
          value={props.b.ruhezeit?.bis ?? ""}
          hint={m.melden_ruhe_hinweis()}
        />
      </div>
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.melden_grund_platzhalter()}
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
