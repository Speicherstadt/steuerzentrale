import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { betriebQuelle, type Ereignisschwere } from "../daten/betrieb.ts";
import { Karte, KartenInhalt, Seitenkopf } from "../teile/karte.tsx";
import { Ereignisliste } from "../teile/listen.tsx";
import { Seitenweise } from "../teile/seitenweise.tsx";

/**
 * The operator's events over every server, newest first, page by page from the Zentrale
 * (BAULISTE.md Z-406); a tab per severity asks the Zentrale for that one only
 */

const Liste = (props: { schwere?: Ereignisschwere }) => (
  <Karte>
    <KartenInhalt class="grid gap-4 pt-5">
      <Seitenweise
        laden={(weiter) =>
          betriebQuelle().ereignisse(props.schwere ? { schwere: [props.schwere] } : {}, weiter)
        }
        ladenText={m.ereig_laden()}
        zeigen={(eintraege) => <Ereignisliste ereignisse={eintraege()} />}
      />
    </KartenInhalt>
  </Karte>
);

const Ereignisse = () => (
  <div class="grid gap-6">
    <Seitenkopf titel={m.nav_ereignisse()} text={m.ereig_text()} />
    <Tabs
      label={m.ereig_filter()}
      tabs={[
        { id: "alle", label: m.filter_alle(), content: () => <Liste /> },
        { id: "krit", label: m.ereig_stoerungen(), content: () => <Liste schwere="fehler" /> },
        { id: "warn", label: m.ereig_warnungen(), content: () => <Liste schwere="warn" /> },
      ]}
    />
  </div>
);

export const Route = createFileRoute("/ereignisse")({ component: Ereignisse });
