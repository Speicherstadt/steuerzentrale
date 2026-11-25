import { Button, Icon, m } from "@steuerzentrale/ui";
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  type IconNode,
  Pencil,
  Plus,
  Trash2,
} from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { prozentVon } from "../daten/aussen.ts";
import {
  type Dienst,
  type DienstStufe,
  diensteGeordnet,
  diensteQuelle,
  dienstStufe,
  dienstZustandText,
} from "../daten/dienste.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { prozent } from "../format/zahl.ts";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuKunde } from "../teile/verweise.tsx";
import { Fehler } from "./anmeldung-teile.tsx";
import { DienstDialog, DienstEntfernen, fehlerText } from "./dienst-dialoge.tsx";
import { inhaberRecht } from "./recht.tsx";

/*
 * Observed services on the page "Apps" (BAULISTE.md Z-1101): each with the mark "beobachtet", its
 * customer, its state from outside and its availability this month; no version, backup, update or
 * actions, as the Zentrale did not install it. The owner adds, changes and removes one; every role
 * sees them. Nobody is asked for a reason (BAULISTE.md, Stufe 2).
 */

const ZEICHEN: Record<DienstStufe, { icon: IconNode; farbe: string; text: string }> = {
  rot: { icon: CircleX, farbe: "text-destructive", text: "text-destructive" },
  unbekannt: { icon: CircleHelp, farbe: "text-muted-foreground", text: "" },
  gut: { icon: CircleCheck, farbe: "text-ok", text: "text-muted-foreground" },
};

const Zustand = (props: { d: Dienst }) => (
  <span class="inline-flex items-center gap-1.5">
    <Icon
      icon={ZEICHEN[dienstStufe(props.d)].icon}
      size={15}
      class={`shrink-0 ${ZEICHEN[dienstStufe(props.d)].farbe}`}
    />
    <span class={ZEICHEN[dienstStufe(props.d)].text}>{dienstZustandText(props.d)}</span>
  </span>
);

const Verfuegbarkeit = (props: { d: Dienst }) => {
  const p = () => prozentVon(props.d.verfuegbarkeit);
  return (
    <td class="whitespace-nowrap text-muted-foreground">
      {p() === undefined ? "–" : prozent(p() ?? 0, 2)}
    </td>
  );
};

const Zeile = (props: {
  d: Dienst;
  mitKunde: boolean;
  kundeName: (id: string) => string | undefined;
  darf: boolean;
  aendern: (d: Dienst) => void;
  entfernen: (d: Dienst) => void;
}) => (
  <Reihe class="[&>td]:align-middle">
    <td>
      <div class="grid gap-0.5">
        <span class="flex flex-wrap items-center gap-2 font-medium">
          {props.d.name}
          <span class="rounded-md border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {m.dienst_beobachtet()}
          </span>
        </span>
        <span class="font-mono text-xs text-muted-foreground">
          {props.d.host}
          {props.d.pfad === "/" ? "" : props.d.pfad}
        </span>
      </div>
    </td>
    <Show when={props.mitKunde}>
      <td>
        <Show when={props.d.kundeId} fallback={<span class="text-muted-foreground">–</span>}>
          {(id) => <ZuKunde id={id()}>{props.kundeName(id()) ?? id()}</ZuKunde>}
        </Show>
      </td>
    </Show>
    <td>
      <Zustand d={props.d} />
    </td>
    <Verfuegbarkeit d={props.d} />
    <Show when={props.darf}>
      <td class="whitespace-nowrap text-right">
        <span class="inline-flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={m.dienst_aendern_name({ name: props.d.name })}
            onClick={() => props.aendern(props.d)}
          >
            <Icon icon={Pencil} size={13} />
            {m.dienst_knopf_aendern()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={m.dienst_entfernen_name({ name: props.d.name })}
            onClick={() => props.entfernen(props.d)}
          >
            <Icon icon={Trash2} size={13} />
            {m.dienst_knopf_entfernen()}
          </Button>
        </span>
      </td>
    </Show>
  </Reihe>
);

/** Title and sentence of the section, and "Dienst beobachten" for the owner */
const Kopf = (props: { darf: boolean; neu: () => void }) => (
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="grid gap-1">
      <h2 class="text-base font-semibold">{m.dienste_titel()}</h2>
      <p class="text-muted-foreground">{m.dienste_text()}</p>
    </div>
    <Show when={props.darf}>
      <Button onClick={() => props.neu()}>
        <Icon icon={Plus} size={14} />
        {m.dienst_anlegen_titel()}
      </Button>
    </Show>
  </div>
);

/** The section "Beobachtete Dienste" with its table and the owner's dialogs */
export const Dienste = (props: { mitKunde: boolean }) => {
  const antwort = createMemo(() => diensteQuelle().liste());
  const kundenAntwort = createMemo(() => kundenQuelle().liste());
  const darf = inhaberRecht();
  const [neu, setNeu] = createSignal(false);
  const [bearbeitet, setBearbeitet] = createSignal<Dienst | undefined>(undefined);
  const [weg, setWeg] = createSignal<Dienst | undefined>(undefined);
  const dienste = () => {
    const a = antwort();
    return a.ok ? diensteGeordnet(a.daten) : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a.fehler);
  };
  const kundeName = (id: string) => {
    const k = kundenAntwort();
    return k.ok ? k.daten.find((x) => x.id === id)?.name : undefined;
  };
  const neuLaden = () => {
    setNeu(false);
    setBearbeitet(undefined);
    setWeg(undefined);
    refresh(antwort);
  };
  const spalten = () => [
    { name: m.dienst_spalte_dienst() },
    ...(props.mitKunde ? [{ name: m.inst_spalte_kunde() }] : []),
    { name: m.server_spalte_zustand() },
    { name: m.dienst_spalte_verfuegbarkeit() },
    ...(darf() ? [{ name: m.dienst_spalte_aktionen(), class: "text-right" }] : []),
  ];
  return (
    <div class="grid gap-3">
      <Loading fallback={null}>
        <Kopf darf={darf()} neu={() => setNeu(true)} />
      </Loading>
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <Fehler text={fehler()} />
        <Tabelle
          name={m.dienste_titel()}
          spalten={spalten()}
          minBreite={640}
          leer={m.dienste_leer()}
          anzahl={dienste().length}
        >
          <For each={dienste()}>
            {(d) => (
              <Zeile
                d={d}
                mitKunde={props.mitKunde}
                kundeName={kundeName}
                darf={darf()}
                aendern={setBearbeitet}
                entfernen={setWeg}
              />
            )}
          </For>
        </Tabelle>
      </Loading>
      <DienstDialog
        open={neu() || bearbeitet() !== undefined}
        dienst={bearbeitet()}
        mitKunde={props.mitKunde}
        onClose={() => {
          setNeu(false);
          setBearbeitet(undefined);
        }}
        gespeichert={neuLaden}
      />
      <DienstEntfernen dienst={weg()} onClose={() => setWeg(undefined)} entfernt={neuLaden} />
    </div>
  );
};
