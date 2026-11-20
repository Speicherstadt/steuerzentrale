import type { Kunde } from "../daten/typen.ts";
import { berlin } from "./zeit.ts";

/** In stage 1 every contract is SLA Basis; Plus and Ruhe come with Z-505 (BAULISTE.md, Z-801) */
const kunde = (id: string, name: string, kontakt: string, seit: string): Kunde => ({
  id,
  name,
  kontakt,
  sla: "basis",
  seit: berlin(seit),
});

export const kunden: Kunde[] = [
  {
    ...kunde("intern", "Beispiel-Hosting (intern)", "betrieb@beispiel-hosting.de", "2026-01-01"),
    intern: true,
  },
  kunde("atelier-nord", "Atelier Nord", "buero@atelier-nord.de", "2026-03-14"),
  kunde("praxis-weber", "Praxis Weber", "praxis@praxis-weber.de", "2026-05-02"),
  kunde("studio-lind", "Studio Lind", "studio@studio-lind.de", "2026-06-21"),
  kunde("it-berger", "IT Berger", "info@it-berger.de", "2026-08-09"),
  kunde("holm", "Schreinerei Holm", "buero@schreinerei-holm.de", "2026-08-30"),
  kunde("roth", "Übersetzungen Roth", "hallo@roth-uebersetzungen.de", "2026-09-17"),
  kunde("aust", "Fotografie Aust", "mail@fotografie-aust.de", "2026-10-04"),
  kunde("kraft", "Ingenieurbüro Kraft", "kontakt@ib-kraft.de", "2026-11-06"),
  {
    ...kunde("sonne", "Café Sonne", "cafe@cafe-sonne.de", "2026-01-11"),
    gekuendigt: { zum: berlin("2026-11-30"), loeschung: berlin("2027-02-28") },
  },
];
