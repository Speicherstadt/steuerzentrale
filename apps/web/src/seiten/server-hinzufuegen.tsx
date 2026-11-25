import { Button, Dialog, Icon, IconButton, Input, m } from "@steuerzentrale/ui";
import { Check, Copy, Plus } from "@steuerzentrale/ui/icons";
import { createSignal, For, Show } from "solid-js";
import { api } from "../anmeldung/api.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { serverAngaben } from "./server-angaben.ts";

/*
 * "Server hinzufügen" (BAULISTE.md Z-302, mockup openAddServer and openInstallCommand): name,
 * maintenance window and reason, no kind and no customer (Z-1205); then the install command with
 * the one-time token, shown this once, since the Zentrale keeps only its hash.
 */
type Angelegt = { name: string; befehl: string };

const fehlerText = (antwort: { status: number; fehler: string }) =>
  antwort.status === 403
    ? m.fehler_keine_berechtigung()
    : antwort.fehler === "ungueltig"
      ? m.server_fehler_ungueltig()
      : antwort.status === 0
        ? m.fehler_netz()
        : m.fehler_unbekannt();

const Formular = (props: { onAngelegt: (a: Angelegt) => void; onAbbruch: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const senden = async (event: SubmitEvent) => {
    const angaben = serverAngaben(felder(event));
    const antwort = await api<{ befehl: string }>("/api/v1/server", { body: angaben });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    props.onAngelegt({ name: angaben.name, befehl: antwort.daten.befehl });
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <Input
        label={m.server_feld_name()}
        name="name"
        placeholder={m.server_feld_name_beispiel()}
        required
      />
      <div class="grid gap-1.5">
        <div class="grid grid-cols-2 gap-3">
          <Input
            label={m.server_feld_wartung_von()}
            // i18n-ignore: the form field name server-angaben.ts reads, no text
            name="von"
            type="time"
            value="03:30"
            required
          />
          <Input
            label={m.server_feld_wartung_bis()}
            name="bis"
            type="time"
            value="04:30"
            required
          />
        </div>
        <p class="text-xs text-muted-foreground">{m.server_wartung_hinweis()}</p>
      </div>
      <Input label={m.feld_grund()} name="grund" hint={m.feld_grund_hinweis()} required />
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" onClick={() => props.onAbbruch()}>
          {m.abbrechen()}
        </Button>
        <Button type="submit" variant="primary">
          {m.server_weiter()}
        </Button>
      </div>
    </form>
  );
};

const SCHRITTE = [
  m.server_schritt_system,
  m.server_schritt_pakete,
  m.server_schritt_schluessel,
  m.server_schritt_ports,
];

const Befehl = (props: { angelegt: Angelegt; onFertig: () => void }) => {
  const [kopiert, setKopiert] = createSignal(false);
  const kopieren = () =>
    void navigator.clipboard
      .writeText(props.angelegt.befehl)
      .then(() => setKopiert(true))
      .catch(() => setKopiert(false));
  return (
    <div class="grid gap-4">
      <p class="text-xs text-muted-foreground">
        {m.server_befehl_text({ name: props.angelegt.name })}
      </p>
      <figure class="relative rounded-lg border bg-muted/50 p-3 pr-11">
        <figcaption class="sr-only">{m.server_befehl()}</figcaption>
        <code
          data-testid="install-befehl"
          class="block font-mono text-xs leading-relaxed break-all"
        >
          {props.angelegt.befehl}
        </code>
        <IconButton
          label={m.server_befehl_kopieren()}
          onClick={kopieren}
          class="absolute top-1.5 right-1.5"
        >
          <Icon icon={Copy} />
        </IconButton>
      </figure>
      <p role="status" class={["text-xs text-ok", { hidden: !kopiert() }]}>
        {m.server_befehl_kopiert()}
      </p>
      <ul class="grid gap-2 text-[13px] text-muted-foreground">
        <For each={SCHRITTE}>
          {(schritt) => (
            <li class="flex items-start gap-2">
              <Icon icon={Check} size={16} class="mt-0.5 shrink-0 text-ok" />
              {schritt()}
            </li>
          )}
        </For>
      </ul>
      <p class="text-xs text-muted-foreground">{m.server_befehl_einmal()}</p>
      <div class="flex justify-end">
        <Button type="button" variant="primary" onClick={() => props.onFertig()}>
          {m.server_fertig()}
        </Button>
      </div>
    </div>
  );
};

/** The button of the page "Server" and its dialog; `onAngelegt` once a server was added */
export const ServerHinzufuegen = (props: { onAngelegt?: () => void }) => {
  const [offen, setOffen] = createSignal(false);
  const [angelegt, setAngelegt] = createSignal<Angelegt>();
  const schliessen = () => {
    if (angelegt()) props.onAngelegt?.();
    setOffen(false);
    setAngelegt(undefined);
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOffen(true)}>
        <Icon icon={Plus} size={16} />
        {m.server_hinzufuegen()}
      </Button>
      <Dialog
        open={offen()}
        onClose={schliessen}
        title={angelegt() ? m.server_befehl_titel() : m.server_hinzufuegen()}
        {...(angelegt() ? {} : { description: m.server_hinzufuegen_text() })}
      >
        <Show
          when={angelegt()}
          fallback={<Formular onAngelegt={setAngelegt} onAbbruch={schliessen} />}
        >
          {(a) => <Befehl angelegt={a()} onFertig={schliessen} />}
        </Show>
      </Dialog>
    </>
  );
};
