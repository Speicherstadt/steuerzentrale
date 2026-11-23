import { fristen, linkGueltigBis, vertragsphase } from "@steuerzentrale/planung";
import type { Abwicklung, AbwicklungQuelle } from "../daten/abwicklung.ts";
import { demo } from "./index.ts";

/*
 * What follows a contract's end in the demo, answering as the Zentrale's API does (apps/zentrale,
 * routes/abwicklung.ts): phase and deadlines from the demo customer's contract and the demo's
 * fixed morning; an installation past its end has its archive of one file per part, and its link
 * points nowhere real. Nothing is deleted in the demo.
 */

const nein = (status: number, fehler: string) => ({ ok: false, status, fehler }) as const;

const ansicht = (id: string): Abwicklung | undefined => {
  const i = demo.installationen.find((x) => x.id === id);
  if (!i) return undefined;
  const ende = demo.kunden.find((k) => k.id === i.kunde)?.vertrag.ende ?? null;
  const phase = vertragsphase(ende, demo.jetzt);
  const f = ende === null ? null : fristen(ende);
  const vorbei = ende !== null && phase !== "laeuft";
  return {
    phase,
    vertragsende: ende,
    nurLesenBis: f?.nurLesenBis ?? null,
    loeschenAb: f?.loeschenAb ?? null,
    schritt: vorbei ? "warten" : null,
    archiv: vorbei
      ? {
          am: ende,
          objekte: [{ tag: "volume:daten", datei: "volume-daten.tar", bytes: 52_428_800 }],
        }
      : null,
    linkBis: null,
    geloeschtAm: null,
    protokoll: [],
  };
};

export const demoAbwicklung = (): AbwicklungQuelle => ({
  lesen: async (id) => {
    const a = ansicht(id);
    return a ? { ok: true, status: 200, daten: a } : nein(404, "keine_installation");
  },
  link: async (id) => {
    const a = ansicht(id);
    if (!a) return nein(404, "keine_installation");
    if (!a.archiv) return nein(409, "kein_archiv");
    const bis = linkGueltigBis(a.vertragsende, demo.jetzt);
    if (bis === undefined) return nein(409, "frist_abgelaufen");
    const links = a.archiv.objekte.map((o) => ({
      ...o,
      url: `https://s3.example.org/demo/${id}/archiv/${o.datei}?X-Amz-Expires=604800`,
    }));
    return { ok: true, status: 200, daten: { gueltigBis: bis, links } };
  },
});
