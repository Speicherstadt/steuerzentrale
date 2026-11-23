import { randomUUID } from "node:crypto";
import { backupPraefix } from "@steuerzentrale/manifest";
import { vertragsphase } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { auftragEinfuegen } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { praefixLoeschen } from "../backups/objekte.ts";
import { backupZielLesen } from "../backups/ziel.ts";
import { zugangGeheim, zugangLesen, zugangNachEntfernen } from "../backups/zugaenge.ts";
import { naechsterVersuch } from "../dns/index.ts";
import { auftraegeDerInstallation, installationLesen } from "../installationen/lesen.ts";
import { archivKette, type Kette, loeschKette } from "./auftraege.ts";
import {
  type Abwicklung,
  ArchivDaten,
  type Beendet,
  protokollVon,
  vertragsendeVon,
} from "./lesen.ts";
import { loeschText } from "./text.ts";

/*
 * The steps after a contract ended (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"),
 * one installation at a time, each written through `schreiben` (actor `system`). Nothing is
 * deleted unless the contract is in its deletion phase (90 days after the end, vertragsphase):
 * every step from `loeschen` on checks it again. A step that fails waits (backoff as for DNS) and
 * makes an event the first time of a series; its event and the deletion log go to the recipients
 * of the operator (Z-703), by mail and signed webhook.
 */

export type AbwicklungDeps = AuftragDeps & { fetch: typeof fetch; neueId?: () => string };

export const GELOESCHT_ART = "installation_geloescht";
export const ARCHIV_GESCHEITERT_ART = "archiv_gescheitert";
export const LOESCHUNG_GESCHEITERT_ART = "loeschung_gescheitert";

const systemKontext = (betreiberId: string, jetzt: number, grund: string): Kontext => ({
  betreiberId,
  akteur: "system",
  jetzt,
  grund,
});

const mitEintrag = (a: Pick<Abwicklung, "protokoll">, schritt: string, z: number, detail: string) =>
  JSON.stringify([...protokollVon(a), { schritt, zeitpunkt: z, detail }]);

const ziel = (installationId: string) => `installation:${installationId}`;

const ereignis = (
  w: Schreiber,
  deps: AbwicklungDeps,
  a: { betreiberId: string; installationId: string },
  e: { art: string; schwere: "info" | "warn" | "fehler"; text: string; jetzt: number },
) =>
  w.einfuegen("ereignisse", {
    betreiberId: a.betreiberId,
    ereignisId: (deps.neueId ?? randomUUID)(),
    zeitpunkt: e.jetzt,
    art: e.art,
    schwere: e.schwere,
    ziel: ziel(a.installationId),
    text: e.text.slice(0, 2000),
  });

const offenerAuftrag = (deps: AuftragDeps, betreiberId: string, installationId: string) =>
  auftraegeDerInstallation(deps.db, betreiberId, installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );

/** Writes the chain's jobs in the change, then sends those that are ready */
const kettenSchreiben = (
  deps: AbwicklungDeps,
  k: Kontext,
  aktion: string,
  kette: Extract<Kette, { ok: true }>,
  dazu: (w: Schreiber) => void,
) => {
  const geschrieben = schreiben(deps.schreibDb, k, aktion, (w) => {
    const zeilen = kette.zeilen.map((z) => auftragEinfuegen(w, z));
    dazu(w);
    return zeilen;
  });
  zustellen(deps, geschrieben);
};

/** A failed step: one more attempt later, an event on the first failure of a series */
const fehlschlag = (
  deps: AbwicklungDeps,
  a: Abwicklung,
  jetzt: number,
  art: string,
  text: string,
  werte: Partial<Abwicklung> = {},
) => {
  const versuche = a.versuche + 1;
  schreiben(deps.schreibDb, systemKontext(a.betreiberId, jetzt, text), "abwicklung.fehler", (w) => {
    w.aendern(
      "abwicklungen",
      { installationId: a.installationId },
      {
        ...werte,
        versuche,
        naechsterVersuch: naechsterVersuch(versuche, jetzt),
        geaendertAm: jetzt,
      },
    );
    if (versuche === 1) ereignis(w, deps, a, { art, schwere: "fehler", text, jetzt });
  });
};

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
  if (!i || i.zustand !== "laeuft" || offenerAuftrag(deps, a.betreiberId, a.installationId)) return;
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
  // failed, cancelled (the backup before it failed) or never written: a new chain later
  const text = `Löschen von ${a.installationId} gescheitert: ${job?.zustand ?? "kein Auftrag"}`;
  fehlschlag(deps, a, jetzt, LOESCHUNG_GESCHEITERT_ART, text, {
    schritt: "warten",
    loeschAuftragId: null,
  });
};

/** Step `repository`: every object below the installation's prefix, with its own access */
const repositoryLoeschen = async (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
  const z = zugangLesen(deps.db, a.betreiberId, a.installationId);
  const k = systemKontext(a.betreiberId, jetzt, "Repository löschen");
  const weiter = (detail: string, dazu: (w: Schreiber) => void = () => {}) => {
    schreiben(deps.schreibDb, k, "abwicklung.repository", (w) => {
      w.aendern(
        "abwicklungen",
        { installationId: a.installationId },
        {
          schritt: "zugang",
          versuche: 0,
          naechsterVersuch: null,
          protokoll: mitEintrag(a, "repository", jetzt, detail),
          geaendertAm: jetzt,
        },
      );
      dazu(w);
    });
    deps.backupAnstossen?.();
  };
  if (!z || z.zustand !== "angelegt") return weiter("kein Repository");
  const nein = (fehler: string) =>
    fehlschlag(
      deps,
      a,
      jetzt,
      LOESCHUNG_GESCHEITERT_ART,
      `Repository von ${a.installationId}: ${fehler}`,
    );
  const t = backupZielLesen(deps.db, a.betreiberId);
  const g = zugangGeheim(deps.schluessel, z);
  if (!g.ok) return nein(g.grund);
  if (!t.endpunkt || !t.bucket || !t.region) return nein("no S3 target set");
  const ort = backupPraefix({
    bucket: t.bucket,
    betreiberId: a.betreiberId,
    installationId: a.installationId,
  });
  if (!ort.ok) return nein(ort.grund);
  const r = await praefixLoeschen(
    {
      fetch: deps.fetch,
      endpunkt: t.endpunkt,
      region: t.region,
      bucket: t.bucket,
      zugang: { accessKey: g.geheim.accessKey, secretKey: g.geheim.secretKey },
      jetzt: deps.now,
    },
    ort.praefix,
  );
  if (!r.ok) return nein(r.fehler);
  weiter(`${r.geloescht} Objekte gelöscht`, (w) => zugangNachEntfernen(w, deps.db, a, jetzt));
};

/** Step `zugang`: the access deleted at MinIO, then its row with the restic password */
const zugangPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
  const z = zugangLesen(deps.db, a.betreiberId, a.installationId);
  if (z && z.zustand !== "geloescht") return;
  schreiben(
    deps.schreibDb,
    systemKontext(a.betreiberId, jetzt, "S3-Zugang gelöscht"),
    "abwicklung.zugang",
    (w) => {
      if (z) w.loeschen("backupZugaenge", { installationId: a.installationId });
      w.aendern(
        "abwicklungen",
        { installationId: a.installationId },
        {
          schritt: "dns",
          protokoll: mitEintrag(
            a,
            "zugang",
            jetzt,
            z ? "S3-Zugang und restic-Passwort gelöscht" : "kein S3-Zugang",
          ),
          geaendertAm: jetzt,
        },
      );
    },
  );
};

/** Step `dns`: its records gone, the deletion log goes out as an event */
const dnsPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
  const i = installationLesen(deps.db, a.betreiberId, a.installationId);
  if (i && i.dns !== null && i.dns !== "geloescht") return;
  const protokoll = mitEintrag(
    a,
    "dns",
    jetzt,
    i?.dns === "geloescht" ? "DNS-Einträge gelöscht" : "keine DNS-Einträge",
  );
  const fertig = { ...a, protokoll };
  schreiben(
    deps.schreibDb,
    systemKontext(a.betreiberId, jetzt, "Löschprotokoll"),
    "abwicklung.geloescht",
    (w) => {
      w.aendern(
        "abwicklungen",
        { installationId: a.installationId },
        { schritt: "geloescht", protokoll, geloeschtAm: jetzt, geaendertAm: jetzt },
      );
      ereignis(w, deps, a, {
        art: GELOESCHT_ART,
        schwere: "warn",
        text: loeschText(fertig),
        jetzt,
      });
    },
  );
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
  if (a.schritt === "loeschen") return loeschenPruefen(deps, a, jetzt);
  if (a.schritt === "repository") return repositoryLoeschen(deps, a, jetzt);
  if (a.schritt === "zugang") return zugangPruefen(deps, a, jetzt);
  if (a.schritt === "dns") return dnsPruefen(deps, a, jetzt);
};
