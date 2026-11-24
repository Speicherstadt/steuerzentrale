import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { LifeBuoy, X } from "@steuerzentrale/ui/icons";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { DAUER_VORGABE, DAUERN, supportQuelle } from "../daten/support.ts";
import type { Zugang } from "../daten/typen.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";

/*
 * Starting and ending a support access (BAULISTE.md Z-802; mockup, "Support-Zugang starten"): the
 * signed-in member starts one for itself on an installation, with a duration and a reason for the
 * audit log; the customer sees it in its events. Used on the page "Support-Zugänge" (with a choice
 * of installation) and on an installation's page (for that one).
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.sup_fehler_ungueltig,
  keine_installation: m.sup_fehler_keine_installation,
  zugang_aktiv: m.sup_fehler_zugang_aktiv,
  zugang_beendet: m.sup_fehler_zugang_beendet,
  kein_zugang: m.sup_fehler_zugang_beendet,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

export const zugangFehlerText = (fehler: string) => (FEHLER[fehler] ?? m.fehler_unbekannt)();

const DAUER_TEXT: Record<(typeof DAUERN)[number], () => string> = {
  60: m.sup_dauer_1h,
  120: m.sup_dauer_2h,
  240: m.sup_dauer_4h,
};

const feldKlasse =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] disabled:opacity-50";

/** A select with its visible label */
const Auswahl = (props: {
  name: string;
  label: string;
  wahl: { wert: string; text: string }[];
  vorgabe: string;
}) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {props.label}
      </label>
      <select id={id} name={props.name} required class={feldKlasse}>
        <For each={props.wahl}>
          {(w) => (
            <option value={w.wert} selected={w.wert === props.vorgabe}>
              {w.text}
            </option>
          )}
        </For>
      </select>
    </div>
  );
};

export type Wahl = { id: string; titel: string };

const Formular = (props: {
  installationen: Wahl[];
  installationId?: string | undefined;
  onClose: () => void;
  gestartet: (z: Zugang) => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await supportQuelle().starten(
      props.installationId ?? werte.installation ?? "",
      Number(werte.dauer ?? DAUER_VORGABE),
      werte.grund ?? "",
    );
    setLaeuft(false);
    if (!antwort.ok) return setFehler(zugangFehlerText(antwort.fehler));
    setFehler("");
    props.gestartet(antwort.daten);
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <Show when={props.installationId === undefined}>
        <Auswahl
          name="installation"
          label={m.sup_feld_installation()}
          wahl={props.installationen.map((i) => ({ wert: i.id, text: i.titel }))}
          vorgabe=""
        />
      </Show>
      <Auswahl
        name="dauer"
        label={m.sup_feld_dauer()}
        wahl={DAUERN.map((d) => ({ wert: String(d), text: DAUER_TEXT[d]() }))}
        vorgabe={String(DAUER_VORGABE)}
      />
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.sup_grund_platzhalter()}
        hint={m.feld_grund_hinweis()}
      />
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {m.sup_starten()}
        </Button>
      </div>
    </form>
  );
};

/**
 * The dialog "Zugang starten": for the one installation named, else with a choice among
 * `installationen`; `gestartet` once the Zentrale started it
 */
export const ZugangDialog = (props: {
  open: boolean;
  onClose: () => void;
  installationen?: Wahl[] | undefined;
  installationId?: string | undefined;
  gestartet: (z: Zugang) => void;
}) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.sup_starten_titel()}
    description={m.sup_starten_text()}
  >
    <Show when={props.open}>
      <Formular
        installationen={props.installationen ?? []}
        installationId={props.installationId}
        onClose={() => props.onClose()}
        gestartet={(z) => props.gestartet(z)}
      />
    </Show>
  </Dialog>
);

/** The button "Zugang starten" with its dialog */
export const ZugangStarten = (props: {
  installationen?: Wahl[];
  installationId?: string;
  klein?: boolean;
  gestartet: (z: Zugang) => void;
}) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <>
      <Button size={props.klein ? "sm" : undefined} onClick={() => setOffen(true)}>
        <Icon icon={LifeBuoy} />
        {m.sup_starten()}
      </Button>
      <ZugangDialog
        open={offen()}
        onClose={() => setOffen(false)}
        installationen={props.installationen}
        installationId={props.installationId}
        gestartet={(z) => {
          setOffen(false);
          props.gestartet(z);
        }}
      />
    </>
  );
};

/** Ends a running access now; `beendet` once the Zentrale ended it */
export const ZugangBeenden = (props: { zugang: Zugang; beendet: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const beenden = async () => {
    const antwort = await supportQuelle().beenden(props.zugang.zugangId);
    if (!antwort.ok) return setFehler(zugangFehlerText(antwort.fehler));
    setFehler("");
    props.beendet();
  };
  return (
    <>
      <Button size="sm" onClick={() => void beenden()}>
        <Icon icon={X} />
        {m.sup_beenden()}
      </Button>
      <Fehler text={fehler()} />
    </>
  );
};

/** Minutes left of a running access, at least 0 */
export const restMinuten = (z: Zugang, jetzt: number) =>
  Math.max(0, Math.ceil((z.endetAm - jetzt) / 60_000));

/** What happened during an access, for the list: its actions, or none */
export const wasGeschah = (z: Zugang): string =>
  z.aktionen.length === 0
    ? m.sup_kein_eingriff()
    : z.aktionen
        .map((a) => (a === "neustart" ? m.aktion_neustart() : m.aktion_log_auszug()))
        .join(", ");

/**
 * The note on an installation's page (mockup, "Support-Zugang"): what an access allows and
 * "Zugang starten", or, while the member's own runs, its time left, its reason and "Zugang beenden"
 */
export const ZugangHinweis = (props: {
  installationId: string;
  eigener: Zugang | undefined;
  jetzt: number;
  neu: () => void;
}) => (
  <div class="flex w-full flex-wrap items-start gap-3 rounded-lg border bg-background px-4 py-3">
    <span class="mt-0.5 text-muted-foreground">
      <Icon icon={LifeBuoy} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="mb-1 font-medium leading-none">{m.sup_hinweis_titel()}</p>
      <p class="text-muted-foreground">
        <Show when={props.eigener} fallback={m.sup_hinweis_text()}>
          {(z) => (
            <span>
              {m.sup_hinweis_aktiv({ minuten: restMinuten(z(), props.jetzt), grund: z().grund })}
            </span>
          )}
        </Show>
      </p>
    </div>
    <Show
      when={props.eigener}
      fallback={
        <ZugangStarten installationId={props.installationId} klein gestartet={() => props.neu()} />
      }
    >
      {(z) => <ZugangBeenden zugang={z()} beendet={() => props.neu()} />}
    </Show>
  </div>
);
