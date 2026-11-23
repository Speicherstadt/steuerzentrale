import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, CircleDashed } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import { appVon } from "../daten/ableitungen.ts";
import type { Bestand, Ebene, Installation, Variable } from "../daten/typen.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";

/** The tab "Einstellungen" of an installation the demo knows */

const EBENEN: Ebene[] = ["installation", "betreiber", "auto"];

const Wert = (props: { b: Bestand; i: Installation; v: Variable }) => {
  const betreiber = () => props.b.betreiber;
  const gesetzt = () =>
    props.v.geheim
      ? betreiber().geheimGesetzt.includes(props.v.name)
      : Boolean(betreiber().werte[props.v.name]);
  return (
    <Show
      when={props.v.ebene !== "auto"}
      fallback={<span class="text-xs text-muted-foreground">{m.inst_wert_auto()}</span>}
    >
      <Show
        when={props.v.ebene === "betreiber"}
        fallback={
          <span class="font-mono text-xs">
            {props.i.werte[props.v.name] ?? props.v.vorgabe ?? "–"}
          </span>
        }
      >
        <span class="text-xs">
          <Show
            when={gesetzt()}
            fallback={<span class="font-medium text-warn">{m.inst_wert_fehlt()}</span>}
          >
            {props.v.geheim ? m.inst_wert_gesetzt() : betreiber().werte[props.v.name]}
          </Show>{" "}
          <span class="text-muted-foreground">{m.inst_wert_betreiber()}</span>
        </span>
      </Show>
    </Show>
  );
};

export const InstallationEinstellungen = (props: { b: Bestand; i: Installation }) => {
  const app = () => appVon(props.b, props.i.app);
  const variablen = () => EBENEN.flatMap((e) => app().variablen.filter((v) => v.ebene === e));
  return (
    <div class="grid gap-4">
      <Karte class="overflow-hidden">
        <KartenKopf titel={m.inst_einstellungen_titel()} text={m.inst_einstellungen_text()} />
        <div class="border-t">
          <Tabelle
            name={m.inst_einstellungen_titel()}
            rahmen={false}
            minBreite={560}
            leer={m.inst_keine_variablen()}
            anzahl={variablen().length}
            spalten={[{ name: m.inst_variable() }, { name: m.inst_wert() }]}
          >
            <For each={variablen()}>
              {(v) => (
                <Reihe>
                  <td>
                    <code class="font-mono text-xs">{v.name}</code>
                    <Show when={v.pflicht}>
                      <span class="ml-1 text-xs text-warn">{m.inst_pflicht()}</span>
                    </Show>
                    <span class="block text-xs text-muted-foreground">{v.hinweis}</span>
                  </td>
                  <td>
                    <Wert b={props.b} i={props.i} v={v} />
                  </td>
                </Reihe>
              )}
            </For>
          </Tabelle>
        </div>
      </Karte>
      <Show when={app().optionen.length > 0}>
        <Karte>
          <KartenKopf titel={m.inst_optionen()} text={m.inst_optionen_text()} />
          <KartenInhalt>
            <ul class="grid gap-2 sm:grid-cols-2">
              <For each={app().optionen}>
                {(o) => (
                  <li class="flex items-center gap-3 rounded-lg border p-3">
                    <Icon
                      icon={props.i.optionen.includes(o.id) ? CircleCheck : CircleDashed}
                      class={props.i.optionen.includes(o.id) ? "text-ok" : "text-muted-foreground"}
                    />
                    <span class="flex-1">{o.name}</span>
                    <span class="text-xs text-muted-foreground">
                      {props.i.optionen.includes(o.id) ? m.inst_option_an() : m.inst_option_aus()}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </KartenInhalt>
        </Karte>
      </Show>
    </div>
  );
};
