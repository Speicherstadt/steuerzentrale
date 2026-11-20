import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { For } from "solid-js";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { rolleName } from "../rahmen/texte.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZielVerweis } from "../teile/verweise.tsx";

/** Every write with actor, time, target and reason; append-only (BAULISTE.md, Z-102) */
const Audit = () => {
  const b = bestand();
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_audit()} text={m.audit_text()} />
      <Tabelle
        name={m.audit_tabelle()}
        minBreite={880}
        leer={m.audit_leer()}
        anzahl={b.audit.length}
        spalten={[
          { name: m.audit_spalte_zeit() },
          { name: m.sup_spalte_wer() },
          { name: m.audit_spalte_aktion() },
          { name: m.auftraege_spalte_ziel() },
          { name: m.sup_spalte_grund() },
        ]}
      >
        <For each={b.audit}>
          {(e) => (
            <Reihe>
              <td class="text-xs whitespace-nowrap tabular-nums">{zeitpunkt(e.zeit, b.jetzt)}</td>
              <td class="text-xs">
                {e.akteur
                  ? m.audit_akteur({ name: e.akteur.name, rolle: rolleName(e.akteur.rolle) })
                  : m.app_name()}
              </td>
              <td class="font-medium">{e.aktion}</td>
              <td class="text-xs">
                <ZielVerweis ziel={e.ziel} />
              </td>
              <td class="text-xs text-muted-foreground">{e.grund}</td>
            </Reihe>
          )}
        </For>
      </Tabelle>
    </div>
  );
};

export const Route = createFileRoute("/audit")({ component: Audit });
