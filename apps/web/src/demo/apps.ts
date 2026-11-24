import type { Manifest as Echt } from "@steuerzentrale/manifest";
import type { Manifest, OptionaleAktion, Variable } from "../daten/typen.ts";
import { neuestes } from "./manifeste.ts";

/*
 * The apps of the demo: everything technical comes from the newest released manifest in
 * manifeste/ (src/demo/manifeste.ts), so the demo shows each app as a Zentrale with these manifests
 * would. Only what a manifest does not say stands here: name, icon, a short description, and what
 * runs at the customer. An app without a released manifest (Soll, Fixpunkt) is not in the demo.
 */

type Darstellung = Pick<Manifest, "name" | "icon" | "beschreibung" | "stand" | "beimKunden"> & {
  /** A newer tag the registry has, without an imported manifest (Z-501), as on 2026-11-24 */
  ohneManifest?: string;
};

const DARSTELLUNG: Record<string, Darstellung> = {
  haben: {
    name: "Haben",
    icon: "book-open-check",
    beschreibung: "Buchhaltung für Selbständige",
    stand: "stabil",
    beimKunden: "",
    ohneManifest: "0.13.0",
  },
  belegt: {
    name: "Belegt",
    icon: "archive",
    beschreibung: "Belege, GoBD-Archiv",
    stand: "stabil",
    beimKunden: "",
  },
  kontext: {
    name: "Kontext",
    icon: "messages-square",
    beschreibung: "Mail, Kalender, Kontakte, Anrufe",
    stand: "stabil",
    beimKunden: "Kontext-Box (Telefon)",
    ohneManifest: "0.1.40",
  },
  schreibzeug: {
    name: "Schreibzeug",
    icon: "pen-line",
    beschreibung: "Dokumente, gemeinsam schreiben",
    stand: "stabil",
    beimKunden: "Desktop-App",
  },
  stellwerk: {
    name: "Stellwerk",
    icon: "folder-sync",
    beschreibung: "Dateien synchronisieren",
    stand: "stabil",
    beimKunden: "Agenten auf Rechnern",
  },
  kennwort: {
    name: "Kennwort",
    icon: "key-round",
    beschreibung: "Passwörter im Team",
    stand: "stabil",
    beimKunden: "Browser-Erweiterung, Desktop-App",
  },
};

const port = (p: Echt["netz"]["ports"][number]) =>
  `${p.port}${p.bis ? `-${p.bis}` : ""}${p.proto === "udp" ? "/udp" : ""}`;

const health = (h: Echt["health"]): Manifest["health"] => {
  if (h.art === "http") return { pfad: h.pfad };
  if (h.art === "keine") return { keine: h.hinweis };
  return { keine: h.art === "tcp" ? `TCP-Port ${h.port}` : `Befehl ${h.befehl}` };
};

const backup = (teile: Echt["backup"]): string =>
  teile
    .map((t) =>
      t.art === "pg_dump" ? "pg_dump" : t.art === "volume" ? "Volume" : `Befehl (${t.befehl})`,
    )
    .filter((x, n, alle) => alle.indexOf(x) === n)
    .join(" + ") || "keins";

/** "07-12" → days 7 to 12 of every month */
const sperrzeit = (s: Echt["sperrzeiten"][number]) => {
  const [von, bis] = s.monatlich.split("-").map(Number);
  return { von: von ?? 1, bis: bis ?? 1, grund: s.grund };
};

const nichtUnterstuetzt = (m: Echt): Manifest["nichtUnterstuetzt"] =>
  (["nur_lesen", "export"] as const satisfies OptionaleAktion[]).flatMap((aktion) => {
    const a = m.aktionen[aktion];
    if (typeof a === "object" && "befehl" in a) return [];
    if (typeof a === "object")
      return [{ aktion, issue: { name: a.nicht_unterstuetzt, url: `${m.quelle}/issues` } }];
    return [{ aktion }];
  });

/** How the Zentrale fills a value it sets itself, in a few words */
const woher = (e: Echt["env"][number]): string => {
  if (e.aus === "adresse") return "aus der Adresse";
  if (e.aus === "oidc-anbieter") return "vom Anmeldedienst des Kunden";
  if (e.erzeugen) return "zufällig";
  if (e.vorlage) return "aus anderen Werten";
  return "";
};

const variable = (e: Echt["env"][number]): Variable => ({
  name: e.name,
  ebene: e.ebene,
  ...(e.titel === undefined ? {} : { titel: e.titel }),
  hinweis: e.beschreibung ?? woher(e),
  ...(e.pflicht ? { pflicht: true } : {}),
  ...(e.typ === "geheim" ? { geheim: true } : {}),
  ...(e.vorgabe === undefined ? {} : { vorgabe: String(e.vorgabe) }),
});

/** An app of the demo from its manifest and how it is shown */
export const ausManifest = (m: Echt, d: Darstellung): Manifest => ({
  id: m.id,
  ...d,
  version: m.version,
  container: m.container.map((c) => c.name),
  architektur: m.architektur,
  ramMb: m.ressourcen.ram_mb,
  platteGb: m.ressourcen.platte_gb,
  ports: m.netz.ports.map(port),
  ipv4: m.netz.oeffentliche_ipv4,
  serverFuerSich: m.netz.server_fuer_sich,
  anmeldung: m.anmeldung,
  braucht: m.braucht,
  optionen: m.optionen.map((o) => ({ id: o.id, name: o.name })),
  health: health(m.health),
  backup: backup(m.backup),
  sperrzeiten: m.sperrzeiten.map(sperrzeit),
  quelle: m.quelle,
  nichtUnterstuetzt: nichtUnterstuetzt(m),
  variablen: m.env.map(variable),
});

export const apps: Manifest[] = Object.entries(DARSTELLUNG).flatMap(([id, d]) => {
  const e = neuestes(id);
  return e ? [ausManifest(e.manifest, d)] : [];
});

/** The version an app's newest released manifest names, for the fixtures */
export const versionVon = (app: string): string => {
  const v = apps.find((a) => a.id === app)?.version;
  if (!v) throw new Error(`no released manifest for ${app} in manifeste/`);
  return v;
};
