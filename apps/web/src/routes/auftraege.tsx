import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { type AuftragFilter, betriebQuelle } from "../daten/betrieb.ts";
import { AuftragTabelle, OFFEN } from "../teile/auftraege.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Seitenweise } from "../teile/seitenweise.tsx";

/**
 * What the Zentrale asked the agents to do (BAULISTE.md Z-305), newest first, page by page from the
 * Zentrale (Z-406): all, the open ones, the failed ones
 */

const Liste = (props: { filter: AuftragFilter }) => (
  <div class="grid gap-4">
    <Seitenweise
      laden={(weiter) => betriebQuelle().auftraege(props.filter, weiter)}
      ladenText={m.auftraege_laden()}
      zeigen={(eintraege) => (
        <AuftragTabelle name={m.auftraege_tabelle()} auftraege={eintraege()} />
      )}
    />
  </div>
);

const Auftraege = () => (
  <div class="grid gap-6">
    <Seitenkopf titel={m.nav_auftraege()} text={m.auftraege_text()} />
    <Tabs
      label={m.auftraege_filter()}
      tabs={[
        { id: "alle", label: m.filter_alle(), content: () => <Liste filter={{}} /> },
        {
          id: "offen",
          label: m.auftraege_offen(),
          content: () => <Liste filter={{ zustand: OFFEN }} />,
        },
        {
          id: "gescheitert",
          label: m.auftraege_gescheitert(),
          content: () => <Liste filter={{ zustand: ["gescheitert"] }} />,
        },
      ]}
    />
  </div>
);

export const Route = createFileRoute("/auftraege")({ component: Auftraege });
