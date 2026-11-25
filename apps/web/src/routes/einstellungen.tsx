import { m } from "@steuerzentrale/ui";
import { createFileRoute, redirect } from "@tanstack/solid-router";
import {
  ABSCHNITTE,
  type Abschnitt,
  AbschnittInhalt,
  AbschnittListe,
} from "../seiten/einstellungen-abschnitte.tsx";
import { Seitenkopf } from "../teile/karte.tsx";

/**
 * How the Zentrale is set up, one section at a time (seiten/einstellungen-abschnitte.tsx): the
 * operator's values per app (Z-404: a form from each app's manifest),
 * backup target (Z-601), DNS (Z-407), notifications (Z-703), accounts, the Zentrale, the look. The
 * section is in the URL (?tab=), "Werte für Apps" without one.
 */

const Einstellungen = () => {
  const suche = Route.useSearch();
  const gewaehlt = (): Abschnitt => suche().tab ?? "werte";
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_einstellungen()} text={m.einst_text()} />
      <div class="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <AbschnittListe />
        <AbschnittInhalt gewaehlt={gewaehlt()} />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/einstellungen")({
  // one address per section, so the list marks it: "Werte für Apps" is the page without one
  beforeLoad: ({ location }) => {
    if ((location.search as { tab?: unknown }).tab === "werte")
      throw redirect({ to: "/einstellungen", search: {}, replace: true });
  },
  validateSearch: (suche: Record<string, unknown>): { tab?: Abschnitt } => {
    const tab = ABSCHNITTE.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: Einstellungen,
});
