import type { PruefungName, Serverpruefung } from "@steuerzentrale/planung";

/*
 * The text of a check's event in German, like the Zentrale's other events (events are stored as
 * text); the interface says a check's result in its own language from the data (apps/web,
 * seiten/server-texte.ts).
 */

const NAMEN: Record<PruefungName, string> = {
  platte: "Platte",
  zertifikate: "Zertifikate",
  backups: "Backups",
  ports: "Offene Ports",
  uhrzeit: "Uhrzeit",
  arbeitsspeicher: "Arbeitsspeicher",
};

const zahl = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });

const TAG = 86_400_000;

const zertifikatText = (z: { host: string; gueltigBis: number }, jetzt: number) =>
  z.gueltigBis <= jetzt
    ? `${z.host} ist abgelaufen`
    : `${z.host} läuft in ${Math.ceil((z.gueltigBis - jetzt) / TAG)} Tagen ab`;

/** What is wrong, as one sentence that names the server */
export const befundText = (server: string, p: Serverpruefung, jetzt: number): string => {
  switch (p.pruefung) {
    case "platte": {
      const voll = p.platten?.[0];
      return `Platte auf ${server}: ${voll?.mount ?? "?"} zu ${zahl(voll?.prozent ?? 0)} % belegt`;
    }
    case "zertifikate": {
      const z = p.zertifikate?.[0];
      return `Zertifikat auf ${server}: ${z ? zertifikatText(z, jetzt) : "?"}`;
    }
    case "backups":
      return `Backups auf ${server} älter als 26 h: ${p.alt.map((i) => i.name).join(", ")}`;
    case "ports":
      return `Offene Ports auf ${server}, die kein Manifest nennt: ${(p.fremd ?? [])
        .map((x) => `${x.port}/${x.proto}`)
        .join(", ")}`;
    case "uhrzeit":
      return `Uhrzeit auf ${server}: ${[
        p.abweichungMs === null ? "Abweichung unbekannt" : `Abweichung ${p.abweichungMs} ms`,
        p.synchron === false ? "nicht synchron" : p.synchron ? "synchron" : null,
      ]
        .filter(Boolean)
        .join(", ")}`;
    case "arbeitsspeicher":
      return `Arbeitsspeicher auf ${server} zu ${zahl(p.prozent ?? 0)} % belegt`;
  }
};

export const behobenText = (server: string, p: PruefungName): string =>
  `Prüfung ${NAMEN[p]} auf ${server} wieder in Ordnung`;
