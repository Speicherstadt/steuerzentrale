import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { For } from "solid-js";
import { appVon, installationenVon, monatVon, supportMinuten } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand } from "../daten/typen.ts";
import { gb, minuten, prozent } from "../format/zahl.ts";
import { monatName, monatUndVormonat } from "../format/zeit.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuKunde } from "../teile/verweise.tsx";
import { AppZeichen } from "../teile/zeichen.tsx";

/** What each customer used in a month (BAULISTE.md, Z-804); invoices are the portal's business */

const Monat = (props: { b: Bestand; monat: string }) => {
  const zeilen = () =>
    props.b.kunden
      // A month before the contract began has nothing to show, not 100 % of nothing
      .filter((k) => !k.intern && monatVon(k.seit) <= props.monat)
      .map((k) => {
        const installationen = installationenVon(props.b, k.id);
        return {
          k,
          installationen,
          verfuegbar: Math.min(
            100,
            ...installationen.map((i) => i.verfuegbarkeit[props.monat] ?? 100),
          ),
          daten: installationen.reduce((summe, i) => summe + i.datenGb, 0),
          support: supportMinuten(props.b, k.id, props.monat),
        };
      });
  return (
    <Tabelle
      name={m.leist_tabelle({ monat: monatName(props.monat) })}
      minBreite={800}
      leer={m.kunden_keine()}
      anzahl={zeilen().length}
      spalten={[
        { name: m.inst_spalte_kunde() },
        { name: m.nav_installationen() },
        { name: m.inst_verfuegbarkeit(), class: "text-right" },
        { name: m.inst_spalte_daten(), class: "text-right" },
        { name: m.nav_support(), class: "text-right" },
      ]}
    >
      <For each={zeilen()}>
        {(z) => (
          <Reihe>
            <td>
              <ZuKunde id={z.k.id} class="font-medium">
                {z.k.name}
              </ZuKunde>
            </td>
            <td>
              <div class="flex flex-wrap gap-1">
                <For each={z.installationen}>
                  {(i) => <AppZeichen app={appVon(props.b, i.app)} />}
                </For>
              </div>
            </td>
            <td class="text-right font-mono text-xs tabular-nums">{prozent(z.verfuegbar, 2)}</td>
            <td class="text-right font-mono text-xs tabular-nums">{gb(z.daten)}</td>
            <td class="text-right text-xs tabular-nums">{z.support ? minuten(z.support) : "–"}</td>
          </Reihe>
        )}
      </For>
    </Tabelle>
  );
};

const Leistungen = () => {
  const b = bestand();
  const [vorher, jetzt] = monatUndVormonat(b.jetzt);
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_leistungen()} text={m.leist_text()} />
      <Tabs
        label={m.leist_monate()}
        initial={jetzt}
        tabs={[vorher, jetzt].map((monat) => ({
          id: monat,
          label: monatName(monat),
          content: () => <Monat b={b} monat={monat} />,
        }))}
      />
    </div>
  );
};

export const Route = createFileRoute("/leistungen")({ component: Leistungen });
