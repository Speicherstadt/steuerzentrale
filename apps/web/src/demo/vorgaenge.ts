import type { AuditEintrag, Auftrag, Ereignis, Konto } from "../daten/typen.ts";
import { berlin, gestern, heute } from "./zeit.ts";

/** What happened today and before: events, jobs, audit log (design/mockup/) */

const inst = (id: string) => ({ art: "installation" as const, id });
const srv = (id: string) => ({ art: "server" as const, id });

export const ereignisse: Ereignis[] = [
  {
    zeit: heute("10:36"),
    schwere: "krit",
    ziel: inst("berger-schreibzeug"),
    text: "Unit app beendet, zwei Neustarts gescheitert",
  },
  {
    zeit: heute("10:36"),
    schwere: "warn",
    ziel: srv("kraft"),
    text: "Agent seit 6 Min. still; Ereignis nach 3 Min.",
  },
  {
    zeit: heute("08:47"),
    schwere: "info",
    ziel: srv("shared-2"),
    text: "SSH-Anmeldung Lars Wendt (Notzugang über WireGuard)",
  },
  {
    zeit: heute("04:02"),
    schwere: "warn",
    ziel: inst("holm-belegt"),
    text: "Prüf-Restore von holm-belegt gescheitert: Health der Kopie blieb rot",
  },
  {
    zeit: heute("03:52"),
    schwere: "info",
    ziel: inst("intern-belegt"),
    text: "Update auf Belegt 0.0.7 (Welle intern), Health grün",
  },
  {
    zeit: heute("03:15"),
    schwere: "warn",
    ziel: inst("lind-haben"),
    text: "Backup gescheitert: kein Platz auf dem Server",
  },
  {
    zeit: heute("02:10"),
    schwere: "info",
    ziel: srv("shared-2"),
    text: "unattended-upgrades: Kernel 6.12.48 eingespielt, Neustart nötig",
  },
  {
    zeit: gestern("16:20"),
    schwere: "warn",
    ziel: srv("holm"),
    text: "Zertifikat läuft in 12 Tagen ab, Erneuerung gescheitert",
  },
  {
    zeit: gestern("11:04"),
    schwere: "info",
    ziel: inst("weber-haben"),
    text: "Update auf Haben 0.12.0 von Hand, Units laufen",
  },
];

export const auftraege: Auftrag[] = [
  {
    id: "A-2318",
    aktion: "update",
    version: "0.12.0",
    ziel: inst("roth-haben"),
    zustand: "laeuft",
    start: heute("10:40"),
    schritt: "Backup (pg_dump)",
    fortschritt: 30,
  },
  {
    id: "A-2320",
    aktion: "update",
    version: "0.0.7",
    ziel: inst("atelier-belegt"),
    zustand: "laeuft",
    start: heute("10:41"),
    schritt: "Image ziehen",
    fortschritt: 60,
  },
  {
    id: "A-2322",
    aktion: "neustart",
    ziel: inst("berger-schreibzeug"),
    zustand: "gescheitert",
    start: heute("10:35"),
    schritt: "Unit app startet nicht: exit 1",
  },
  {
    id: "A-2321",
    aktion: "update",
    version: "0.0.7",
    ziel: inst("holm-belegt"),
    zustand: "wartet",
    start: heute("10:41"),
    schritt: "wartet auf A-2320",
  },
  {
    id: "A-2316",
    aktion: "pruef_restore",
    ziel: inst("holm-belegt"),
    zustand: "gescheitert",
    start: heute("04:00"),
    schritt: "Health der Kopie rot",
  },
  {
    id: "A-2315",
    aktion: "update",
    version: "0.0.7",
    ziel: inst("intern-belegt"),
    zustand: "fertig",
    start: heute("03:50"),
    schritt: "Health grün nach 41 s",
  },
  {
    id: "A-2313",
    aktion: "backup",
    ziel: inst("lind-haben"),
    zustand: "gescheitert",
    start: heute("03:15"),
    schritt: "pg_dump: kein Platz auf dem Gerät",
  },
  {
    id: "A-2319",
    aktion: "neustart_server",
    ziel: srv("shared-2"),
    zustand: "geplant",
    start: berlin("2026-11-21", "03:30"),
    schritt: "im Wartungsfenster, keine Sperrzeit",
  },
];

const jana = { name: "Jana Beispiel", rolle: "inhaber" as const };

export const audit: AuditEintrag[] = [
  {
    zeit: heute("10:41"),
    akteur: null,
    aktion: "Update gestartet (Welle alle)",
    ziel: inst("atelier-belegt"),
    grund: "Wellenplan Belegt 0.0.7",
  },
  {
    zeit: heute("10:40"),
    akteur: jana,
    aktion: "Update von Hand gestartet",
    ziel: inst("roth-haben"),
    grund: "Haben ohne Health, Kunde hat zugestimmt",
  },
  {
    zeit: heute("10:35"),
    akteur: jana,
    aktion: "Neustart",
    ziel: inst("berger-schreibzeug"),
    grund: "Health rot seit 10:31",
  },
  {
    zeit: gestern("17:12"),
    akteur: jana,
    aktion: "Kündigung eingetragen, Löschung am 28.02.2027",
    ziel: inst("sonne-haben"),
    grund: "Kündigung per Mail vom 18.11.",
  },
  {
    zeit: gestern("11:03"),
    akteur: jana,
    aktion: "Betreiber-Wert geändert: ELSTER_HERSTELLER_ID",
    ziel: { art: "einstellungen" },
    grund: "Neue Hersteller-ID vom ELSTER-Portal",
  },
  {
    zeit: berlin("2026-11-18", "08:00"),
    akteur: null,
    aktion: "Wellenplan angelegt",
    ziel: { art: "app", id: "belegt", version: "0.0.7" },
    grund: "neue Version mit signiertem Manifest",
  },
];

export const konten: Konto[] = [
  { name: "Jana Beispiel", rolle: "inhaber", faktor: "passkey", zuletzt: heute("08:12") },
  { name: "Ole Kamp", rolle: "support", faktor: "passkey", zuletzt: heute("09:55") },
  { name: "Lars Wendt", rolle: "technik", faktor: "totp", zuletzt: gestern("18:40") },
];
