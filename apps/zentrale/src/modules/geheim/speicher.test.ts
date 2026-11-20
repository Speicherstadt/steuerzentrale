import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oeffneDatenbank } from "../../db/oeffnen.ts";
import { geheimnisse, tokens } from "../../db/schema.ts";
import { testDatenbank, testSchluessel } from "../../db/test-db.ts";
import { schreiben } from "../audit/index.ts";
import { geheimnisLesen, geheimnisSetzen } from "./geheimnisse.ts";
import { rotieren } from "./rotieren.ts";
import { tokenAnlegen, tokenFinden } from "./tokens.ts";

const KLARTEXT = "s3-zugang-6f1c2b9e-geheim";
const kontext = (betreiberId: string) => ({
  betreiberId,
  akteur: "konto",
  jetzt: 1,
  grund: "Test",
});

/** The database file and its write-ahead log, as bytes an attacker with the disk would read */
const dateiInhalt = (pfad: string): string => {
  const teile = [pfad, `${pfad}-wal`].map((datei) => {
    try {
      return readFileSync(datei).toString("latin1");
    } catch {
      return "";
    }
  });
  return teile.join("");
};

const mitGeheimnis = (offen = testDatenbank(), betreiberId = "b1", klartext = KLARTEXT) => {
  schreiben(offen.schreibDb, kontext(betreiberId), "anlegen", (s) => {
    s.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: 1 });
    geheimnisSetzen(s, offen.schluessel, offen.db, {
      betreiberId,
      geheimnisId: "s3",
      zweck: "s3",
      klartext,
      jetzt: 1,
    });
  });
  return offen;
};

describe("secrets in the database", () => {
  it("are nowhere in the database file in plain text, the audit log included", () => {
    const offen = mitGeheimnis();
    offen.sqlite.run("PRAGMA wal_checkpoint(FULL)");
    expect(dateiInhalt(offen.pfad)).not.toContain(KLARTEXT);
    expect(dateiInhalt(offen.pfad)).not.toContain(Buffer.from(KLARTEXT).toString("base64"));
    expect(geheimnisLesen(offen.db, offen.schluessel, "b1", "s3")).toEqual({
      ok: true,
      wert: KLARTEXT,
    });
  });

  it("are replaced in place and stay bound to their row", () => {
    const offen = mitGeheimnis();
    schreiben(offen.schreibDb, kontext("b1"), "aendern", (s) =>
      geheimnisSetzen(s, offen.schluessel, offen.db, {
        betreiberId: "b1",
        geheimnisId: "s3",
        zweck: "s3",
        klartext: "neu",
        jetzt: 2,
      }),
    );
    expect(geheimnisLesen(offen.db, offen.schluessel, "b1", "s3")).toEqual({
      ok: true,
      wert: "neu",
    });
    const wert = offen.db.select().from(geheimnisse).get()?.wert ?? "";
    offen.sqlite.run("INSERT INTO geheimnisse VALUES ('b2', 's3', 's3', ?, 1)", [wert]);
    expect(geheimnisLesen(offen.db, offen.schluessel, "b2", "s3").ok).toBe(false);
    expect(geheimnisLesen(offen.db, offen.schluessel, "b1", "fehlt")).toEqual({
      ok: false,
      grund: "fehlt",
    });
  });
});

describe("rotating the key", () => {
  it("keeps every value readable and encrypts it with the new key", () => {
    const alt = testSchluessel(7);
    const neu = testSchluessel(9);
    const erst = mitGeheimnis(testDatenbank({ aktuell: alt, alt: [] }));
    mitGeheimnis(erst, "b2", "zweites-geheimnis");
    erst.schliessen();

    const beide = oeffneDatenbank(erst.pfad, 2, { aktuell: neu, alt: [alt] });
    expect(rotieren(beide, 2)).toBe(2);
    for (const zeile of beide.db.select().from(geheimnisse).all())
      expect(zeile.wert.startsWith(`v1.${neu.id}.`)).toBe(true);
    beide.schliessen();

    const nurNeu = oeffneDatenbank(erst.pfad, 3, { aktuell: neu, alt: [] });
    expect(geheimnisLesen(nurNeu.db, nurNeu.schluessel, "b1", "s3")).toEqual({
      ok: true,
      wert: KLARTEXT,
    });
    expect(geheimnisLesen(nurNeu.db, nurNeu.schluessel, "b2", "s3")).toEqual({
      ok: true,
      wert: "zweites-geheimnis",
    });
    nurNeu.schliessen();
    expect(() => oeffneDatenbank(erst.pfad, 4, { aktuell: alt, alt: [] })).toThrow(
      "does not open this database",
    );
  });

  it("leaves no value on the old key in the database file, the append-only audit log included", () => {
    const alt = testSchluessel(7);
    const neu = testSchluessel(9);
    const erst = mitGeheimnis(testDatenbank({ aktuell: alt, alt: [] }));
    erst.schliessen();
    const beide = oeffneDatenbank(erst.pfad, 2, { aktuell: neu, alt: [alt] });
    rotieren(beide, 2);
    // A rotation follows a leaked key: with it, nothing in the file may still open a secret
    expect(dateiInhalt(erst.pfad).includes(`v1.${alt.id}.`)).toBe(false);
    beide.schliessen();
  });

  it("writes nothing when a value cannot be decrypted", () => {
    const offen = mitGeheimnis();
    offen.sqlite.run("UPDATE geheimnisse SET wert = 'v1.00000000.AAAA'");
    expect(() => rotieren(offen, 2)).toThrow("cannot be decrypted");
    expect(offen.db.select().from(geheimnisse).get()?.wert).toBe("v1.00000000.AAAA");
  });

  it("refuses a secret whose operator is gone instead of leaving it on the old key", () => {
    const offen = mitGeheimnis();
    offen.sqlite.run(
      "INSERT INTO geheimnisse SELECT 'weg', geheimnis_id, zweck, wert, geaendert_am FROM geheimnisse",
    );
    const neu = { ...offen, schluessel: { aktuell: testSchluessel(9), alt: [testSchluessel(7)] } };
    expect(() => rotieren(neu, 2)).toThrow("has no operator");
  });
});

describe("the key at the start", () => {
  it("must open the database: a wrong key is refused even before any secret exists", () => {
    const offen = testDatenbank();
    offen.schliessen();
    expect(() => oeffneDatenbank(offen.pfad, 1, { aktuell: testSchluessel(8), alt: [] })).toThrow(
      "STEUERZENTRALE_SECRET_KEY does not open this database",
    );
    oeffneDatenbank(offen.pfad, 1, { aktuell: testSchluessel(7), alt: [] }).schliessen();
  });
});

describe("tokens", () => {
  it("are stored only as hash and cannot be read back", () => {
    const offen = mitGeheimnis();
    const token = schreiben(offen.schreibDb, kontext("b1"), "token", (s) =>
      tokenAnlegen(s, {
        betreiberId: "b1",
        tokenId: "t1",
        zweck: "server",
        gueltigBis: 100,
        jetzt: 1,
      }),
    );
    offen.sqlite.run("PRAGMA wal_checkpoint(FULL)");
    expect(dateiInhalt(offen.pfad)).not.toContain(token);
    expect(JSON.stringify(offen.db.select().from(tokens).all())).not.toContain(token);
    expect(tokenFinden(offen.db, token, "server", 50)).toEqual({
      betreiberId: "b1",
      tokenId: "t1",
      zweck: "server",
    });
  });

  it("are refused when wrong, for another purpose or expired", () => {
    const offen = mitGeheimnis();
    const token = schreiben(offen.schreibDb, kontext("b1"), "token", (s) =>
      tokenAnlegen(s, {
        betreiberId: "b1",
        tokenId: "t1",
        zweck: "server",
        gueltigBis: 100,
        jetzt: 1,
      }),
    );
    expect(tokenFinden(offen.db, `${token}x`, "server", 50)).toBeUndefined();
    expect(tokenFinden(offen.db, token, "api", 50)).toBeUndefined();
    expect(tokenFinden(offen.db, token, "server", 100)).toBeUndefined();
  });
});
