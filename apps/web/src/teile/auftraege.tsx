import { m } from "@steuerzentrale/ui";
import {
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  type IconNode,
  LoaderCircle,
} from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Auftrag, AuftragZustand, Bestand } from "../daten/typen.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { auftragName } from "../rahmen/texte.ts";
import { Balken } from "./balken.tsx";
import { Reihe, Tabelle } from "./tabelle.tsx";
import { ZielVerweis } from "./verweise.tsx";
import { Zustand } from "./zeichen.tsx";

/** The jobs table of the overview and the jobs page (BAULISTE.md, Z-305) */

const ZUSTAND: Record<AuftragZustand, { icon: IconNode; farbe: string; text: () => string }> = {
  wartet: { icon: Hourglass, farbe: "text-muted-foreground", text: () => m.auftrag_wartet() },
  laeuft: { icon: LoaderCircle, farbe: "text-info", text: () => m.auftrag_laeuft() },
  fertig: { icon: CircleCheck, farbe: "text-ok", text: () => m.auftrag_fertig() },
  gescheitert: { icon: CircleX, farbe: "text-destructive", text: () => m.auftrag_gescheitert() },
  geplant: { icon: Clock, farbe: "text-muted-foreground", text: () => m.auftrag_geplant() },
};

/** The app a job is about, for its name ("Update auf Haben 1.9.0") */
const appDesAuftrags = (b: Bestand, a: Auftrag) => {
  if (a.ziel.art !== "installation") return undefined;
  const i = suche(b.installationen, a.ziel.id);
  return i && suche(b.apps, i.app);
};

export const AuftragTabelle = (props: { name: string; auftraege: Auftrag[]; rahmen?: boolean }) => {
  const b = bestand();
  return (
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
            <td class="font-mono text-xs">{a.id}</td>
            <td class="font-medium">{auftragName(a, appDesAuftrags(b, a))}</td>
            <td class="text-xs">
              <ZielVerweis ziel={a.ziel} />
            </td>
            <td>
              <Zustand
                icon={ZUSTAND[a.zustand].icon}
                farbe={ZUSTAND[a.zustand].farbe}
                text={ZUSTAND[a.zustand].text()}
              />
            </td>
            <td class="text-xs whitespace-nowrap tabular-nums">{zeitpunkt(a.start, b.jetzt)}</td>
            <td class="text-xs text-muted-foreground">
              {a.schritt}
              <Show when={a.zustand === "laeuft" && a.fortschritt !== undefined}>
                <Balken
                  name={m.auftraege_fortschritt({ id: a.id })}
                  wert={a.fortschritt ?? 0}
                  class="mt-1 w-32"
                />
              </Show>
            </td>
          </Reihe>
        )}
      </For>
    </Tabelle>
  );
};
