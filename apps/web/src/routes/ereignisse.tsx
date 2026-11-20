import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { bestand } from "../daten/quelle.ts";
import type { Ereignis } from "../daten/typen.ts";
import { Karte, KartenInhalt, Seitenkopf } from "../teile/karte.tsx";
import { Ereignisliste } from "../teile/listen.tsx";

/** Health, backups, updates, agents, checks and support accesses over every server */

const Liste = (props: { ereignisse: Ereignis[] }) => (
  <Karte>
    <KartenInhalt class="pt-5">
      <Ereignisliste ereignisse={props.ereignisse} />
    </KartenInhalt>
  </Karte>
);

const Ereignisse = () => {
  const alle = bestand().ereignisse;
  const nach = (schwere: Ereignis["schwere"]) => alle.filter((e) => e.schwere === schwere);
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_ereignisse()} text={m.ereig_text()} />
      <Tabs
        label={m.ereig_filter()}
        tabs={[
          {
            id: "alle",
            label: m.mit_anzahl({ name: m.filter_alle(), n: alle.length }),
            content: () => <Liste ereignisse={alle} />,
          },
          {
            id: "krit",
            label: m.mit_anzahl({ name: m.ereig_stoerungen(), n: nach("krit").length }),
            content: () => <Liste ereignisse={nach("krit")} />,
          },
          {
            id: "warn",
            label: m.mit_anzahl({ name: m.ereig_warnungen(), n: nach("warn").length }),
            content: () => <Liste ereignisse={nach("warn")} />,
          },
        ]}
      />
    </div>
  );
};

export const Route = createFileRoute("/ereignisse")({ component: Ereignisse });
