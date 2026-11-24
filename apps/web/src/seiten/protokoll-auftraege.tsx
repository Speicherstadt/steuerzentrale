import { m, Tabs } from "@steuerzentrale/ui";
import { type AuftragFilter, betriebQuelle } from "../daten/betrieb.ts";
import { AuftragTabelle, OFFEN } from "../teile/auftraege.tsx";
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

/** The tab "Aufträge" of the Protokoll (routes/protokoll.tsx) */
export const Auftraege = () => (
  <div class="grid gap-4">
    <p class="max-w-3xl text-sm text-muted-foreground">{m.auftraege_text()}</p>
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
