import { Button, Icon, m, SearchInput } from "@steuerzentrale/ui";
import { UserPlus } from "@steuerzentrale/ui/icons";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, Match, refresh, Show, Switch } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import { desKunden, type InstallationAnsicht } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { bestand } from "../daten/quelle.ts";
import type { Kunde } from "../daten/typen.ts";
import { datum } from "../format/zeit.ts";
import { slaName } from "../rahmen/texte.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { KundeAnlegen } from "../seiten/kunden-dialoge.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuKunde, ZuServer } from "../teile/verweise.tsx";
import { AppZeichen, Marke } from "../teile/zeichen.tsx";

/**
 * Customers with contract, apps and servers (BAULISTE.md, Z-801); they never sign in here.
 * Customers and their installations come from the Zentrale (Z-406).
 */

const passt = (k: Kunde, frage: string) => {
  const q = frage.trim().toLowerCase();
  return !q || `${k.name} ${k.kontakt.name} ${k.kontakt.email}`.toLowerCase().includes(q);
};

const Vertrag = (props: { k: Kunde }) => (
  <Switch fallback={m.kunden_seit({ datum: datum(props.k.vertrag.beginn) })}>
    <Match when={props.k.vertrag.ende}>
      {(ende) => <span class="text-warn">{m.kunde_gekuendigt_zum({ datum: datum(ende()) })}</span>}
    </Match>
    <Match when={props.k.intern}>
      <span class="text-muted-foreground">{m.kunden_intern()}</span>
    </Match>
  </Switch>
);

/** The servers a customer's installations run on, each once */
const serverDer = (liste: InstallationAnsicht[]) => [
  ...new Map(liste.map((i) => [i.serverId, i.serverName])).entries(),
];

const App = (props: { i: InstallationAnsicht }) => (
  <Show
    when={suche(bestand().apps, props.i.app)}
    fallback={<Marke class="font-mono">{props.i.appName}</Marke>}
  >
    {(a) => <AppZeichen app={a()} />}
  </Show>
);

const Zeilen = (props: { kunden: Kunde[]; installationen: InstallationAnsicht[] }) => {
  return (
    <For each={props.kunden}>
      {(k) => (
        <Reihe>
          <td>
            <ZuKunde id={k.id}>
              <span class="block font-medium">{k.name}</span>
              <span class="block text-xs text-muted-foreground">{k.kontakt.email}</span>
            </ZuKunde>
          </td>
          <td>
            <Marke class="bg-accent">{slaName(k.vertrag.sla)}</Marke>
          </td>
          <td>
            <div class="flex flex-wrap gap-1">
              <For each={desKunden(props.installationen, k.id)}>{(i) => <App i={i} />}</For>
            </div>
          </td>
          <td class="text-xs">
            <ul>
              <For each={serverDer(desKunden(props.installationen, k.id))}>
                {([id, name]) => (
                  <li>
                    <ZuServer id={id}>{name}</ZuServer>
                  </li>
                )}
              </For>
            </ul>
          </td>
          <td class="text-xs">
            <Vertrag k={k} />
          </td>
        </Reihe>
      )}
    </For>
  );
};

const Kunden = () => {
  const navigate = useNavigate();
  const [frage, setFrage] = createSignal("");
  const [anlegen, setAnlegen] = createSignal(false);
  const antwort = createMemo(() => kundenQuelle().liste());
  const installationen = createMemo(() => uebersichtLaden());
  const treffer = createMemo(() => {
    const a = antwort();
    return a.ok ? a.daten.filter((k) => passt(k, frage())) : [];
  });
  const liste = () => {
    const a = installationen();
    return a.ok ? a.daten.installationen : [];
  };
  const fehler = () => {
    const a = antwort();
    const i = installationen();
    return a.ok ? (i.ok ? "" : fehlerText(i)) : fehlerText(a);
  };
  const angelegt = (k: Kunde) => {
    setAnlegen(false);
    refresh(antwort);
    void navigate({ to: "/kunden/$id", params: { id: k.id } });
  };
  return (
    <div class="grid gap-4">
      <Seitenkopf
        titel={m.nav_kunden()}
        text={m.kunden_text()}
        aktion={
          <Button variant="primary" onClick={() => setAnlegen(true)}>
            <Icon icon={UserPlus} />
            {m.kunden_anlegen()}
          </Button>
        }
      />
      <div class="mt-2 w-full sm:w-72">
        <SearchInput
          label={m.kunden_suche()}
          placeholder={m.kunden_suche_platzhalter()}
          value={frage()}
          onInput={(event) => setFrage(event.currentTarget.value)}
        />
      </div>
      <Loading fallback={<p class="text-muted-foreground">{m.kunden_laden()}</p>}>
        <Show when={!fehler()} fallback={<Fehler text={fehler()} />}>
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
            <Zeilen kunden={treffer()} installationen={liste()} />
          </Tabelle>
        </Show>
      </Loading>
      <KundeAnlegen
        open={anlegen()}
        heute={Date.now()}
        onClose={() => setAnlegen(false)}
        gespeichert={angelegt}
      />
    </div>
  );
};

export const Route = createFileRoute("/kunden/")({ component: Kunden });
