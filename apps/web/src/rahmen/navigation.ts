import { m } from "@steuerzentrale/ui";
import {
  Boxes,
  HardDrive,
  type IconNode,
  LayoutDashboard,
  Package,
  RefreshCw,
  ScrollText,
  Settings,
  Users,
} from "@steuerzentrale/ui/icons";
import { appTitel, suche } from "../daten/ableitungen.ts";
import type { Bestand } from "../daten/typen.ts";

/**
 * The areas of the sidebar: eight in two groups, one home per thing (docs/plan.md, "Navigation
 * (Oberfläche 2026-11)"; DESIGN.md, "Bausteine"). Installations are called Apps, the manifests'
 * catalog Katalog. Pages without an entry of their own belong to an area: support accesses and
 * usage to Kunden, the backups to Apps.
 */

export type Pfad =
  | "/"
  | "/apps"
  | "/server"
  | "/kunden"
  | "/updates"
  | "/katalog"
  | "/protokoll"
  | "/einstellungen";

/** What a counter counts: what needs attention on the overview, the apps with a newer version */
export type Zaehler = "aufmerksamkeit" | "updates";

export type Bereich = { pfad: Pfad; name: () => string; icon: IconNode; zaehler?: Zaehler };

export type Gruppe = { name: () => string; bereiche: Bereich[] };

export const GRUPPEN: Gruppe[] = [
  {
    name: () => m.nav_gruppe_betrieb(),
    bereiche: [
      {
        pfad: "/",
        name: () => m.nav_uebersicht(),
        icon: LayoutDashboard,
        zaehler: "aufmerksamkeit",
      },
      { pfad: "/apps", name: () => m.nav_apps(), icon: Boxes },
      { pfad: "/server", name: () => m.nav_server(), icon: HardDrive },
      { pfad: "/kunden", name: () => m.nav_kunden(), icon: Users },
      { pfad: "/updates", name: () => m.nav_updates(), icon: RefreshCw, zaehler: "updates" },
    ],
  },
  {
    name: () => m.nav_gruppe_verwaltung(),
    bereiche: [
      { pfad: "/katalog", name: () => m.nav_katalog(), icon: Package },
      { pfad: "/protokoll", name: () => m.nav_protokoll(), icon: ScrollText },
      { pfad: "/einstellungen", name: () => m.nav_einstellungen(), icon: Settings },
    ],
  },
];

/** Pages reached from an area, not from the menu: their name and the area they belong to */
const UNTERSEITEN: Record<string, { name: () => string; heimat: Pfad }> = {
  "/support": { name: () => m.nav_support(), heimat: "/kunden" },
  "/backups": { name: () => m.nav_backups(), heimat: "/apps" },
};

/** What "Nur für mich" hides (Z-805): customers, and with them support accesses */
export const NUR_FUER_KUNDEN: readonly Pfad[] = ["/kunden"];

/** The groups of the sidebar for the Betriebsart; a group left empty goes too */
export const sichtbareGruppen = (gruppen: Gruppe[], nurFuerMich: boolean): Gruppe[] =>
  nurFuerMich
    ? gruppen
        .map((g) => ({
          ...g,
          bereiche: g.bereiche.filter((b) => !NUR_FUER_KUNDEN.includes(b.pfad)),
        }))
        .filter((g) => g.bereiche.length > 0)
    : gruppen;

const BEREICHE = GRUPPEN.flatMap((g) => g.bereiche);

const bereichVon = (pfad: string): Bereich | undefined => BEREICHE.find((b) => b.pfad === pfad);

/** The area a path belongs to, marked in the sidebar: also on a detail page and a page below it */
export const heimat = (pathname: string): Pfad => {
  const erster = `/${pathname.split("/")[1] ?? ""}`;
  return UNTERSEITEN[erster]?.heimat ?? bereichVon(erster)?.pfad ?? "/";
};

export type Stufe = { name: string; pfad?: Pfad };

/** The name of a detail page's object, from the data; undefined for an unknown ID */
const objektName = (b: Bestand, bereich: Pfad, id: string): string | undefined => {
  if (bereich === "/server") return suche(b.server, id)?.name;
  if (bereich === "/kunden") return suche(b.kunden, id)?.name;
  // an app only imported has no description: its id names it
  if (bereich === "/katalog") return suche(b.apps, id)?.name ?? id;
  if (bereich === "/apps") {
    const i = suche(b.installationen, id);
    return i && appTitel(b, i);
  }
  return undefined;
};

/**
 * The path in the header: the area, and on a detail page or a page below the area the object or
 * page below it ("Server › Gemeinsamer Server 1", "Kunden › Support-Zugänge"); only the last step is
 * not a link
 */
export const pfadStufen = (b: Bestand, pathname: string): Stufe[] => {
  const [, erster = "", id] = pathname.split("/");
  const bereich = bereichVon(heimat(pathname));
  if (!bereich) return [];
  const objekt = id ? objektName(b, bereich.pfad, decodeURIComponent(id)) : undefined;
  const name = UNTERSEITEN[`/${erster}`]?.name() ?? objekt;
  if (!name) return [{ name: bereich.name() }];
  return [{ name: bereich.name(), pfad: bereich.pfad }, { name }];
};
