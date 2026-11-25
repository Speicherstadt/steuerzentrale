import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Aenderungen } from "../seiten/protokoll-aenderungen.tsx";
import { Auftraege } from "../seiten/protokoll-auftraege.tsx";
import { Ereignisse } from "../seiten/protokoll-ereignisse.tsx";
import { Seitenkopf } from "../teile/karte.tsx";

/**
 * What happened, what the Zentrale asked the agents to do and who changed what, in one place
 * (docs/plan.md, "Navigation (Oberfläche 2026-11)"): the events (Z-406), the jobs (Z-305) and the
 * audit log (Z-102) as tabs, the tab in the URL; both roles read all three (Z-1204).
 */

const REITER = ["ereignisse", "auftraege", "aenderungen"] as const;
type Reiter = (typeof REITER)[number];

const REITER_INHALT = [
  { id: "ereignisse", label: () => m.nav_ereignisse(), content: () => <Ereignisse /> },
  { id: "auftraege", label: () => m.nav_auftraege(), content: () => <Auftraege /> },
  { id: "aenderungen", label: () => m.protokoll_aenderungen(), content: () => <Aenderungen /> },
];

const reiter = () => REITER_INHALT.map((r) => ({ ...r, label: r.label() }));

const Protokoll = () => {
  const suche = Route.useSearch();
  const navigate = useNavigate();
  const waehlen = (tab: string) => {
    const neu = REITER.find((r) => r === tab);
    if (neu) void navigate({ to: "/protokoll", search: { tab: neu }, replace: true });
  };
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_protokoll()} text={m.protokoll_text()} />
      <Tabs
        label={m.protokoll_reiter()}
        initial={suche().tab ?? "ereignisse"}
        onChange={waehlen}
        tabs={reiter()}
      />
    </div>
  );
};

export const Route = createFileRoute("/protokoll")({
  validateSearch: (suche: Record<string, unknown>): { tab?: Reiter } => {
    const tab = REITER.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: Protokoll,
});
