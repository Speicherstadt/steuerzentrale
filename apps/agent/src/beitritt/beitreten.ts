import {
  BEITRITT_PFAD,
  type BeitrittAnfrage,
  BeitrittAntwort,
  PROTOKOLL_VERSION,
  VERSION,
} from "@steuerzentrale/protokoll";
import type { Dateien } from "../dateien.ts";
import { type Geprueft, manifestSchluessel } from "../einstellungen.ts";
import type { Pfade } from "../pfade.ts";
import { anfrageErzeugen, privatPem, schluesselErzeugen } from "./csr.ts";

export type BeitretenDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  dateien: Dateien;
  pfade: Pfade;
  architektur: BeitrittAnfrage["architektur"];
};

export type Auftrag = { zentrale: string; token: string; testmodus: boolean };

const zentralePruefen = (zentrale: string, testmodus: boolean): Geprueft<string> => {
  const url = URL.parse(zentrale);
  if (!url || !/^https?:$/.test(url.protocol))
    return { ok: false, grund: `${zentrale} is no address of a Zentrale` };
  // plain HTTP only towards a test Zentrale in CI; anywhere else the token would travel openly
  if (url.protocol !== "https:" && !testmodus)
    return { ok: false, grund: "the Zentrale is reached over https only" };
  return { ok: true, wert: url.origin };
};

const fehlerVon = async (antwort: Response): Promise<string> => {
  const daten = (await antwort.json().catch(() => null)) as { fehler?: unknown } | null;
  return `the Zentrale refused the join: ${antwort.status} ${String(daten?.fehler ?? "")}`.trim();
};

const tauschen = async (
  deps: BeitretenDeps,
  zentrale: string,
  anfrage: BeitrittAnfrage,
): Promise<Geprueft<BeitrittAntwort>> => {
  let antwort: Response;
  try {
    antwort = await deps.fetch(`${zentrale}${BEITRITT_PFAD}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(anfrage),
    });
  } catch (fehler) {
    return { ok: false, grund: `the Zentrale did not answer: ${String(fehler)}` };
  }
  if (antwort.status !== 201) return { ok: false, grund: await fehlerVon(antwort) };
  const geparst = BeitrittAntwort.safeParse(await antwort.json().catch(() => null));
  return geparst.success
    ? { ok: true, wert: geparst.data }
    : { ok: false, grund: "the Zentrale's answer is no certificate" };
};

/**
 * Joins the server (BAULISTE.md Z-302): makes the key, which never leaves the server, exchanges the
 * one-time token and a certificate request for the client certificate, and keeps key, certificate,
 * the operator's CA and the settings. The key is written before the exchange, which uses up the
 * token: a certificate is never kept without its key. A joined server does not join again.
 */
export const beitreten = async (
  deps: BeitretenDeps,
  auftrag: Auftrag,
): Promise<Geprueft<string>> => {
  const zentrale = zentralePruefen(auftrag.zentrale, auftrag.testmodus);
  if (!zentrale.ok) return zentrale;
  // a second join would replace the key the certificate belongs to
  if ((await deps.dateien.lesen(deps.pfade.einstellungen)) !== undefined)
    return { ok: false, grund: "the server has joined already" };
  const schluessel = await manifestSchluessel(
    deps.dateien,
    deps.pfade.manifestSchluessel,
    auftrag.testmodus,
  );
  if (!schluessel.ok) return schluessel;
  const paar = await schluesselErzeugen();
  await deps.dateien.schreiben(deps.pfade.schluessel, await privatPem(paar), 0o600);
  const getauscht = await tauschen(deps, zentrale.wert, {
    protokoll: PROTOKOLL_VERSION,
    token: auftrag.token,
    csr: await anfrageErzeugen(paar, "steuerzentrale-agent"),
    agentVersion: VERSION,
    architektur: deps.architektur,
  });
  if (!getauscht.ok) return getauscht;
  const { serverId, zertifikat, ca } = getauscht.wert;
  await deps.dateien.schreiben(deps.pfade.zertifikat, zertifikat, 0o644);
  await deps.dateien.schreiben(deps.pfade.ca, ca, 0o644);
  const einstellungen = { zentrale: zentrale.wert, serverId, testmodus: auftrag.testmodus };
  await deps.dateien.schreiben(
    deps.pfade.einstellungen,
    `${JSON.stringify(einstellungen)}\n`,
    0o644,
  );
  return { ok: true, wert: serverId };
};
