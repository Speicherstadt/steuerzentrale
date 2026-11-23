import {
  letzteMonate,
  type MonatsVerfuegbarkeit,
  verfuegbarkeitImMonat,
} from "@steuerzentrale/planung";
import type { AussenDerInstallation, AussenDerZentrale, AussenQuelle } from "../daten/aussen.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { demo } from "./index.ts";

/*
 * The checks from outside of the demo operator, answering as the Zentrale's API does (apps/zentrale,
 * routes/aussen.ts): a red installation answers 503 since 10:31 (design/mockup/, "Health 503 seit
 * 10:31"), every other one 200 in 48 ms, also one whose agent is silent; the names point to the
 * server's addresses, the certificate ends as the server's facts say. The availability of a month
 * is the demo's percentage of the minutes up to its "now", every minute measured.
 */

const TAG = 86_400_000;
const MIN = 60_000;

/** When the red installations turned red outside, as in the mockup */
const ROT_SEIT_MIN = 11;

const aussenVon = (b: Bestand, i: Installation): AussenDerZentrale => {
  const sv = b.server.find((s) => s.id === i.server);
  const rot = i.health === "rot";
  const status = rot ? 503 : 200;
  return {
    zustand: rot ? "rot" : "gruen",
    grund: rot
      ? { code: "health", werte: { status: "503" } }
      : { code: "erreichbar", werte: { status: "200", ms: "48" } },
    seit: rot ? b.jetzt - ROT_SEIT_MIN * MIN : i.laeuftSeit,
    geprueftAm: b.jetzt - 20_000,
    ergebnis: {
      dns: { ok: true, a: sv?.ipv4 ? [sv.ipv4] : [], aaaa: sv?.ipv6 ? [sv.ipv6] : [] },
      tls: { ok: true, gueltigBis: b.jetzt + (sv?.zertifikatTage ?? 60) * TAG },
      http: { ok: true, status, ms: rot ? 12 : 48 },
    },
  };
};

const monatVon = (
  i: Installation,
  m: { jahr: number; monat: number },
  jetzt: number,
): MonatsVerfuegbarkeit => {
  const leer = verfuegbarkeitImMonat([], m, jetzt);
  const prozent = i.verfuegbarkeit[`${m.jahr}-${String(m.monat).padStart(2, "0")}`];
  if (prozent === undefined || leer.minuten === 0) return leer;
  const rot = Math.round((leer.minuten * (100 - prozent)) / 100);
  return {
    ...leer,
    gemessen: leer.minuten,
    rot,
    anteil: (leer.minuten - rot) / leer.minuten,
  };
};

export const aussenDerInstallation = (
  b: Bestand,
  id: string,
): AussenDerInstallation | undefined => {
  const i = b.installationen.find((x) => x.id === id);
  if (!i) return undefined;
  return {
    aussen: aussenVon(b, i),
    verfuegbarkeit: letzteMonate(b.jetzt, 13).map((m) => monatVon(i, m, b.jetzt)),
  };
};

export const demoAussen = (b: Bestand = demo): AussenQuelle => ({
  derInstallation: async (id) => {
    const a = aussenDerInstallation(b, id);
    return a
      ? { ok: true, status: 200, daten: a }
      : { ok: false, status: 404, fehler: "keine_installation" };
  },
});
