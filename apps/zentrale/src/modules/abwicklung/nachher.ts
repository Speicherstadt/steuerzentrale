import { backupPraefix } from "@steuerzentrale/manifest";
import { type Schreiber, schreiben } from "../audit/index.ts";
import { praefixLoeschen } from "../backups/objekte.ts";
import { backupZielLesen } from "../backups/ziel.ts";
import { zugangGeheim, zugangLesen, zugangNachEntfernen } from "../backups/zugaenge.ts";
import { installationLesen } from "../installationen/lesen.ts";
import {
  type AbwicklungDeps,
  ereignis,
  fehlschlag,
  GELOESCHT_ART,
  LOESCHUNG_GESCHEITERT_ART,
  mitEintrag,
  systemKontext,
} from "./gemeinsam.ts";
import type { Abwicklung } from "./lesen.ts";
import { loeschText } from "./text.ts";

/*
 * The steps after the installation was taken down on its server (BAULISTE.md Z-604): its repository
 * with its own access, then that access with its restic password, then its DNS records; the
 * deletion log goes out as the event `installation_geloescht`. schritte.ts calls them only in the
 * contract's deletion phase.
 */

/** Step `repository`: every object below the installation's prefix, with its own access */
export const repositoryLoeschen = async (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
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
  if (z?.zustand !== "angelegt") return weiter("kein Repository");
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
export const zugangPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
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
export const dnsPruefen = (deps: AbwicklungDeps, a: Abwicklung, jetzt: number) => {
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
