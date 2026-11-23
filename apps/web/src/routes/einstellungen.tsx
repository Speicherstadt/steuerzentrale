import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { bestand } from "../daten/quelle.ts";
import { AppWerte } from "../seiten/einstellungen-apps.tsx";
import { Dns } from "../seiten/einstellungen-dns.tsx";
import {
  Backup,
  Benachrichtigungen,
  Darstellung,
  Konten,
  Zentrale,
} from "../seiten/einstellungen-teile.tsx";
import { Seitenkopf } from "../teile/karte.tsx";

/**
 * The operator's values per app (Z-404: a form from each app's manifest), backup target, DNS,
 * notifications, accounts, the Zentrale, the look
 */

const REITER = ["werte", "backup", "dns", "melden", "konten", "zentrale", "darstellung"] as const;
type Reiter = (typeof REITER)[number];

const Einstellungen = () => {
  const b = bestand();
  const suche = Route.useSearch();
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_einstellungen()} text={m.einst_text()} />
      <Tabs
        label={m.einst_reiter()}
        initial={suche().tab ?? "werte"}
        tabs={[
          {
            id: "werte",
            label: m.einst_werte(),
            content: () => (
              <div class="grid gap-4">
                <AppWerte />
              </div>
            ),
          },
          { id: "backup", label: m.einst_backup(), content: () => <Backup b={b} /> },
          { id: "dns", label: m.einst_dns(), content: () => <Dns /> },
          { id: "melden", label: m.einst_melden(), content: () => <Benachrichtigungen b={b} /> },
          { id: "konten", label: m.einst_konten(), content: () => <Konten /> },
          { id: "zentrale", label: m.app_name(), content: () => <Zentrale b={b} /> },
          { id: "darstellung", label: m.einst_darstellung(), content: () => <Darstellung /> },
        ]}
      />
    </div>
  );
};

export const Route = createFileRoute("/einstellungen")({
  validateSearch: (suche: Record<string, unknown>): { tab?: Reiter } => {
    const tab = REITER.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: Einstellungen,
});
