import { Button, Dialog, Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, createUniqueId, For, Loading, Show } from "solid-js";
import { type Dienst, type DienstAngaben, diensteQuelle } from "../daten/dienste.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { InnenFelder, innenAusFeldern } from "./dienst-innen-felder.tsx";

/*
 * The dialogs of the observed services (BAULISTE.md Z-1101; DESIGN.md, "Dialog"): adding or changing
 * one with its name, address, health path, customer and, on an observed server, the units its agent
 * reads (Z-1103), and removing one. Nobody is asked for a reason (BAULISTE.md, Stufe 2); the
 * Zentrale's refusal stays in the dialog.
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.dienst_fehler_ungueltig,
  kein_dienst: m.dienst_fehler_kein_dienst,
  kein_kunde: m.dienst_fehler_kein_kunde,
  kein_server: m.dienst_fehler_kein_server,
  server_verwaltet: m.dienst_fehler_server_verwaltet,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

export const fehlerText = (fehler: string) => (FEHLER[fehler] ?? m.fehler_unbekannt)();

const feldKlasse =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] disabled:opacity-50";

/** The customer, or none: a service may be the operator's own */
const KundenWahl = (props: { vorgabe: string | null }) => {
  const antwort = createMemo(() => kundenQuelle().liste());
  const kunden = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  const id = createUniqueId();
  return (
    <Loading fallback={null}>
      <div class="grid gap-1.5">
        <label for={id} class="text-xs font-medium">
          {m.dienst_feld_kunde()}
        </label>
        <select id={id} name="kundeId" class={feldKlasse}>
          <option value="" selected={props.vorgabe === null}>
            {m.dienst_ohne_kunde()}
          </option>
          <For each={kunden()}>
            {(k) => (
              <option value={k.id} selected={k.id === props.vorgabe}>
                {k.name}
              </option>
            )}
          </For>
        </select>
      </div>
    </Loading>
  );
};

type FormularProps = {
  dienst?: Dienst | undefined;
  mitKunde: boolean;
  onClose: () => void;
  gespeichert: () => void;
};

const Formular = (props: FormularProps) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const absenden = async (event: SubmitEvent) => {
    const w = felder(event);
    const angaben: DienstAngaben = {
      name: w.name ?? "",
      adresse: w.adresse ?? "",
      pfad: w.pfad ?? "/",
      // without customers ("Nur für mich") a service keeps what it had
      kundeId: props.mitKunde ? (w.kundeId ?? null) : (props.dienst?.kundeId ?? null),
      innen: innenAusFeldern(w),
    };
    setLaeuft(true);
    const antwort = props.dienst
      ? await diensteQuelle().aendern(props.dienst.id, angaben)
      : await diensteQuelle().anlegen(angaben);
    setLaeuft(false);
    if (antwort.ok) props.gespeichert();
    else setFehler(fehlerText(antwort.fehler));
  };
  return (
    <form class="grid gap-4" onSubmit={absenden}>
      <Input
        label={m.dienst_feld_name()}
        name="name"
        required
        maxlength={200}
        autocomplete="off"
        value={props.dienst?.name ?? ""}
      />
      <Input
        label={m.dienst_feld_adresse()}
        name="adresse"
        required
        maxlength={300}
        inputmode="url"
        autocomplete="off"
        placeholder={m.dienst_adresse_platzhalter()}
        pattern="https://[^\/:?#@\s]+\/?"
        value={props.dienst?.adresse ?? ""}
        hint={m.dienst_adresse_hinweis()}
      />
      <Input
        label={m.dienst_feld_pfad()}
        name="pfad"
        maxlength={200}
        autocomplete="off"
        placeholder="/"
        pattern="/[^?#\s]*"
        value={props.dienst?.pfad ?? ""}
        hint={m.dienst_pfad_hinweis()}
      />
      <Show when={props.mitKunde}>
        <KundenWahl vorgabe={props.dienst?.kundeId ?? null} />
      </Show>
      <InnenFelder innen={props.dienst?.innen ?? null} />
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {props.dienst ? m.knopf_speichern() : m.dienst_knopf_anlegen()}
        </Button>
      </div>
    </form>
  );
};

/** Adding a service, or changing one; the form mounts when the dialog opens */
export const DienstDialog = (props: FormularProps & { open: boolean }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={props.dienst ? m.dienst_aendern_titel() : m.dienst_anlegen_titel()}
    description={m.dienst_anlegen_text()}
  >
    <Show when={props.open}>
      <Formular
        dienst={props.dienst}
        mitKunde={props.mitKunde}
        onClose={() => props.onClose()}
        gespeichert={() => props.gespeichert()}
      />
    </Show>
  </Dialog>
);

export const DienstEntfernen = (props: {
  dienst: Dienst | undefined;
  onClose: () => void;
  entfernt: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const entfernen = async () => {
    if (!props.dienst) return;
    const antwort = await diensteQuelle().entfernen(props.dienst.id);
    if (antwort.ok) props.entfernt();
    else setFehler(fehlerText(antwort.fehler));
  };
  return (
    <Dialog
      open={props.dienst !== undefined}
      onClose={() => props.onClose()}
      title={m.dienst_entfernen_titel({ name: props.dienst?.name ?? "" })}
      description={m.dienst_entfernen_text()}
    >
      <div class="grid gap-4">
        <Fehler text={fehler()} />
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
          <Button variant="danger" onClick={entfernen}>
            {m.dienst_knopf_entfernen()}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
