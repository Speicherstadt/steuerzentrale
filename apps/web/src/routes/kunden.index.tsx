import { m, SearchInput } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Match, Switch } from "solid-js";
import { appVon, installationenVon, serverVonKunde } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import { datum } from "../format/zeit.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuKunde, ZuServer } from "../teile/verweise.tsx";
import { AppZeichen, Marke } from "../teile/zeichen.tsx";

/** Customers with contract, apps and servers (BAULISTE.md, Z-801); they never sign in here */
const Kunden = () => {
  const b = bestand();
  const [frage, setFrage] = createSignal("");
  const treffer = createMemo(() => {
    const q = frage().trim().toLowerCase();
    return b.kunden.filter((k) => !q || `${k.name} ${k.kontakt}`.toLowerCase().includes(q));
  });
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_kunden()} text={m.kunden_text()} />
      <div class="mt-2 w-full sm:w-72">
        <SearchInput
          label={m.kunden_suche()}
          placeholder={m.kunden_suche_platzhalter()}
          value={frage()}
          onInput={(event) => setFrage(event.currentTarget.value)}
        />
      </div>
      <Tabelle
        name={m.kunden_tabelle()}
        minBreite={900}
        leer={m.kunden_keine()}
        anzahl={treffer().length}
        spalten={[
          { name: m.inst_spalte_kunde() },
          { name: m.kunden_spalte_sla() },
          { name: m.nav_apps() },
          { name: m.nav_server() },
          { name: m.kunden_spalte_vertrag() },
        ]}
      >
        <For each={treffer()}>
          {(k) => (
            <Reihe>
              <td>
                <ZuKunde id={k.id}>
                  <span class="block font-medium">{k.name}</span>
                  <span class="block text-xs text-muted-foreground">{k.kontakt}</span>
                </ZuKunde>
              </td>
              <td>
                <Marke class="bg-accent">{m.sla_basis()}</Marke>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <For each={installationenVon(b, k.id)}>
                    {(i) => <AppZeichen app={appVon(b, i.app)} />}
                  </For>
                </div>
              </td>
              <td class="text-xs">
                <ul>
                  <For each={serverVonKunde(b, k.id)}>
                    {(s) => (
                      <li>
                        <ZuServer id={s.id}>{s.name}</ZuServer>
                      </li>
                    )}
                  </For>
                </ul>
              </td>
              <td class="text-xs">
                <Switch fallback={m.kunden_seit({ datum: datum(k.seit) })}>
                  <Match when={k.gekuendigt}>
                    {(g) => (
                      <span class="text-warn">
                        {m.kunde_gekuendigt_zum({ datum: datum(g().zum) })}
                      </span>
                    )}
                  </Match>
                  <Match when={k.intern}>
                    <span class="text-muted-foreground">{m.kunden_intern()}</span>
                  </Match>
                </Switch>
              </td>
            </Reihe>
          )}
        </For>
      </Tabelle>
    </div>
  );
};

export const Route = createFileRoute("/kunden/")({ component: Kunden });
