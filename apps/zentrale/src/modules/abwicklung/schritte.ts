import { vertragsphase } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { schreiben } from "../audit/index.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { archivKette, loeschKette } from "./auftraege.ts";
import {
  type AbwicklungDeps,
  ARCHIV_GESCHEITERT_ART,
  fehlschlag,
  kettenSchreiben,
  LOESCHUNG_GESCHEITERT_ART,
  mitEintrag,
  offenerAuftrag,
  systemKontext,
} from "./gemeinsam.ts";
import { type Abwicklung, ArchivDaten, type Beendet, vertragsendeVon } from "./lesen.ts";
import { dnsPruefen, repositoryLoeschen, zugangPruefen } from "./nachher.ts";

export {
  type AbwicklungDeps,
  ARCHIV_GESCHEITERT_ART,
  GELOESCHT_ART,
  LOESCHUNG_GESCHEITERT_ART,
} from "./gemeinsam.ts";

/*
 * The steps after a contract ended (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"),
 * one installation at a time, each written through `schreiben` (actor `system`). Nothing is
 * deleted unless the contract is in its deletion phase (90 days after the end, vertragsphase):
 * every step from `loeschen` on checks it again. A step that fails waits (backoff as for DNS) and
 * makes an event the first time of a series; its event and the deletion log go to the recipients
 * of the operator (Z-703), by mail and signed webhook.
 */

/** The contract ended: the row, and "nur lesen", the last backup and the archive */
export const beginnen = (deps: AbwicklungDeps, b: Beendet, jetzt: number): void => {
  const i = installationLesen(deps.db, b.betreiberId, b.installationId);
  if (!i || offenerAuftrag(deps, b.betreiberId, b.installationId)) return;
  const k = systemKontext(b.betreiberId, jetzt, "Vertragsende erreicht");
  const kette = archivKette(deps, k, i, true);
  const zeile = {
    betreiberId: b.betreiberId,
    installationId: b.installationId,
    kundeId: b.kundeId,
    vertragsende: b.ende,
    versuche: 0,
    protokoll: mitEintrag(
      { protokoll: "[]" },
      "vertragsende",
      jetzt,
      new Date(b.ende).toISOString(),
    ),
    angelegtAm: jetzt,
    geaendertAm: jetzt,
  };
  if (!kette.ok) {
    schreiben(deps.schreibDb, k, "abwicklung.beginnen", (w) =>
      w.einfuegen("abwicklungen", { ...zeile, schritt: "archiv", naechsterVersuch: jetzt }),
    );
    deps.log(JSON.stringify({ msg: "archive not possible", detail: kette.detail }));
    return;
  }
  kettenSchreiben(deps, k, "abwicklung.beginnen", kette, (w) =>
    w.einfuegen("abwicklungen", {
      ...zeile,
      schritt: kette.letzter ? "archiv" : "warten",
      archivAuftragId: kette.letzter,
    }),
  );
};

const datenVon = (job: Auftrag): unknown => {
  try {
    return (JSON.parse(job.ergebnis ?? "{}") as { daten?: unknown }).daten;
  } catch {
    return undefined;
  }
};

/** Step `archiv`: the archive's job ended, or a new chain after a failed one */
const archivPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number): void => {
  const job = a.archivAuftragId
    ? auftragLesen(deps.db, a.betreiberId, a.archivAuftragId)
    : undefined;
  if (job && !ENDZUSTAENDE.has(job.zustand)) return;
  const k = systemKontext(a.betreiberId, jetzt, "Archiv für den Kunden");
  if (job?.zustand === "erfolgreich") {
    const daten = ArchivDaten.safeParse(datenVon(job));
    if (daten.success) {
      const archiv = JSON.stringify({ am: jetzt, objekte: daten.data.objekte });
      const n = daten.data.objekte.length;
      schreiben(deps.schreibDb, k, "abwicklung.archiv", (w) =>
        w.aendern(
          "abwicklungen",
          { installationId: a.installationId },
          {
            schritt: "warten",
            archiv,
            versuche: 0,
            naechsterVersuch: null,
            protokoll: mitEintrag(a, "archiv", jetzt, `${n} Dateien`),
            geaendertAm: jetzt,
          },
        ),
      );
      return;
    }
  }
  if (job) {
    const grund = job.zustand === "erfolgreich" ? "Daten des Archivs unlesbar" : job.zustand;
    const text = `Archiv von ${a.installationId} gescheitert: ${grund}`;
    fehlschlag(deps, a, jetzt, ARCHIV_GESCHEITERT_ART, text, { archivAuftragId: null });
    return;
  }
  const i = installationLesen(deps.db, a.betreiberId, a.installationId);
  if (i?.zustand !== "laeuft" || offenerAuftrag(deps, a.betreiberId, a.installationId)) return;
  const kette = archivKette(deps, k, i, false);
  if (!kette.ok || !kette.letzter) {
    const text = `Archiv von ${a.installationId} nicht möglich: ${kette.ok ? "kein Backup" : kette.detail}`;
    fehlschlag(deps, a, jetzt, ARCHIV_GESCHEITERT_ART, text);
    return;
  }
  kettenSchreiben(deps, k, "abwicklung.archiv", kette, (w) =>
    w.aendern(
      "abwicklungen",
      { installationId: a.installationId },
      { archivAuftragId: kette.letzter, naechsterVersuch: null, geaendertAm: jetzt },
    ),
  );
};

/** 90 days after the end: the last backup and taking the installation down */
const loeschenBeginnen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number): void => {
  const i = installationLesen(deps.db, a.betreiberId, a.installationId);
  if (!i || offenerAuftrag(deps, a.betreiberId, a.installationId)) return;
  const k = systemKontext(a.betreiberId, jetzt, "Löschfrist nach Vertragsende erreicht");
  if (i.zustand === "entfernt") {
    schreiben(deps.schreibDb, k, "abwicklung.loeschen", (w) =>
      w.aendern(
        "abwicklungen",
        { installationId: a.installationId },
        {
          schritt: "repository",
          protokoll: mitEintrag(a, "installation", jetzt, "schon entfernt"),
          geaendertAm: jetzt,
        },
      ),
    );
    return;
  }
  const kette = loeschKette(deps, k, i);
  if (!kette.ok) {
    fehlschlag(
      deps,
      a,
      jetzt,
      LOESCHUNG_GESCHEITERT_ART,
      `Löschen von ${a.installationId}: ${kette.detail}`,
    );
    return;
  }
  kettenSchreiben(deps, k, "abwicklung.loeschen", kette, (w) =>
    w.aendern(
      "abwicklungen",
      { installationId: a.installationId },
      {
        schritt: "loeschen",
        loeschAuftragId: kette.letzter,
        naechsterVersuch: null,
        geaendertAm: jetzt,
      },
    ),
  );
};

/** Step `loeschen`: the job that took the installation down ended */
const loeschenPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number): void => {
  const job = a.loeschAuftragId
    ? auftragLesen(deps.db, a.betreiberId, a.loeschAuftragId)
    : undefined;
  if (job && !ENDZUSTAENDE.has(job.zustand)) return;
  if (job?.zustand === "erfolgreich") {
    const k = systemKontext(a.betreiberId, jetzt, "Installation gelöscht");
    schreiben(deps.schreibDb, k, "abwicklung.installation", (w) =>
      w.aendern(
        "abwicklungen",
        { installationId: a.installationId },
        {
          schritt: "repository",
          versuche: 0,
          naechsterVersuch: null,
          protokoll: mitEintrag(a, "installation", jetzt, `Auftrag ${job.auftragId}`),
          geaendertAm: jetzt,
        },
      ),
    );
    return;
  }
  // cancelled (the backup before it failed) or never written: nothing was taken down, it waits;
  // failed on the server: part of it may be gone, so it stays in `loeschen` and the notice can no
  // longer be taken back (kunden.ts); either way a new chain later
  const text = `Löschen von ${a.installationId} gescheitert: ${job?.zustand ?? "kein Auftrag"}`;
  fehlschlag(deps, a, jetzt, LOESCHUNG_GESCHEITERT_ART, text, {
    schritt: job?.zustand === "gescheitert" ? "loeschen" : "warten",
    loeschAuftragId: null,
  });
};

/** One row: the step it stands at, if due; nothing from `loeschen` on before the deadline */
export const schrittAusfuehren = async (
  deps: AbwicklungDeps,
  a: Abwicklung,
  jetzt: number,
): Promise<void> => {
  if (a.naechsterVersuch !== null && jetzt < a.naechsterVersuch) return;
  const loeschen =
    vertragsphase(vertragsendeVon(deps.db, a.betreiberId, a.kundeId), jetzt) === "loeschen";
  if (a.schritt === "archiv" || a.schritt === "warten") {
    const archivLaeuft =
      a.schritt === "archiv" &&
      a.archivAuftragId !== null &&
      !ENDZUSTAENDE.has(
        auftragLesen(deps.db, a.betreiberId, a.archivAuftragId)?.zustand ?? "erfolgreich",
      );
    if (loeschen && !archivLaeuft) return loeschenBeginnen(deps, a, jetzt);
    if (a.schritt === "archiv") archivPruefen(deps, a, jetzt);
    return;
  }
  if (!loeschen) return;
  if (a.schritt === "loeschen")
    return a.loeschAuftragId === null
      ? loeschenBeginnen(deps, a, jetzt)
      : loeschenPruefen(deps, a, jetzt);
  if (a.schritt === "repository") return repositoryLoeschen(deps, a, jetzt);
  if (a.schritt === "zugang") return zugangPruefen(deps, a, jetzt);
  if (a.schritt === "dns") return dnsPruefen(deps, a, jetzt);
};
