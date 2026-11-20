import { m } from "@steuerzentrale/ui";
import {
  Archive,
  Bell,
  Boxes,
  ChartNoAxesColumn,
  HardDrive,
  type IconNode,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Package,
  RefreshCw,
  ScrollText,
  Settings,
  Users,
} from "@steuerzentrale/ui/icons";
import { suche, titel } from "../daten/ableitungen.ts";
import type { Bestand } from "../daten/typen.ts";
import type { zaehler } from "../daten/zustand.ts";

/** The areas of the sidebar in their groups (DESIGN.md, "Bausteine"; design/mockup/) */

export type Pfad =
  | "/"
  | "/server"
  | "/installationen"
  | "/updates"
  | "/backups"
  | "/auftraege"
  | "/kunden"
  | "/support"
  | "/leistungen"
  | "/apps"
  | "/ereignisse"
  | "/audit"
  | "/einstellungen";

export type Bereich = {
  pfad: Pfad;
  name: () => string;
  icon: IconNode;
  zaehler?: keyof ReturnType<typeof zaehler>;
};

export type Gruppe = { name: () => string; bereiche: Bereich[] };

export const GRUPPEN: Gruppe[] = [
  {
    name: () => m.nav_gruppe_betrieb(),
    bereiche: [
      { pfad: "/", name: () => m.nav_uebersicht(), icon: LayoutDashboard },
      { pfad: "/server", name: () => m.nav_server(), icon: HardDrive },
      { pfad: "/installationen", name: () => m.nav_installationen(), icon: Boxes },
      { pfad: "/updates", name: () => m.nav_updates(), icon: RefreshCw, zaehler: "updates" },
      { pfad: "/backups", name: () => m.nav_backups(), icon: Archive },
      { pfad: "/auftraege", name: () => m.nav_auftraege(), icon: ListChecks, zaehler: "auftraege" },
    ],
  },
  {
    name: () => m.nav_gruppe_kunden(),
    bereiche: [
      { pfad: "/kunden", name: () => m.nav_kunden(), icon: Users },
      { pfad: "/support", name: () => m.nav_support(), icon: LifeBuoy, zaehler: "support" },
      { pfad: "/leistungen", name: () => m.nav_leistungen(), icon: ChartNoAxesColumn },
    ],
  },
  {
    name: () => m.nav_gruppe_system(),
    bereiche: [
      { pfad: "/apps", name: () => m.nav_apps(), icon: Package },
      { pfad: "/ereignisse", name: () => m.nav_ereignisse(), icon: Bell, zaehler: "ereignisse" },
      { pfad: "/audit", name: () => m.nav_audit(), icon: ScrollText },
      { pfad: "/einstellungen", name: () => m.nav_einstellungen(), icon: Settings },
    ],
  },
];

const BEREICHE = GRUPPEN.flatMap((g) => g.bereiche);

export type Stufe = { name: string; pfad?: Pfad };

/** The name of a detail page's object, from the data; undefined for an unknown ID */
const objektName = (b: Bestand, bereich: string, id: string): string | undefined => {
  if (bereich === "/server") return suche(b.server, id)?.name;
  if (bereich === "/kunden") return suche(b.kunden, id)?.name;
  if (bereich === "/installationen") {
    const i = suche(b.installationen, id);
    return i && titel(b, i);
  }
  return undefined;
};

/**
 * The path in the header: the area, and on a detail page the object below it ("Server ›
 * Gemeinsamer Server 1"); only the last step is not a link
 */
export const pfadStufen = (b: Bestand, pathname: string): Stufe[] => {
  const [, erster = "", id] = pathname.split("/");
  const bereich = BEREICHE.find((x) => x.pfad === `/${erster}`) ?? BEREICHE[0];
  if (!bereich) return [];
  const name = id ? objektName(b, bereich.pfad, decodeURIComponent(id)) : undefined;
  if (!name) return [{ name: bereich.name() }];
  return [{ name: bereich.name(), pfad: bereich.pfad }, { name }];
};
