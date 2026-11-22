import type { HealthDerZentrale, HealthGrund, Verlaufseintrag } from "../daten/bewertung.ts";
import type { Installation, Manifest } from "../daten/typen.ts";

/*
 * The state of the demo's installations as the Zentrale's API reports it (Z-403): from the health
 * of each fixture, with the units of its app's containers, the reason as the Zentrale's code and a
 * short history. A red one has its failed unit, an unknown one its last report six minutes ago.
 */

const MINUTE = 60_000;

/** Before the agent's first report, as for a new installation or a failed setup */
export const ohneMeldung = (): HealthDerZentrale => ({
  zustand: "unbekannt",
  grund: { code: "noch_keine_meldung", werte: {} },
  seit: null,
  gemeldetAm: null,
  units: [],
});

const grundVon = (i: Installation, app: Manifest | undefined): HealthGrund => {
  if (i.health === "unbekannt") return { code: "keine_meldung", werte: {} };
  if (i.health === "rot") return { code: "health", werte: { text: "HTTP 503" } };
  if (i.health === "gelb") return { code: "health", werte: { text: i.grund ?? "" } };
  return app && "keine" in app.health
    ? { code: "nur_units", werte: {} }
    : { code: "health", werte: { text: "HTTP 200" } };
};

const aktivVon = (i: Installation, container: string) =>
  i.health === "rot" && container === i.roteUnit ? "failed" : "active";

/** How long the state has held: a problem since this morning, green since the installation ran */
const seitVon = (i: Installation, jetzt: number) =>
  i.health === "gruen" ? i.laeuftSeit : jetzt - (i.health === "unbekannt" ? 5 : 11) * MINUTE;

export const demoHealth = (
  i: Installation,
  app: Manifest | undefined,
  jetzt: number,
): { health: HealthDerZentrale; verlauf: Verlaufseintrag[] } => {
  const seit = seitVon(i, jetzt);
  const grund = grundVon(i, app);
  const health: HealthDerZentrale = {
    zustand: i.health,
    grund,
    seit,
    gemeldetAm: i.health === "unbekannt" ? jetzt - 6 * MINUTE : jetzt - 12_000,
    units: (app?.container ?? []).map((c) => ({ name: `${c}.service`, aktiv: aktivVon(i, c) })),
  };
  const jetztEintrag = { zeitpunkt: seit, bewertung: i.health, grund };
  const verlauf: Verlaufseintrag[] =
    i.health === "gruen"
      ? [jetztEintrag]
      : [
          jetztEintrag,
          {
            zeitpunkt: i.laeuftSeit,
            bewertung: "gruen",
            grund: { code: "health", werte: { text: "HTTP 200" } },
          },
        ];
  return { health, verlauf };
};
