import { ARCHIV_ORDNER, backupPraefix, vorsignieren } from "@steuerzentrale/manifest";
import { linkGueltigBis } from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { objektAdresse } from "../backups/objekte.ts";
import { backupZielLesen } from "../backups/ziel.ts";
import { zugangGeheim, zugangLesen } from "../backups/zugaenge.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { abwicklungLesen, archivVon, vertragsendeVon } from "./lesen.ts";

/*
 * The link to the archive for the customer (BAULISTE.md Z-604; docs/plan.md, "Export bei
 * Kündigung"): a pre-signed S3 GET per file of the archive, signed with the installation's own
 * access, valid seven days at most and never past the 30 days after the contract's end. Made on
 * request, with a reason, shown once to the operator, who passes it on; never stored and never
 * logged: the audit log keeps the reason and until when the link is valid, not the link. After
 * its time S3 refuses it, and with the access deleted no link of it works any more.
 */

export type Link = { tag: string; datei: string; bytes: number; url: string };

export type LinkErgebnis =
  | { ok: true; gueltigBis: number; links: Link[] }
  | {
      ok: false;
      grund: "keine_installation" | "kein_archiv" | "frist_abgelaufen" | "kein_zugang";
      detail?: string;
    };

type Deps = { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund };

export const archivLink = async (
  deps: Deps,
  kontext: Kontext,
  installationId: string,
): Promise<LinkErgebnis> => {
  const { betreiberId, jetzt } = kontext;
  const i = installationLesen(deps.db, betreiberId, installationId);
  if (!i) return { ok: false, grund: "keine_installation" };
  const a = abwicklungLesen(deps.db, betreiberId, installationId);
  const archiv = a ? archivVon(a) : null;
  if (!a || !archiv) return { ok: false, grund: "kein_archiv" };
  const bis = linkGueltigBis(vertragsendeVon(deps.db, betreiberId, i.kundeId), jetzt);
  if (bis === undefined) return { ok: false, grund: "frist_abgelaufen" };
  const z = zugangLesen(deps.db, betreiberId, installationId);
  const g = z?.zustand === "angelegt" ? zugangGeheim(deps.schluessel, z) : undefined;
  const t = backupZielLesen(deps.db, betreiberId);
  if (!g?.ok || !t.endpunkt || !t.bucket || !t.region) return { ok: false, grund: "kein_zugang" };
  const ort = backupPraefix({ bucket: t.bucket, betreiberId, installationId });
  if (!ort.ok) return { ok: false, grund: "kein_zugang", detail: ort.grund };
  const o = { endpunkt: t.endpunkt, bucket: t.bucket };
  const links: Link[] = [];
  for (const objekt of archiv.objekte) {
    const url = await vorsignieren({
      methode: "GET",
      url: objektAdresse(o, `${ort.praefix}${ARCHIV_ORDNER}${objekt.datei}`),
      zugang: { accessKey: g.geheim.accessKey, secretKey: g.geheim.secretKey },
      region: t.region,
      jetzt,
      gueltigS: Math.max(1, Math.floor((bis - jetzt) / 1000)),
    });
    links.push({ ...objekt, url: url.href });
  }
  schreiben(deps.schreibDb, kontext, "installation.archiv-link", (w) =>
    w.aendern("abwicklungen", { installationId }, { linkBis: bis, geaendertAm: jetzt }),
  );
  return { ok: true, gueltigBis: bis, links };
};
