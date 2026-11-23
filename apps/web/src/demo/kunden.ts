import type { Kunde } from "../daten/typen.ts";
import { berlin } from "./zeit.ts";

/** In stage 1 every contract is SLA Basis; Plus and Ruhe come with Z-505 (BAULISTE.md, Z-801) */
const kunde = (
  id: string,
  name: string,
  kontakt: [name: string, email: string, telefon?: string],
  seit: string,
): Kunde => ({
  id,
  name,
  kontakt: { name: kontakt[0], email: kontakt[1], telefon: kontakt[2] ?? null },
  notiz: null,
  // the ids of the demo are short names already; every demo customer has installations
  kuerzel: id,
  kuerzelAenderbar: false,
  angelegtAm: berlin(seit, "09:00"),
  vertrag: { sla: "basis", beginn: berlin(seit), ende: null },
});

const sonne = kunde("sonne", "Café Sonne", ["Clara Sonne", "cafe@cafe-sonne.de"], "2026-01-11");

export const kunden: Kunde[] = [
  {
    ...kunde(
      "intern",
      "Beispiel-Hosting (intern)",
      ["Jana Beispiel", "betrieb@beispiel-hosting.de"],
      "2026-01-01",
    ),
    intern: true,
  },
  kunde(
    "atelier-nord",
    "Atelier Nord",
    ["Anna Nord", "buero@atelier-nord.de", "+49 40 5550123"],
    "2026-03-14",
  ),
  {
    ...kunde(
      "praxis-weber",
      "Praxis Weber",
      ["Dr. Petra Weber", "praxis@praxis-weber.de", "+49 30 5550147"],
      "2026-05-02",
    ),
    notiz: "Mail über Kontext; Termine nur außerhalb der Sprechzeiten.",
  },
  kunde("studio-lind", "Studio Lind", ["Lars Lind", "studio@studio-lind.de"], "2026-06-21"),
  kunde("it-berger", "IT Berger", ["Ben Berger", "info@it-berger.de"], "2026-08-09"),
  kunde("holm", "Schreinerei Holm", ["Henrik Holm", "buero@schreinerei-holm.de"], "2026-08-30"),
  kunde("roth", "Übersetzungen Roth", ["Rita Roth", "hallo@roth-uebersetzungen.de"], "2026-09-17"),
  kunde("aust", "Fotografie Aust", ["Ali Aust", "mail@fotografie-aust.de"], "2026-10-04"),
  kunde("kraft", "Ingenieurbüro Kraft", ["Karl Kraft", "kontakt@ib-kraft.de"], "2026-11-06"),
  { ...sonne, vertrag: { ...sonne.vertrag, ende: berlin("2026-11-30") } },
];
