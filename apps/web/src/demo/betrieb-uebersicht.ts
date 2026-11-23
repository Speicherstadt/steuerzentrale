import type {
  AuftragDerZentrale,
  Dringlichkeit,
  EreignisDerZentrale,
  UebersichtEintrag,
  Verweis,
} from "../daten/betrieb.ts";
import type { Installation } from "../daten/typen.ts";
import { auffaellig, pruefungenDerDemo } from "../daten/zustand.ts";
import { pruefRestoreVon } from "./backups.ts";
import { demo } from "./index.ts";
import { installationen } from "./installationen.ts";
import { kunden } from "./kunden.ts";
import { server } from "./server.ts";
import { JETZT } from "./zeit.ts";

/*
 * The demo's overview as GET /api/v1/uebersicht answers it (BAULISTE.md Z-406): a red installation
 * as an open fault, yellow and unknown ones, agents not connected, checks of a server red or yellow
 * (Z-702, as src/demo/server-quelle.ts answers them), test restores failed or due
 * (Z-602, from the demo's `pruefRestore` as src/demo/backups.ts answers them), failed jobs, warnings
 * and errors of the last 24 h; ordered as the Zentrale orders (apps/zentrale,
 * modules/betrieb/ordnen.ts).
 */

const TAG = 86_400_000;
const RANG: Record<Dringlichkeit, number> = { stoerung: 0, warnung: 1, hinweis: 2 };
const FOLGE: Record<UebersichtEintrag["art"], number> = {
  stoerung: 0,
  installation: 1,
  agent: 2,
  pruefung: 3,
  pruef_restore: 4,
  auftrag: 5,
  ereignis: 6,
};

const kunde = (id: string) => kunden.find((k) => k.id === id);

const verweis = (i: Installation) => ({
  installationId: i.id,
  app: i.app,
  host: i.adresse,
  kunde: kunde(i.kunde)?.name ?? i.kunde,
});

const grund = (i: Installation) => ({ code: "health" as const, werte: { text: i.grund ?? "" } });

const zuInstallation = (i: Installation): UebersichtEintrag[] => {
  if (i.health === "gruen" || kunde(i.kunde)?.vertrag.ende) return [];
  const ziel: Verweis = { art: "installation", id: i.id };
  if (i.health === "rot")
    return [
      {
        art: "stoerung",
        schwere: "stoerung",
        verweis: ziel,
        installation: verweis(i),
        grund: grund(i),
        seit: null,
      },
    ];
  return [
    {
      art: "installation",
      schwere: i.health === "gelb" ? "warnung" : "hinweis",
      verweis: ziel,
      installation: verweis(i),
      zustand: i.health,
      grund: grund(i),
      seit: null,
    },
  ];
};

const agenten = (): UebersichtEintrag[] =>
  server.flatMap((s): UebersichtEintrag[] =>
    s.agent.zustand === "verbunden"
      ? []
      : [
          {
            art: "agent",
            schwere: s.agent.zustand === "getrennt" ? "stoerung" : "warnung",
            verweis: { art: "server", id: s.id },
            server: { serverId: s.id, name: s.name },
            zustand: s.agent.zustand,
            seit: s.agent.letzteMeldung,
          },
        ],
  );

/** The checks of each server that are red (a fault) or yellow (a warning) */
const pruefungen = (): UebersichtEintrag[] =>
  server.flatMap((sv) =>
    pruefungenDerDemo(demo, sv)
      .filter(auffaellig)
      .map(
        (pruefung): UebersichtEintrag => ({
          art: "pruefung",
          schwere: pruefung.ergebnis === "rot" ? "stoerung" : "warnung",
          verweis: { art: "server", id: sv.id },
          server: { serverId: sv.id, name: sv.name },
          pruefung,
          seit: null,
        }),
      ),
  );

/** A failed test restore as a warning, one 9 days old (`offen`) as a note */
const pruefRestore = (i: Installation): UebersichtEintrag[] => {
  if (i.pruefRestore === "ok" || kunde(i.kunde)?.vertrag.ende) return [];
  const gescheitert = i.pruefRestore === "gescheitert";
  const letzter = pruefRestoreVon(i).letzter;
  return [
    {
      art: "pruef_restore",
      schwere: gescheitert ? "warnung" : "hinweis",
      verweis: { art: "installation", id: i.id },
      installation: verweis(i),
      gescheitert,
      grund: letzter?.grund ?? null,
      seit: letzter?.zeitpunkt ?? null,
    },
  ];
};

const ereignisVerweis = (ziel: string): Verweis => {
  const [art, id = ""] = ziel.split(":");
  return art === "installation" || art === "server" ? { art, id } : { art: "ereignisse" };
};

export const demoUebersicht = (
  auftraege: AuftragDerZentrale[],
  ereignisse: EreignisDerZentrale[],
): UebersichtEintrag[] => {
  const vorne = [
    ...installationen.flatMap(zuInstallation),
    ...agenten(),
    ...pruefungen(),
    ...installationen.flatMap(pruefRestore),
  ];
  const genannt = new Set(vorne.map((e) => JSON.stringify(e.verweis)));
  const gescheitert: UebersichtEintrag[] = auftraege
    .filter((a) => a.zustand === "gescheitert" && a.geaendertAm >= JETZT - 7 * TAG)
    .filter((a) => a.aktion !== "installation_pruef_restore")
    .map((a) => ({
      art: "auftrag",
      schwere: "warnung",
      verweis: { art: "auftrag", id: a.auftragId },
      auftragId: a.auftragId,
      aktion: a.aktion,
      fehler: a.fehler,
      server: a.server,
      installation: a.installation && { ...a.installation, app: a.app },
      seit: a.geaendertAm,
    }));
  const meldungen: UebersichtEintrag[] = ereignisse
    .filter((e) => e.schwere !== "info" && e.zeitpunkt >= JETZT - TAG)
    .map(
      (e): UebersichtEintrag => ({
        art: "ereignis",
        schwere: e.schwere === "fehler" ? "stoerung" : "warnung",
        verweis: ereignisVerweis(e.ziel),
        ereignisId: e.ereignisId,
        ereignisArt: e.art,
        ziel: e.ziel,
        text: e.text,
        seit: e.zeitpunkt,
      }),
    )
    .filter((e) => !genannt.has(JSON.stringify(e.verweis)));
  return [...vorne, ...gescheitert, ...meldungen].sort(
    (a, b) =>
      RANG[a.schwere] - RANG[b.schwere] ||
      FOLGE[a.art] - FOLGE[b.art] ||
      (b.seit ?? -1) - (a.seit ?? -1),
  );
};
