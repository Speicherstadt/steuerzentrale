import type { KundenQuelle } from "../daten/kunden.ts";
import type { Kunde } from "../daten/typen.ts";

/**
 * The customers of the demo in memory, answering as the Zentrale's API would (routes/kunden.ts in
 * apps/zentrale): a change lasts until the page reloads
 */
export const demoKunden = (start: Kunde[], jetzt: () => number): KundenQuelle => {
  let liste = structuredClone(start);
  const ok = <T>(daten: T) => ({ ok: true, status: 200, daten }) as const;
  const fehlt = { ok: false, status: 404, fehler: "kein_kunde" } as const;
  const frueh = { ok: false, status: 409, fehler: "ende_vor_beginn" } as const;
  const aendern = (id: string, aenderung: (k: Kunde) => Kunde) => {
    const alt = liste.find((k) => k.id === id);
    if (!alt) return fehlt;
    const neu = aenderung(alt);
    if (neu.vertrag.ende !== null && neu.vertrag.ende < neu.vertrag.beginn) return frueh;
    liste = liste.map((k) => (k.id === id ? neu : k));
    return ok(neu);
  };
  const stamm = (daten: Parameters<KundenQuelle["aendern"]>[1]) => ({
    name: daten.name,
    kontakt: { ...daten.kontakt, telefon: daten.kontakt.telefon ?? null },
    notiz: daten.notiz ?? null,
  });
  return {
    liste: async () => ok([...liste].sort((a, b) => a.name.localeCompare(b.name, "de"))),
    kunde: async (id) => {
      const k = liste.find((x) => x.id === id);
      return k ? ok(k) : fehlt;
    },
    anlegen: async (neu) => {
      const kunde: Kunde = {
        id: crypto.randomUUID(),
        ...stamm({ ...neu, beginn: neu.vertrag.beginn }),
        angelegtAm: jetzt(),
        vertrag: { sla: neu.vertrag.sla, beginn: neu.vertrag.beginn, ende: null },
      };
      liste = [...liste, kunde];
      return { ok: true, status: 201, daten: kunde };
    },
    aendern: async (id, daten) =>
      aendern(id, (k) => ({
        ...k,
        ...stamm(daten),
        vertrag: { ...k.vertrag, beginn: daten.beginn },
      })),
    kuendigen: async (id, ende) => aendern(id, (k) => ({ ...k, vertrag: { ...k.vertrag, ende } })),
    zuruecknehmen: async (id) =>
      aendern(id, (k) => ({ ...k, vertrag: { ...k.vertrag, ende: null } })),
  };
};
