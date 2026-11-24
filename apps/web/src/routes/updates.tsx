import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { sperrzeitAktiv, sperrzeitenDer } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import { UpdateTabelle } from "../seiten/update-tabelle.tsx";
import { Seitenkopf } from "../teile/karte.tsx";

/**
 * New versions per app in one table (BAULISTE.md, Z-501 to Z-504): the versions installed and
 * offered come from the Zentrale; waves are the demo's until Z-503. Below it the freeze windows,
 * how an update runs, and the agents.
 */

const SCHRITTE = [
  () => m.upd_schritt_backup(),
  () => m.upd_schritt_image(),
  () => m.upd_schritt_nach_update(),
  () => m.upd_schritt_neustart(),
  () => m.upd_schritt_zurueck(),
];

/** The freeze windows of the installed apps, in the warning's colour while one holds today */
const Sperrzeiten = () => {
  const b = bestand();
  const sperren = sperrzeitenDer(
    b,
    b.installationen.map((i) => i.app),
  );
  const aktiv = sperren.some((z) => sperrzeitAktiv(z, b.jetzt));
  return (
    <Show when={sperren.length > 0}>
      <span class={{ "text-warn": aktiv }}>
        {m.upd_sperrzeiten_zeile({
          liste: sperren
            .map((z) => m.upd_sperrzeit({ app: z.appName, von: z.von, bis: z.bis }))
            .join("; "),
          heute: aktiv ? m.upd_sperrzeit_heute_aktiv() : m.upd_sperrzeit_heute_keine(),
        })}
      </span>{" "}
    </Show>
  );
};

/** The line under the table: freeze windows, the steps of an update on demand, the agents */
const Fuss = () => {
  const [offen, setOffen] = createSignal(false);
  const b = bestand();
  const aktuell = b.server.filter((s) => s.agent.version === b.agentVersion).length;
  return (
    <div class="grid gap-1 text-xs text-muted-foreground">
      <p>
        <Sperrzeiten />
        <button
          type="button"
          class="underline underline-offset-4 hover:text-foreground"
          aria-expanded={offen() ? "true" : "false"}
          aria-controls="update-ablauf"
          onClick={() => setOffen((x) => !x)}
        >
          {m.upd_ablauf()}
        </button>
      </p>
      <ol id="update-ablauf" class={["grid list-decimal gap-1 pl-5", { hidden: !offen() }]}>
        <For each={SCHRITTE}>{(schritt) => <li>{schritt()}</li>}</For>
      </ol>
      <Show when={b.server.length > 0}>
        <p>{m.upd_agent_zeile({ version: b.agentVersion, n: aktuell, gesamt: b.server.length })}</p>
      </Show>
    </div>
  );
};

const Updates = () => (
  <div class="grid gap-4">
    <Seitenkopf titel={m.nav_updates()} text={m.upd_text()} />
    <UpdateTabelle />
    <Fuss />
  </div>
);

export const Route = createFileRoute("/updates")({ component: Updates });
