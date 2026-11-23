import { m } from "@steuerzentrale/ui";
import {
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  type IconNode,
  LoaderCircle,
  Minus,
} from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import type { AuftragDerZentrale } from "../daten/betrieb.ts";
import type { AuftragsZustand } from "../daten/installationen.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { aktionsText, auftragsZustandText } from "../seiten/installieren-texte.ts";
import { Reihe, Tabelle } from "./tabelle.tsx";
import { ZuInstallation, ZuServer } from "./verweise.tsx";
import { Zustand } from "./zeichen.tsx";

/** The jobs table of the overview and the jobs page, as the Zentrale lists them (Z-305, Z-406) */

const ZEICHEN: Record<AuftragsZustand, { icon: IconNode; farbe: string }> = {
  wartend: { icon: Hourglass, farbe: "text-muted-foreground" },
  bereit: { icon: Hourglass, farbe: "text-muted-foreground" },
  zugestellt: { icon: Clock, farbe: "text-info" },
  bestaetigt: { icon: Clock, farbe: "text-info" },
  laeuft: { icon: LoaderCircle, farbe: "text-info" },
  erfolgreich: { icon: CircleCheck, farbe: "text-ok" },
  gescheitert: { icon: CircleX, farbe: "text-destructive" },
  abgebrochen: { icon: Minus, farbe: "text-muted-foreground" },
};

/** The states of a job not ended yet (packages/protokoll, ENDZUSTAENDE) */
export const OFFEN: AuftragsZustand[] = ["wartend", "bereit", "zugestellt", "bestaetigt", "laeuft"];

const Ziel = (props: { a: AuftragDerZentrale }) => (
  <Show
    when={props.a.installation}
    fallback={<ZuServer id={props.a.server.serverId}>{props.a.server.name}</ZuServer>}
  >
    {(i) => (
      <>
        <ZuInstallation id={i().installationId}>{`${i().kunde} · ${props.a.app}`}</ZuInstallation>
        <span class="block text-muted-foreground">{props.a.server.name}</span>
      </>
    )}
  </Show>
);

export const AuftragTabelle = (props: {
  name: string;
  auftraege: AuftragDerZentrale[];
  rahmen?: boolean;
}) => (
  <Tabelle
    name={props.name}
    rahmen={props.rahmen ?? true}
    minBreite={820}
    leer={m.auftraege_keine()}
    anzahl={props.auftraege.length}
    spalten={[
      { name: m.auftraege_spalte_nr() },
      { name: m.auftraege_spalte_auftrag() },
      { name: m.auftraege_spalte_ziel() },
      { name: m.auftraege_spalte_zustand() },
      { name: m.auftraege_spalte_start() },
      { name: m.auftraege_spalte_schritt() },
    ]}
  >
    <For each={props.auftraege}>
      {(a) => (
        <Reihe>
          <td class="font-mono text-xs" title={a.auftragId}>
            {a.auftragId.slice(0, 8)}
          </td>
          <td class="font-medium">
            {aktionsText(a.aktion)}
            <span class="block font-mono text-xs font-normal text-muted-foreground">
              {[a.app, a.version].filter(Boolean).join(" ")}
            </span>
          </td>
          <td class="text-xs">
            <Ziel a={a} />
          </td>
          <td>
            <Zustand
              icon={ZEICHEN[a.zustand].icon}
              farbe={ZEICHEN[a.zustand].farbe}
              text={auftragsZustandText(a.zustand)}
            />
          </td>
          <td class="text-xs whitespace-nowrap tabular-nums">
            {zeitpunkt(a.angelegtAm, bestand().jetzt)}
          </td>
          <td class="text-xs break-words text-muted-foreground">
            {a.fehler ?? a.fortschritt ?? "–"}
          </td>
        </Reihe>
      )}
    </For>
  </Tabelle>
);
