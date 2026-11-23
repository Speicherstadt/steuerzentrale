import { describe, expect, it } from "vitest";
import {
  AUSSEN_FRIST_MS,
  type AussenStand,
  aussenBewerten,
  aussenFortschreiben,
  aussenJetzt,
  aussenMeldungPruefen,
  type Probe,
} from "./aussen.ts";

/*
 * BAULISTE.md Z-704; docs/plan.md, "Prüfung von außen": the Zentrale checks each public address in
 * steps, DNS, the Pforte's certificate and connection, then the health path through the public
 * host; the first step that fails is the reason. "Agent grün, außen rot" is an event once two
 * checks in a row were red, its end one more when green again.
 */

const T = Date.UTC(2026, 10, 23, 12);
const soll = { A: "203.0.113.10", AAAA: "2001:db8::10" };
const gut: Probe = {
  dns: { ok: true, a: ["203.0.113.10"], aaaa: ["2001:db8::10"] },
  tls: { ok: true, gueltigBis: T + 60 * 86_400_000 },
  http: { ok: true, status: 200, ms: 48 },
};

describe("aussenBewerten", () => {
  it("is green when the names point where the Zentrale set them and health answers 200–399", () => {
    expect(aussenBewerten(gut, soll, "health")).toEqual({
      zustand: "gruen",
      grund: { code: "erreichbar", werte: { status: "200", ms: "48" } },
    });
    expect(
      aussenBewerten({ ...gut, http: { ok: true, status: 302, ms: 5 } }, soll, "health").zustand,
    ).toBe("gruen");
  });

  it("is red when the name does not resolve", () => {
    expect(aussenBewerten({ dns: { ok: false, fehler: "ENOTFOUND" } }, soll, "health")).toEqual({
      zustand: "rot",
      grund: { code: "dns", werte: { fehler: "ENOTFOUND" } },
    });
  });

  it("is red when A or AAAA differ from what the Zentrale set, naming both", () => {
    const falsch = { ok: true as const, a: ["198.51.100.7"], aaaa: ["2001:db8::10"] };
    expect(aussenBewerten({ ...gut, dns: falsch }, soll, "health")).toEqual({
      zustand: "rot",
      grund: {
        code: "dns_abweichung",
        werte: { soll: "203.0.113.10, 2001:db8::10", ist: "198.51.100.7, 2001:db8::10" },
      },
    });
    const zuviel = { ok: true as const, a: ["203.0.113.10", "198.51.100.7"], aaaa: [] };
    expect(
      aussenBewerten({ ...gut, dns: zuviel }, { A: "203.0.113.10", AAAA: null }, "health"),
    ).toMatchObject({ zustand: "rot", grund: { code: "dns_abweichung" } });
  });

  it("does not compare the addresses of a host the Zentrale sets no records for", () => {
    const anders = { ok: true as const, a: ["198.51.100.7"], aaaa: [] };
    expect(aussenBewerten({ ...gut, dns: anders }, null, "health").zustand).toBe("gruen");
  });

  it("tells a bad certificate from a Pforte that does not answer", () => {
    expect(
      aussenBewerten(
        { ...gut, tls: { ok: false, art: "zertifikat", fehler: "CERT_HAS_EXPIRED" } },
        soll,
        "health",
      ),
    ).toEqual({
      zustand: "rot",
      grund: { code: "zertifikat", werte: { fehler: "CERT_HAS_EXPIRED" } },
    });
    expect(
      aussenBewerten(
        { ...gut, tls: { ok: false, art: "netz", fehler: "ECONNREFUSED" } },
        soll,
        "health",
      ),
    ).toEqual({ zustand: "rot", grund: { code: "pforte", werte: { fehler: "ECONNREFUSED" } } });
  });

  it("is red for a health status outside 200–399 or a request that failed", () => {
    expect(
      aussenBewerten({ ...gut, http: { ok: true, status: 503, ms: 12 } }, soll, "health"),
    ).toEqual({ zustand: "rot", grund: { code: "health", werte: { status: "503" } } });
    expect(
      aussenBewerten({ ...gut, http: { ok: false, fehler: "Zeitlimit" } }, soll, "health"),
    ).toEqual({ zustand: "rot", grund: { code: "pforte", werte: { fehler: "Zeitlimit" } } });
  });

  it("without a health path behind the Pforte, takes any answer below 500 as reached", () => {
    expect(
      aussenBewerten({ ...gut, http: { ok: true, status: 404, ms: 9 } }, soll, "antwort").zustand,
    ).toBe("gruen");
    expect(
      aussenBewerten({ ...gut, http: { ok: true, status: 502, ms: 9 } }, soll, "antwort"),
    ).toEqual({ zustand: "rot", grund: { code: "health", werte: { status: "502" } } });
  });

  it("is red when a step's answer is missing, never green by default", () => {
    expect(aussenBewerten({ dns: gut.dns }, soll, "health").zustand).toBe("rot");
    const tls = { ok: true as const, gueltigBis: T + 86_400_000 };
    expect(aussenBewerten({ dns: gut.dns, tls }, soll, "health").zustand).toBe("rot");
  });

  it("keeps a long error short", () => {
    const lang = "x".repeat(2000);
    const r = aussenBewerten({ dns: { ok: false, fehler: lang } }, soll, "health");
    expect(r.grund.werte.fehler).toHaveLength(500);
  });
});

const rot = {
  zustand: "rot" as const,
  grund: { code: "health" as const, werte: { status: "503" } },
};
const gruen = {
  zustand: "gruen" as const,
  grund: { code: "erreichbar" as const, werte: { status: "200", ms: "40" } },
};

describe("aussenFortschreiben", () => {
  it("keeps `seit` while the state holds and starts it anew on a change", () => {
    const erst = aussenFortschreiben(null, rot, T);
    expect(erst).toEqual({ stand: { ...rot, seit: T, geprueftAm: T }, wechsel: true });
    const dann = aussenFortschreiben(erst.stand, rot, T + 60_000);
    expect(dann).toEqual({ stand: { ...rot, seit: T, geprueftAm: T + 60_000 }, wechsel: false });
    expect(aussenFortschreiben(dann.stand, gruen, T + 120_000).stand.seit).toBe(T + 120_000);
  });
});

describe("aussenJetzt", () => {
  it("is unknown once no check came for three minutes", () => {
    const stand: AussenStand = { ...gruen, seit: T, geprueftAm: T };
    expect(aussenJetzt(stand, T + AUSSEN_FRIST_MS - 1)).toBe(stand);
    expect(aussenJetzt(stand, T + AUSSEN_FRIST_MS)).toEqual({
      zustand: "unbekannt",
      grund: { code: "keine_pruefung", werte: {} },
      seit: T + AUSSEN_FRIST_MS,
      geprueftAm: T,
    });
  });
});

describe("aussenMeldungPruefen", () => {
  it("reports red once a second check in a row was red, and only once", () => {
    const einmal: AussenStand = { ...rot, seit: T, geprueftAm: T };
    const zweimal: AussenStand = { ...rot, seit: T, geprueftAm: T + 60_000 };
    expect(aussenMeldungPruefen(einmal, null, T)).toBeUndefined();
    expect(aussenMeldungPruefen(zweimal, null, T + 60_000)).toBe("rot");
    expect(aussenMeldungPruefen(zweimal, "gruen", T + 60_000)).toBe("rot");
    expect(aussenMeldungPruefen(zweimal, "rot", T + 60_000)).toBeUndefined();
  });

  it("reports green after a red report, nothing for unknown", () => {
    const wieder: AussenStand = { ...gruen, seit: T, geprueftAm: T };
    expect(aussenMeldungPruefen(wieder, "rot", T)).toBe("gruen");
    expect(aussenMeldungPruefen(wieder, "gruen", T)).toBeUndefined();
    expect(aussenMeldungPruefen(wieder, null, T)).toBeUndefined();
    const alt: AussenStand = { ...rot, seit: T, geprueftAm: T + 60_000 };
    expect(aussenMeldungPruefen(alt, null, T + 60_000 + AUSSEN_FRIST_MS)).toBeUndefined();
  });
});
