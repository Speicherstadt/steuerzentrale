/*
 * What the pages read: the operator's servers, installations, customers and what happens to them
 * (docs/plan.md, "Datenmodell"), and the manifests of the apps, as the demo fixtures in src/demo/
 * hold them. Signed in, the pages read the API's own shapes from the sources in src/daten/ (Z-406);
 * these types stay for `dev:demo` and what has no API yet. Instants are UTC milliseconds (CLAUDE.md,
 * "Times"); local times of day (maintenance windows) are written "HH:MM" in Europe/Berlin.
 */

/** A monthly freeze window of an app: no update, no reboot from day `von` to day `bis` */
export type Sperrzeit = { von: number; bis: number; grund: string };

/** What a variable of the manifest is set by: the operator, each installation, or the Zentrale */
export type Ebene = "betreiber" | "installation" | "auto";

export type Variable = {
  name: string;
  ebene: Ebene;
  hinweis: string;
  pflicht?: boolean;
  geheim?: boolean;
  vorgabe?: string;
};

/** Actions an app may lack; the UI offers only what the manifest has (DESIGN.md) */
export type OptionaleAktion = "nur_lesen" | "export";

export type Manifest = {
  id: string;
  name: string;
  /** A lucide icon name the manifest suggests; unknown names fall back to a package */
  icon: string;
  beschreibung: string;
  stand: "stabil" | "vorschau" | "entwicklung";
  /** The newest version with a signed manifest; null while the app has no image */
  version: string | null;
  /** A newer tag the registry shows whose manifest is not imported yet (Z-501) */
  ohneManifest?: string;
  container: string[];
  architektur: string[];
  ramMb: number;
  platteGb: number;
  ports: string[];
  ipv4: boolean;
  serverFuerSich: boolean;
  anmeldung: "oidc" | "eigen" | "anbieter";
  braucht: string[];
  optionen: { id: string; name: string }[];
  /** The health path, or null with the reason the app has none */
  health: { pfad: string } | { keine: string };
  backup: string;
  sperrzeiten: Sperrzeit[];
  /** Parts at the customer the Steuerzentrale does not manage, as the manifest names them */
  beimKunden: string;
  quelle: string;
  /** Optional actions the app does not support yet, with the issue that tracks them */
  nichtUnterstuetzt: { aktion: OptionaleAktion; issue?: { name: string; url: string } }[];
  variablen: Variable[];
};

export type Art = "gemeinsam" | "eigen" | "kunde";
export type AgentZustand = "verbunden" | "still" | "getrennt";

export type Server = {
  id: string;
  name: string;
  host: string;
  art: Art;
  /** The customer a server of its own or at the customer belongs to */
  kunde?: string;
  anbieter: string;
  arch: string;
  ramGb: number;
  os: string;
  kernel: { laeuft: string; installiert: string };
  podman: string;
  ipv4: string;
  ipv6: string;
  erreichbar: "pforte" | "portweiterleitung";
  wartung: { von: string; bis: string };
  agent: { version: string; zustand: AgentZustand; letzteMeldung: number };
  /** Load in percent */
  cpu: number;
  ram: number;
  platte: number;
  sicherheitsupdates: number;
  /** Packages unattended-upgrades installed that wait for a reboot, with the reboot job */
  neustart?: { pakete: { name: string; version: string; wartet: boolean }[]; auftrag: string };
  /** Days until the next certificate on this server expires */
  zertifikatTage: number;
  uhrAbweichungMs: number;
  laufzeitTage: number;
};

export type Health = "gruen" | "gelb" | "rot" | "unbekannt";
export type PruefRestore = "ok" | "offen" | "gescheitert";

export type Snapshot = { zeitpunkt: number; gb: number | null; pruefRestore?: PruefRestore };

export type Installation = {
  id: string;
  app: string;
  kunde: string;
  server: string;
  version: string;
  adresse: string;
  optionen: string[];
  health: Health;
  /** Why the state is not green, as the check reported it */
  grund?: string;
  /** The unit that failed, for a red installation */
  roteUnit?: string;
  /** An update to the newest version is running right now */
  updateLaeuft?: boolean;
  backup: { zeitpunkt: number; ok: boolean };
  pruefRestore: PruefRestore;
  datenGb: number;
  laeuftSeit: number;
  /** Availability per month ("2026-11") in percent */
  verfuegbarkeit: Record<string, number>;
  werte: Record<string, string>;
  snapshots: Snapshot[];
};

/** The service levels (docs/plan.md, "SLA"); stage 1 offers only Basis, Plus and Ruhe come with Z-505 */
export type Sla = "basis" | "plus" | "ruhe";

/**
 * A customer as GET /api/v1/kunden answers (Z-801): one contact person and one contract; `ende` is
 * the day the contract ends once the customer gave notice, the start of that day in Berlin
 */
export type Kunde = {
  id: string;
  name: string;
  kontakt: { name: string; email: string; telefon: string | null };
  notiz: string | null;
  angelegtAm: number;
  vertrag: { sla: Sla; beginn: number; ende: number | null };
  /** Our own customer, whose installations go first in the wave "intern" (Z-502; demo only) */
  intern?: boolean;
};

/** What an event, a job or an audit entry is about */
export type Ziel =
  | { art: "installation"; id: string }
  | { art: "server"; id: string }
  | { art: "app"; id: string; version?: string }
  | { art: "einstellungen" };

export type Schwere = "krit" | "warn" | "info";

export type Ereignis = { zeit: number; schwere: Schwere; ziel: Ziel; text: string };

export type AuftragZustand = "wartet" | "laeuft" | "fertig" | "gescheitert" | "geplant";

/** A job names an action of the manifest, never a command (CLAUDE.md, "Project specifics") */
export type Auftrag = {
  id: string;
  aktion: "update" | "neustart" | "neustart_server" | "pruef_restore" | "backup";
  version?: string;
  ziel: Ziel;
  zustand: AuftragZustand;
  start: number;
  schritt: string;
  fortschritt?: number;
};

export type Rolle = "inhaber" | "technik" | "support";

export type Zugang = {
  id: string;
  installation: string;
  wer: string;
  rolle: Rolle;
  grund: string;
  start: number;
  minuten: number;
  /** Minutes left of a running access; absent once it ended */
  restMinuten?: number;
  ergebnis?: string;
};

export type AuditEintrag = {
  zeit: number;
  /** null: the Zentrale itself */
  akteur: { name: string; rolle: Rolle } | null;
  aktion: string;
  ziel: Ziel;
  grund: string;
};

export type Konto = {
  name: string;
  rolle: Rolle;
  faktor: "passkey" | "totp";
  zuletzt: number;
};

/** Running and planned update waves of one app version (Z-502: "intern", then "alle") */
export type Updateplan = { app: string; version: string; vorher: string; seit: number };

export type Betreiber = {
  name: string;
  domain: string;
  /** Operator values per variable name; secrets only as "set" */
  werte: Record<string, string>;
  geheimGesetzt: string[];
  s3: string;
  benachrichtigung: { smtp: string; an: string; webhook: string; ruhezeit: string };
};

export type Bestand = {
  jetzt: number;
  betreiber: Betreiber;
  konto: Konto;
  apps: Manifest[];
  server: Server[];
  kunden: Kunde[];
  installationen: Installation[];
  ereignisse: Ereignis[];
  auftraege: Auftrag[];
  zugaenge: Zugang[];
  audit: AuditEintrag[];
  konten: Konto[];
  plaene: Updateplan[];
  agentVersion: string;
};
