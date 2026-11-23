import type { AussenGrund } from "@steuerzentrale/planung";

/*
 * The reason of a check from outside in German, for the text of an event (events are stored as
 * text, like the Zentrale's other events, modules/bewertung/text.ts); the interface says it in its
 * own language from the code (apps/web, daten/aussen.ts).
 */
export const aussenGrundText = (g: AussenGrund): string => {
  switch (g.code) {
    case "erreichbar":
      return `Health ${g.werte.status ?? ""} in ${g.werte.ms ?? ""} ms`;
    case "dns":
      return `DNS: ${g.werte.fehler ?? ""}`;
    case "dns_abweichung":
      return `DNS zeigt auf ${g.werte.ist ?? ""} statt ${g.werte.soll ?? ""}`;
    case "zertifikat":
      return `Zertifikat: ${g.werte.fehler ?? ""}`;
    case "pforte":
      return `Pforte: ${g.werte.fehler ?? ""}`;
    case "health":
      return `Health: HTTP ${g.werte.status ?? ""}`;
    case "keine_pruefung":
      return "keine Prüfung seit 3 Min.";
  }
};
