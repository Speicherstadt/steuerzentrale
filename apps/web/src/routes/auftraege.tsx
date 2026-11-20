import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { bestand } from "../daten/quelle.ts";
import { AuftragTabelle } from "../teile/auftraege.tsx";
import { Seitenkopf } from "../teile/karte.tsx";

/** What the Zentrale asked the agents to do (BAULISTE.md, Z-305) */
const Auftraege = () => (
  <div class="grid gap-6">
    <Seitenkopf titel={m.nav_auftraege()} text={m.auftraege_text()} />
    <AuftragTabelle name={m.auftraege_tabelle()} auftraege={bestand().auftraege} />
  </div>
);

export const Route = createFileRoute("/auftraege")({ component: Auftraege });
