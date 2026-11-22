import type { Grund } from "@steuerzentrale/planung";

/*
 * A rating's reason in German, for the text of an event (events are stored as text, like the
 * Zentrale's other events); the interface says it in its own language from the code
 * (apps/web, daten/bewertung.ts).
 */
export const grundText = (g: Grund): string => {
  switch (g.code) {
    case "health":
      return `Health: ${g.werte.text ?? ""}`;
    case "unit":
      return `Unit ${g.werte.unit ?? ""}: ${g.werte.aktiv ?? ""}`;
    case "keine_units":
      return "keine Units gemeldet";
    case "nur_units":
      return "alle Units aktiv, keine Health-Prüfung im Manifest";
    case "keine_meldung":
      return "keine Meldung seit 90 s";
    case "noch_keine_meldung":
      return "noch keine Meldung";
  }
};
