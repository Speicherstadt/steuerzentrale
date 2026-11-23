import type { JSX } from "@solidjs/web";
import { Button, Dialog, Input, m, TextArea } from "@steuerzentrale/ui";
import { createSignal, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { loeschungAm } from "../daten/ableitungen.ts";
import { kundenQuelle, type Stammdaten } from "../daten/kunden.ts";
import type { Kunde } from "../daten/typen.ts";
import { berlin, datum, isoTag } from "../format/zeit.ts";
import { Fehler, felder } from "./anmeldung-teile.tsx";

/*
 * The dialogs of the customer pages (DESIGN.md, "Dialog"): title, one sentence on what happens,
 * the fields, the reason for the audit log, Cancel and the main action. Each form mounts when its
 * dialog opens, so it starts from the customer's current values.
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.kunden_fehler_ungueltig,
  ende_vor_beginn: m.kunden_fehler_ende_vor_beginn,
  kein_kunde: m.kunden_fehler_kein_kunde,
  kuerzel_vergeben: m.kunden_fehler_kuerzel_vergeben,
  kuerzel_fest: m.kunden_fehler_kuerzel_fest,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

const fehlerText = (fehler: string) => (FEHLER[fehler] ?? m.fehler_unbekannt)();

type DialogProps = {
  open: boolean;
  onClose: () => void;
  /** After the Zentrale took the change, with the customer as it is now */
  gespeichert: (kunde: Kunde) => void;
};

/** The reason every write asks for; it stands in the audit log */
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

/**
 * A form that sends its fields once and reports the Zentrale's answer: an error stays in the
 * dialog, a success hands the customer on
 */
const Formular = (props: {
  senden: (werte: Record<string, string>) => Promise<Antwort<Kunde>>;
  gespeichert: (kunde: Kunde) => void;
  onClose: () => void;
  knopf: string;
  gefahr?: boolean;
  children: JSX.Element;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const absenden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await props.senden(werte);
    setLaeuft(false);
    if (antwort.ok) props.gespeichert(antwort.daten);
    else setFehler(fehlerText(antwort.fehler));
  };
  return (
    <form class="grid gap-4" onSubmit={absenden}>
      {props.children}
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
        <Button type="submit" variant={props.gefahr ? "danger" : "primary"} disabled={laeuft()}>
          {props.knopf}
        </Button>
      </div>
    </form>
  );
};

const stammdatenAus = (werte: Record<string, string>): Stammdaten => ({
  name: werte.name ?? "",
  kontakt: {
    name: werte.ansprechpartner ?? "",
    email: werte.email ?? "",
    ...(werte.telefon ? { telefon: werte.telefon } : {}),
  },
  ...(werte.notiz ? { notiz: werte.notiz } : {}),
  ...(werte.kuerzel ? { kuerzel: werte.kuerzel } : {}),
});

// KUERZEL of packages/manifest as an HTML pattern, which matches the whole value
const KUERZEL_MUSTER = "[a-z0-9]([a-z0-9\\-]{0,28}[a-z0-9])?";

/**
 * The short name in the addresses (Z-407): free for a new customer (empty: the Zentrale suggests
 * one from the name), fixed while an installation of the customer runs; a disabled field is not
 * sent, so the Zentrale keeps it
 */
const KuerzelFeld = (props: { kunde: Kunde | undefined }) => (
  <Input
    label={m.kunde_feld_kuerzel()}
    name="kuerzel"
    required={props.kunde !== undefined}
    maxlength={30}
    pattern={KUERZEL_MUSTER}
    autocomplete="off"
    value={props.kunde?.kuerzel ?? ""}
    disabled={props.kunde ? !props.kunde.kuerzelAenderbar : false}
    hint={
      !props.kunde
        ? m.kunde_kuerzel_hinweis_neu()
        : props.kunde.kuerzelAenderbar
          ? m.kunde_kuerzel_hinweis()
          : m.kunde_kuerzel_fest()
    }
  />
);

const KundenFelder = (props: { kunde?: Kunde; heute: number }) => (
  <>
    <Input
      label={m.kunde_feld_name()}
      name="name"
      required
      maxlength={200}
      autocomplete="off"
      value={props.kunde?.name ?? ""}
    />
    <KuerzelFeld kunde={props.kunde} />
    <Input
      label={m.kunde_feld_ansprechpartner()}
      name="ansprechpartner"
      required
      maxlength={200}
      autocomplete="off"
      value={props.kunde?.kontakt.name ?? ""}
    />
    <Input
      label={m.anm_email()}
      name="email"
      type="email"
      required
      maxlength={254}
      autocomplete="off"
      value={props.kunde?.kontakt.email ?? ""}
    />
    <Input
      label={m.kunde_feld_telefon()}
      name="telefon"
      type="tel"
      maxlength={50}
      autocomplete="off"
      value={props.kunde?.kontakt.telefon ?? ""}
    />
    <TextArea
      label={m.kunde_feld_notiz()}
      name="notiz"
      maxlength={2000}
      rows={3}
      value={props.kunde?.notiz ?? ""}
    />
    <Input
      label={m.kunde_feld_beginn()}
      name="beginn"
      type="date"
      required
      value={isoTag(props.kunde?.vertrag.beginn ?? props.heute)}
    />
  </>
);

/** A new customer with its contract, SLA Basis in stage 1 */
export const KundeAnlegen = (props: DialogProps & { heute: number }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.kunden_anlegen()}
    description={m.kunde_anlegen_text()}
  >
    <Show when={props.open}>
      <Formular
        knopf={m.kunde_knopf_anlegen()}
        onClose={() => props.onClose()}
        gespeichert={(k) => props.gespeichert(k)}
        senden={(werte) =>
          kundenQuelle().anlegen(
            {
              ...stammdatenAus(werte),
              vertrag: { sla: "basis", beginn: berlin(werte.beginn ?? "") },
            },
            werte.grund ?? "",
          )
        }
      >
        <KundenFelder heute={props.heute} />
        <GrundFeld platzhalter={m.kunde_grund_anlegen()} />
      </Formular>
    </Show>
  </Dialog>
);

/** Replaces the customer's details and the day its contract begins */
export const KundeAendern = (props: DialogProps & { kunde: Kunde }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.kunde_aendern_titel({ name: props.kunde.name })}
    description={m.kunde_aendern_text()}
  >
    <Show when={props.open}>
      <Formular
        knopf={m.kunde_knopf_speichern()}
        onClose={() => props.onClose()}
        gespeichert={(k) => props.gespeichert(k)}
        senden={(werte) =>
          kundenQuelle().aendern(
            props.kunde.id,
            { ...stammdatenAus(werte), beginn: berlin(werte.beginn ?? "") },
            werte.grund ?? "",
          )
        }
      >
        <KundenFelder kunde={props.kunde} heute={props.kunde.vertrag.beginn} />
        <GrundFeld platzhalter={m.kunde_grund_aendern()} />
      </Formular>
    </Show>
  </Dialog>
);

/** The day the contract ends, with the day of deletion it brings once a day is chosen */
const EndeFeld = (props: { beginn: number }) => {
  const [ende, setEnde] = createSignal("");
  const loeschung = () =>
    ende() ? m.kunde_kuendigen_loeschung({ datum: datum(loeschungAm(berlin(ende()))) }) : undefined;
  return (
    <Input
      label={m.kunde_feld_ende()}
      name="ende"
      type="date"
      required
      min={isoTag(props.beginn)}
      hint={loeschung()}
      onInput={(event) => setEnde(event.currentTarget.value)}
    />
  );
};

/** The customer gave notice: the day its contract ends, and when its data is deleted */
export const KundeKuendigen = (props: DialogProps & { kunde: Kunde }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.kunde_kuendigen_titel({ name: props.kunde.name })}
    description={m.kunde_kuendigen_text()}
  >
    <Show when={props.open}>
      <Formular
        knopf={m.kunde_knopf_kuendigen()}
        gefahr
        onClose={() => props.onClose()}
        gespeichert={(k) => props.gespeichert(k)}
        senden={(werte) =>
          kundenQuelle().kuendigen(props.kunde.id, berlin(werte.ende ?? ""), werte.grund ?? "")
        }
      >
        <EndeFeld beginn={props.kunde.vertrag.beginn} />
        <GrundFeld platzhalter={m.kunde_grund_kuendigen()} />
      </Formular>
    </Show>
  </Dialog>
);

/** The notice is taken back: the contract runs on, nothing is deleted */
export const KuendigungZuruecknehmen = (props: DialogProps & { kunde: Kunde; ende: number }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.kunde_zuruecknehmen_titel({ name: props.kunde.name })}
    description={m.kunde_zuruecknehmen_text({ datum: datum(loeschungAm(props.ende)) })}
  >
    <Show when={props.open}>
      <Formular
        knopf={m.kunde_zuruecknehmen()}
        onClose={() => props.onClose()}
        gespeichert={(k) => props.gespeichert(k)}
        senden={(werte) => kundenQuelle().zuruecknehmen(props.kunde.id, werte.grund ?? "")}
      >
        <GrundFeld platzhalter={m.kunde_grund_zuruecknehmen()} />
      </Formular>
    </Show>
  </Dialog>
);

/**
 * Our own customer, or no longer (Z-501): its installations form the wave "intern" and alone are
 * offered pre-releases; only the owner sees the button
 */
export const KundeIntern = (props: DialogProps & { kunde: Kunde }) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={
      props.kunde.intern
        ? m.kunde_extern_titel({ name: props.kunde.name })
        : m.kunde_intern_titel({ name: props.kunde.name })
    }
    description={props.kunde.intern ? m.kunde_extern_text() : m.kunde_intern_text()}
  >
    <Show when={props.open}>
      <Formular
        knopf={props.kunde.intern ? m.kunde_intern_aufheben() : m.kunde_intern_markieren()}
        onClose={() => props.onClose()}
        gespeichert={(k) => props.gespeichert(k)}
        senden={(werte) =>
          kundenQuelle().intern(props.kunde.id, !props.kunde.intern, werte.grund ?? "")
        }
      >
        <GrundFeld platzhalter={m.kunde_grund_intern()} />
      </Formular>
    </Show>
  </Dialog>
);
