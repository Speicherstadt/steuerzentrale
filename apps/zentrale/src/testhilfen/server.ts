import { randomUUID } from "node:crypto";
import { onTestFinished } from "vitest";
import { type AppDeps, createApp } from "../app.ts";
import { createAuth } from "../auth/auth.ts";
import { testDatenbank } from "../db/test-db.ts";
import { einrichtungscodeErzeugen } from "../modules/anmeldung/einrichtungscode.ts";
import { auslieferung } from "../modules/server/index.ts";
import { betreiberEinrichten } from "../routes/erster-inhaber.ts";
import { TEST_AGENT_URL, testAgentDateien } from "./agent-dateien.ts";
import { authenticator } from "./authenticator.ts";
import { type Browser, browserFuer, erfolgreich, SOCKET_HEADER, TEST_URL } from "./browser.ts";
import { totpCode, totpSchluessel } from "./totp.ts";

export { TEST_AGENT_URL, TEST_URL };
export const PASSWORT = "lang-genug-und-geheim-1";

/** Sets up TOTP for the signed-in account; returns the key of its authenticator app */
export const totpEinrichten = async (b: Browser, passwort = PASSWORT) => {
  const { totpURI } = await erfolgreich(b, "/api/auth/two-factor/enable", {
    body: { password: passwort },
  });
  const schluessel = totpSchluessel(String(totpURI));
  await erfolgreich(b, "/api/auth/two-factor/verify-totp", {
    body: { code: totpCode(schluessel) },
  });
  return schluessel;
};

/** Registers a software passkey for the signed-in account */
export const passkeyEinrichten = async (b: Browser) => {
  const geraet = authenticator(TEST_URL);
  const optionen = await erfolgreich(b, "/api/auth/passkey/generate-register-options");
  await erfolgreich(b, "/api/auth/passkey/verify-registration", {
    body: { response: geraet.registrieren(optionen as never), name: "Test" },
  });
  return geraet;
};

/** A Zentrale on a fresh test database with Better Auth */
const kern = (aufraeumen: (fn: () => void) => void = onTestFinished) => {
  const uhr = { ms: 1_800_000_000_000 };
  const jetzt = () => uhr.ms;
  const datenbank = testDatenbank(undefined, aufraeumen);
  const agentDateien = testAgentDateien(aufraeumen);
  const log: string[] = [];
  const auth = createAuth({
    schreibDb: datenbank.schreibDb,
    url: TEST_URL,
    geheimnis: datenbank.anmeldeGeheimnis,
  });
  const deps: AppDeps = {
    log: (zeile) => log.push(zeile),
    now: jetzt,
    version: "test",
    db: datenbank.db,
    schreibDb: datenbank.schreibDb,
    auth,
    url: TEST_URL,
    schluessel: datenbank.schluessel,
    agentUrl: TEST_AGENT_URL,
    auslieferung: auslieferung(agentDateien, TEST_AGENT_URL),
    socketAdresse: (request) => request.headers.get(SOCKET_HEADER) ?? undefined,
  };
  const app = createApp(deps);
  return {
    ...datenbank,
    uhr,
    jetzt,
    log,
    auth,
    app,
    deps,
    agentDateien,
    browser: browserFuer(app),
  };
};

type Kern = ReturnType<typeof kern>;

/** The people of the tests: first owner, invited members, a further operator */
const personen = (k: Kern) => {
  const neuerCode = () => {
    const erzeugt = einrichtungscodeErzeugen(k.db, k.schreibDb, k.jetzt());
    if (!erzeugt) throw new Error("setup is closed");
    return erzeugt.code;
  };

  /** The first owner through the setup code, with a password (or none) and nothing else yet */
  const ersterInhaber = async (angaben: { passwort?: string | null } = {}) => {
    const b = k.browser();
    const passwort = angaben.passwort === undefined ? PASSWORT : angaben.passwort;
    const email = "inhaberin@betreiber.test";
    const { betreiberId, nutzerId } = await erfolgreich(b, "/api/v1/erster-inhaber", {
      body: {
        code: neuerCode(),
        betreiber: "Teufel IT",
        name: "Ines Inhaber",
        email,
        ...(passwort === null ? {} : { passwort }),
      },
    });
    return { ...b, email, betreiberId: String(betreiberId), nutzerId: String(nutzerId) };
  };
  type Person = Awaited<ReturnType<typeof ersterInhaber>>;

  /** Someone the owner invited, with password and TOTP set up */
  const eingeladen = async (von: Person, rolle: string, email = `${rolle}@betreiber.test`) => {
    const { link } = await erfolgreich(von, "/api/v1/einladungen", { body: { rolle } });
    const token = String(link).split("#")[1] ?? "";
    const b = k.browser();
    const { nutzerId } = await erfolgreich(b, "/api/v1/einladung/annehmen", {
      body: { token, name: `Person ${rolle}`, email, passwort: PASSWORT },
    });
    const totp = await totpEinrichten(b);
    return { ...b, email, totp, betreiberId: von.betreiberId, nutzerId: String(nutzerId) };
  };

  /** A further operator with its owner (password and TOTP), as a partner will come in later */
  const weitererBetreiber = async (name: string, email: string) => {
    const b = k.browser();
    const betreiberId = randomUUID();
    const konto = await betreiberEinrichten(k.deps, betreiberId, {
      betreiber: name,
      name: `Inhaber ${name}`,
      email,
      passwort: PASSWORT,
    });
    if (!konto.ok) throw new Error(konto.grund);
    b.uebernehmen(konto.headers);
    const totp = await totpEinrichten(b);
    return { ...b, email, totp, betreiberId, nutzerId: konto.nutzerId };
  };

  /** The first owner with password and TOTP: an account that reaches the routes of its role */
  const inhaber = async () => {
    const person = await ersterInhaber();
    return { ...person, totp: await totpEinrichten(person) };
  };

  return { neuerCode, ersterInhaber, inhaber, eingeladen, weitererBetreiber };
};

/**
 * A Zentrale on a fresh test database with Better Auth, and people who act over HTTP as a browser
 * would (cookies kept between calls), after Speicherstadt/soll, apps/server/src/test-server.ts
 */
export const testServer = (aufraeumen?: (fn: () => void) => void) => {
  const k = kern(aufraeumen);
  return {
    ...k,
    ...personen(k),
    totpEinrichten,
    passkeyEinrichten,
    stelleUhr: (ms: number) => {
      k.uhr.ms = ms;
    },
  };
};

export type TestServer = ReturnType<typeof testServer>;
