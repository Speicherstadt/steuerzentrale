import { Button, Icon, Menu, type MenuItem, m } from "@steuerzentrale/ui";
import {
  Building2,
  CalendarX,
  CircleCheck,
  CircleHelp,
  type IconNode,
  LoaderCircle,
  Pencil,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import { useNavigate } from "@tanstack/solid-router";
import { Loading, Show } from "solid-js";
import type { KundeStand } from "../daten/kunde-ansicht.ts";
import type { Kunde } from "../daten/typen.ts";
import { datum } from "../format/zeit.ts";
import { anzahl } from "../rahmen/texte.ts";
import { Marke } from "../teile/zeichen.tsx";
import { Installieren } from "./installieren.tsx";
import {
  KuendigungZuruecknehmen,
  KundeAendern,
  KundeIntern,
  KundeKuendigen,
} from "./kunden-dialoge.tsx";
import { inhaberRecht } from "./recht.tsx";

/*
 * The head of a customer's page (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * initials and name, its apps in one sentence and its contract; "App installieren" (Z-402),
 * "Ändern" and "Mehr …" with marking it internal (the owner, Z-501) and giving notice (Z-801), each
 * in its dialog with a reason. Taking a notice back stands in the note of the notice.
 */

export type Offen = "aendern" | "kuendigen" | "zuruecknehmen" | "intern" | undefined;

const initialen = (name: string) =>
  name
    .split(" ")
    .map((teil) => teil[0])
    .join("")
    .slice(0, 2);

const apps = (n: number) => anzahl(n, m.server_eine_app, m.server_apps);

/** Its apps in one sentence, with the icon of the worst */
const standZeichen = (s: KundeStand): { icon: IconNode; farbe: string; text: string } => {
  switch (s.art) {
    case "keine":
      return { icon: CircleHelp, farbe: "text-muted-foreground", text: m.kunde_keine_app() };
    case "laufen":
      return {
        icon: CircleCheck,
        farbe: "text-ok",
        text: m.kunde_alle_laufen({ apps: apps(s.apps) }),
      };
    case "unterwegs":
      return {
        icon: LoaderCircle,
        farbe: "text-muted-foreground",
        text: m.kunde_unterwegs({ apps: apps(s.apps) }),
      };
    case "braucht":
      return {
        icon: TriangleAlert,
        farbe: "text-warn",
        text: m.kunde_braucht({ apps: apps(s.apps), n: s.braucht }),
      };
  }
};

const StandWorte = (props: { stand: KundeStand }) => (
  <span class="inline-flex items-center gap-1.5">
    <Icon
      icon={standZeichen(props.stand).icon}
      size={15}
      class={`shrink-0 ${standZeichen(props.stand).farbe}`}
    />
    {standZeichen(props.stand).text}
  </span>
);

/** Its contract; a notice stands in its own note below the head */
const vertragText = (k: Kunde) => m.kunde_vertrag_seit({ datum: datum(k.vertrag.beginn) });

/** The other actions in "Mehr …": internal for the owner, notice while the contract runs */
const Mehr = (props: { k: Kunde; oeffne: (dialog: Offen) => void }) => {
  const inhaber = inhaberRecht();
  const eintraege = (): MenuItem[] => [
    ...(inhaber()
      ? [
          {
            label: props.k.intern ? m.kunde_intern_aufheben() : m.kunde_intern_markieren(),
            icon: Building2,
            onSelect: () => props.oeffne("intern"),
          },
        ]
      : []),
    ...(props.k.vertrag.ende === null && !props.k.intern
      ? [{ label: m.kunde_kuendigen(), icon: CalendarX, onSelect: () => props.oeffne("kuendigen") }]
      : []),
  ];
  return (
    <Loading fallback={null}>
      <Show when={eintraege().length > 0}>
        <Menu label={m.app_mehr()} trigger={m.app_mehr()} items={eintraege()} />
      </Show>
    </Loading>
  );
};

export const KundeKopf = (props: {
  k: Kunde;
  stand: KundeStand;
  oeffne: (dialog: Offen) => void;
}) => {
  const navigate = useNavigate();
  return (
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          class="flex size-13 shrink-0 items-center justify-center rounded-full border bg-muted font-medium"
        >
          {initialen(props.k.name)}
        </span>
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold tracking-tight break-words">{props.k.name}</h1>
            <Show when={props.k.intern}>
              <Marke>{m.kunden_intern()}</Marke>
            </Show>
          </div>
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Loading fallback={null}>
              <StandWorte stand={props.stand} />
            </Loading>
            <span class="text-muted-foreground">· {vertragText(props.k)}</span>
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.k.vertrag.ende === null}>
          <Installieren
            kundeId={props.k.id}
            onAngelegt={(i) => void navigate({ to: "/apps/$id", params: { id: i.installationId } })}
          />
        </Show>
        <Button onClick={() => props.oeffne("aendern")}>
          <Icon icon={Pencil} />
          {m.kunde_aendern()}
        </Button>
        <Mehr k={props.k} oeffne={props.oeffne} />
      </div>
    </div>
  );
};

export const KundeDialoge = (props: {
  k: Kunde;
  offen: Offen;
  oeffne: (dialog: Offen) => void;
  gespeichert: () => void;
}) => {
  const schliessen = () => props.oeffne(undefined);
  const fertig = () => {
    schliessen();
    props.gespeichert();
  };
  return (
    <>
      <KundeAendern
        open={props.offen === "aendern"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <KundeKuendigen
        open={props.offen === "kuendigen"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <KundeIntern
        open={props.offen === "intern"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <Show when={props.k.vertrag.ende}>
        {(ende) => (
          <KuendigungZuruecknehmen
            open={props.offen === "zuruecknehmen"}
            kunde={props.k}
            ende={ende()}
            onClose={schliessen}
            gespeichert={fertig}
          />
        )}
      </Show>
    </>
  );
};
