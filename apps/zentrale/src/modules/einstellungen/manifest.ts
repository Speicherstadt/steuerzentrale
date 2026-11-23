import { type Manifest, manifestPruefen } from "@steuerzentrale/manifest";
import { istVorabversion } from "@steuerzentrale/planung";
import type { Db } from "../../db/oeffnen.ts";
import { manifesteDerApp, manifestLesen } from "../manifeste/index.ts";

/*
 * The manifest the operator's values of an app are checked against (docs/plan.md, "Neuestes
 * Manifest einer App"): since Z-501 the imported one of the highest version that is no
 * pre-release, else the highest pre-release; a pre-release is only for internal installations and
 * should not decide the values every installation of the app gets. The manifests of installations
 * made before Z-501 are imported at the start (modules/manifeste/uebernehmen.ts).
 */

/** The newest imported manifest of the app, or undefined without one */
export const neuestesManifest = (db: Db, app: string): Manifest | undefined => {
  const koepfe = manifesteDerApp(db, app);
  const reihe = [
    ...koepfe.filter((k) => !istVorabversion(k.version)),
    ...koepfe.filter((k) => istVorabversion(k.version)),
  ];
  for (const k of reihe) {
    const eintrag = manifestLesen(db, app, k.version);
    const geprueft = eintrag ? manifestPruefen(eintrag.text) : undefined;
    if (geprueft?.ok) return geprueft.manifest;
  }
  return undefined;
};
