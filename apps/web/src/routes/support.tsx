import { Icon, m } from "@steuerzentrale/ui";
import { Timer } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { For } from "solid-js";
import { installationVon, titel } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Zugang } from "../daten/typen.ts";
import { minuten } from "../format/zahl.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { rolleName } from "../rahmen/texte.ts";
import { Balken } from "../teile/balken.tsx";
import { Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZielVerweis } from "../teile/verweise.tsx";
import { Marke } from "../teile/zeichen.tsx";

/** Time-limited access to an installation, with a reason, logged (BAULISTE.md, Z-802) */

const VORGABE_MINUTEN = 120;

const Aktiv = (props: { b: Bestand; z: Zugang }) => {
  const rest = () => props.z.restMinuten ?? 0;
  return (
    <Karte>
      <KartenKopf
        titel={titel(props.b, installationVon(props.b, props.z.installation))}
        text={m.sup_wer({
          wer: props.z.wer,
          rolle: rolleName(props.z.rolle),
          seit: zeitpunkt(props.z.start, props.b.jetzt),
        })}
        aktion={
          <Marke class="tabular-nums">
            <Icon icon={Timer} size={14} />
            {m.sup_rest({ minuten: rest() })}
          </Marke>
        }
      />
      <KartenInhalt>
        <p>
          <span class="text-muted-foreground">{m.sup_grund()}</span> {props.z.grund}
        </p>
        <Balken
          name={m.sup_verbraucht({ id: props.z.id })}
          wert={Math.round(((VORGABE_MINUTEN - rest()) / VORGABE_MINUTEN) * 100)}
          class="mt-3"
        />
      </KartenInhalt>
    </Karte>
  );
};

const Support = () => {
  const b = bestand();
  const aktiv = b.zugaenge.filter((z) => z.restMinuten !== undefined);
  const beendet = b.zugaenge.filter((z) => z.restMinuten === undefined);
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_support()} text={m.sup_text()} />
      <div class="mt-2 grid gap-4 lg:grid-cols-2">
        <For
          each={aktiv}
          fallback={
            <Karte>
              <KartenInhalt class="pt-5">
                <p class="text-muted-foreground">{m.sup_keiner()}</p>
              </KartenInhalt>
            </Karte>
          }
        >
          {(z) => <Aktiv b={b} z={z} />}
        </For>
      </div>
      <Karte class="overflow-hidden">
        <KartenKopf titel={m.sup_beendet()} />
        <div class="border-t">
          <Tabelle
            name={m.sup_beendet()}
            rahmen={false}
            minBreite={800}
            leer={m.sup_keine_beendet()}
            anzahl={beendet.length}
            spalten={[
              { name: m.bak_spalte_installation() },
              { name: m.sup_spalte_wer() },
              { name: m.sup_spalte_grund() },
              { name: m.auftraege_spalte_start() },
              { name: m.sup_spalte_dauer() },
              { name: m.sup_spalte_ergebnis() },
            ]}
          >
            <For each={beendet}>
              {(z) => (
                <Reihe>
                  <td>
                    <ZielVerweis ziel={{ art: "installation", id: z.installation }} />
                  </td>
                  <td class="text-xs">{z.wer}</td>
                  <td class="text-xs">{z.grund}</td>
                  <td class="text-xs tabular-nums">{zeitpunkt(z.start, b.jetzt)}</td>
                  <td class="text-xs tabular-nums">{minuten(z.minuten)}</td>
                  <td class="text-xs text-muted-foreground">{z.ergebnis}</td>
                </Reihe>
              )}
            </For>
          </Tabelle>
        </div>
      </Karte>
    </div>
  );
};

export const Route = createFileRoute("/support")({ component: Support });
