import { m, SearchInput } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, Loading, refresh } from "solid-js";
import {
  appZeilen,
  FILTER,
  type Filter,
  type Gruppierung,
  gefiltert,
  gruppiert,
  passt,
} from "../daten/apps-liste.ts";
import { betriebsartLesen, nurFuerMich } from "../daten/betriebsart.ts";
import { appsListeLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { AppsTabelle } from "../seiten/apps-tabelle.tsx";
import { Dienste } from "../seiten/dienste.tsx";
import { Installieren } from "../seiten/installieren.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Schalter } from "../teile/schalter.tsx";

/**
 * Every app of the operator in one table (BAULISTE.md Z-402; docs/plan.md, "Navigation (Oberfläche
 * 2026-11)"): what needs attention first, filtered to what needs someone or can be updated, as a
 * list or grouped by customer or server, with a search, and the dialog "App installieren". The
 * state, version, backup and server of each from the Zentrale (daten/apps-liste.ts); in the
 * Betriebsart "Nur für mich" without the column "Kunde", as every app is the operator's own. Under
 * it the observed services (Z-1101), which the Zentrale checks from outside only.
 */

const FILTERNAMEN: Record<Filter, () => string> = {
  alle: () => m.filter_alle(),
  braucht: () => m.apps_filter_braucht(),
  update: () => m.apps_filter_update(),
};

const Apps = () => {
  const [filter, setFilter] = createSignal<Filter>("alle");
  const [gruppe, setGruppe] = createSignal<Gruppierung>("none");
  const [frage, setFrage] = createSignal("");
  const antwort = createMemo(() => appsListeLaden());
  const art = createMemo(() => betriebsartLesen());
  const zeilen = createMemo(() => {
    const a = antwort();
    if (!a.ok) return [];
    return appZeilen({ ...a.daten, jetzt: bestand().jetzt });
  });
  const treffer = createMemo(() => gefiltert(zeilen(), filter(), frage()));
  const gruppen = () => {
    const g = gruppe();
    return g === "none" ? null : gruppiert(treffer(), g);
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Seitenkopf
        titel={m.nav_apps()}
        text={m.apps_liste_text()}
        aktion={<Installieren onAngelegt={() => refresh(antwort)} />}
      />
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex max-w-full flex-wrap items-center gap-2">
            <Schalter
              name={m.inst_filter()}
              aktuell={filter()}
              onWahl={setFilter}
              wahl={FILTER.map((f) => ({
                wert: f,
                name: FILTERNAMEN[f](),
                anzahl: zeilen().filter((z) => passt(z, f)).length,
              }))}
            />
            <span aria-hidden="true" class="ml-1 text-xs text-muted-foreground">
              {m.apps_gruppieren()}
            </span>
            <Schalter
              name={m.apps_gruppieren()}
              aktuell={gruppe()}
              onWahl={setGruppe}
              wahl={[
                { wert: "none" as const, name: m.apps_gruppe_nicht() },
                ...(nurFuerMich(art())
                  ? []
                  : [{ wert: "kunde" as const, name: m.apps_gruppe_kunde() }]),
                { wert: "server" as const, name: m.apps_gruppe_server() },
              ]}
            />
          </div>
          <div class="w-full sm:w-64">
            <SearchInput
              label={m.inst_suche()}
              placeholder={m.inst_suche_platzhalter()}
              value={frage()}
              onInput={(event) => setFrage(event.currentTarget.value)}
            />
          </div>
        </div>
        <Fehler text={fehler()} />
        <AppsTabelle
          zeilen={treffer()}
          gruppen={gruppen()}
          mitKunde={!nurFuerMich(art())}
          jetzt={bestand().jetzt}
        />
      </Loading>
      <Loading fallback={null}>
        <Dienste mitKunde={!nurFuerMich(art())} />
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/apps/")({ component: Apps });
