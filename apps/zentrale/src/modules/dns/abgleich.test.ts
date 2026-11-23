import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { auditLog, auftraege, ereignisse, installationen } from "../../db/schema.ts";
import { cloudflareNachbau, TEST_TOKEN, TEST_ZONE } from "../../testhilfen/cloudflare.ts";
import {
  dateiInhalt,
  installationsUmgebung,
  neueInstallation,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { installationAnlegen } from "../installationen/anlegen.ts";
import { installationEntfernen } from "../installationen/entfernen.ts";
import { type DnsDeps, dnsAbgleichen, dnsSchleife } from "./abgleich.ts";
import { dnsEinstellungenSetzen } from "./einstellungen.ts";

/*
 * BAULISTE.md Z-407 against the stand-in of Cloudflare's API (testhilfen/cloudflare.ts): an
 * installation below the operator's domain gets A and AAAA when it is made and loses them once
 * `installation_entfernen` succeeded; a record of someone else stays; a failure of the API makes
 * `dns_fehler` and a later attempt that succeeds; a host outside the domain gets nothing; the token
 * stands nowhere but in the Authorization header to Cloudflare.
 */

const cf = cloudflareNachbau();
afterAll(() => cf.stoppen());

const DOMAIN = "apps.example.de";
const HOST = `probe.kanzlei.${DOMAIN}`;

type U = ReturnType<typeof installationsUmgebung>;

const umgebung = () => {
  const u = installationsUmgebung();
  const agent = u.bereit();
  dnsEinstellungenSetzen(u.deps, u.kontext("b1"), {
    domain: DOMAIN,
    zoneId: TEST_ZONE,
    token: TEST_TOKEN,
  });
  const dns: DnsDeps = { ...u.deps, fetch, basis: cf.url };
  return { u, agent, dns };
};

const anlegen = (u: U, host = HOST) => {
  const a = installationAnlegen(
    u.deps,
    u.kontext("b1"),
    TEST_SCHLUESSEL,
    neueInstallation({ host }),
  );
  if (!a.ok) throw new Error(a.grund);
  return a.installation.installationId;
};

const zeile = (u: U, id: string) =>
  u.db
    .select()
    .from(installationen)
    .all()
    .find((i) => i.installationId === id);

const vonHost = (host: string) => cf.eintraege().filter((e) => e.name === host);

const melden = (u: U, aktion: string, ok: boolean) => {
  const auftragId =
    u.db
      .select()
      .from(auftraege)
      .all()
      .filter((a) => a.aktion === aktion)
      .at(-1)?.auftragId ?? "";
  const server = { betreiberId: "b1", serverId: "s1" } as Parameters<typeof auftragMelden>[1];
  const ergebnis: AuftragsMeldung = {
    typ: "ergebnis",
    protokoll: 1,
    auftragId,
    zeit: 1,
    ergebnis: ok ? { ok: true, daten: {} } : { ok: false, fehler: "exit 1" },
  };
  auftragMelden(u.deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
  auftragMelden(u.deps, server, ergebnis, u.uhr.ms);
};

describe("the DNS records of an installation", () => {
  it("are set as A and AAAA, not proxied, TTL 300, with the Zentrale's comment", async () => {
    const { u, dns } = umgebung();
    const id = anlegen(u);
    expect(zeile(u, id)?.dns).toBe("setzen");
    expect(await dnsAbgleichen(dns)).toBe(1);
    const kommentar = `steuerzentrale:${id}`;
    expect(vonHost(HOST).map(({ id: _, ...rest }) => rest)).toEqual([
      {
        type: "A",
        name: HOST,
        content: "203.0.113.10",
        ttl: 300,
        proxied: false,
        comment: kommentar,
      },
      {
        type: "AAAA",
        name: HOST,
        content: "2001:db8::10",
        ttl: 300,
        proxied: false,
        comment: kommentar,
      },
    ]);
    expect(zeile(u, id)).toMatchObject({
      dns: "gesetzt",
      dnsVersuche: 0,
      dnsNaechsterVersuch: null,
    });
    expect(await dnsAbgleichen(dns)).toBe(0);
  });

  it("go once installation_entfernen succeeded, and records of others stay", async () => {
    const { u, dns } = umgebung();
    const host = `entfernt.kanzlei.${DOMAIN}`;
    cf.eintragen({
      type: "TXT",
      name: host,
      content: "von Hand",
      ttl: 1,
      proxied: false,
      comment: null,
    });
    cf.eintragen({
      type: "A",
      name: `www.${DOMAIN}`,
      content: "198.51.100.7",
      ttl: 1,
      proxied: false,
      comment: null,
    });
    const id = anlegen(u, host);
    await dnsAbgleichen(dns);
    expect(
      vonHost(host)
        .map((e) => e.type)
        .sort(),
    ).toEqual(["A", "AAAA", "TXT"]);

    melden(u, EINRICHTUNG_AKTIONEN.einrichten, false);
    expect(installationEntfernen(u.deps, u.kontext("b1"), id).ok).toBe(true);
    await dnsAbgleichen(dns);
    // removing is not removed yet: the records stay until the agent reports success
    expect(vonHost(host)).toHaveLength(3);
    melden(u, EINRICHTUNG_AKTIONEN.entfernen, true);
    expect(zeile(u, id)).toMatchObject({ zustand: "entfernt", dns: "loeschen" });
    await dnsAbgleichen(dns);
    expect(vonHost(host).map((e) => [e.type, e.content])).toEqual([["TXT", "von Hand"]]);
    expect(vonHost(`www.${DOMAIN}`)).toHaveLength(1);
    expect(zeile(u, id)?.dns).toBe("geloescht");
  });

  it("are never set beside a record without the Zentrale's comment, which stays as it was", async () => {
    const { u, dns } = umgebung();
    const host = `belegt.kanzlei.${DOMAIN}`;
    cf.eintragen({
      type: "A",
      name: host,
      content: "198.51.100.8",
      ttl: 1,
      proxied: false,
      comment: "von Hand",
    });
    const id = anlegen(u, host);
    await dnsAbgleichen(dns);
    expect(vonHost(host).map((e) => [e.type, e.content, e.comment])).toEqual([
      ["A", "198.51.100.8", "von Hand"],
    ]);
    expect(zeile(u, id)).toMatchObject({ dns: "setzen", dnsVersuche: 1 });
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({ art: "dns_fehler", schwere: "warn", ziel: `installation:${id}` }),
    ]);
  });

  it("are tried again later after a failure of the API, which makes dns_fehler once", async () => {
    const { u, dns } = umgebung();
    const host = `wieder.kanzlei.${DOMAIN}`;
    const id = anlegen(u, host);
    cf.scheitern(2);
    await dnsAbgleichen(dns);
    expect(zeile(u, id)).toMatchObject({
      dns: "setzen",
      dnsVersuche: 1,
      dnsNaechsterVersuch: u.uhr.ms + 60_000,
    });
    const fehler = u.db.select().from(ereignisse).all();
    expect(fehler).toEqual([
      expect.objectContaining({ art: "dns_fehler", schwere: "warn", ziel: `installation:${id}` }),
    ]);
    expect(fehler[0]?.text).toContain("HTTP 500");
    // not due yet: nothing is asked
    expect(await dnsAbgleichen(dns)).toBe(0);
    u.uhr.ms += 60_000;
    await dnsAbgleichen(dns);
    expect(zeile(u, id)).toMatchObject({ dnsVersuche: 2, dnsNaechsterVersuch: u.uhr.ms + 120_000 });
    expect(u.db.select().from(ereignisse).all()).toHaveLength(1);
    u.uhr.ms += 120_000;
    await dnsAbgleichen(dns);
    expect(zeile(u, id)).toMatchObject({ dns: "gesetzt", dnsVersuche: 0 });
    expect(vonHost(host)).toHaveLength(2);
  });

  it("wait for a token and are set once one is", async () => {
    const u = installationsUmgebung();
    u.bereit();
    dnsEinstellungenSetzen(u.deps, u.kontext("b1"), { domain: DOMAIN, zoneId: TEST_ZONE });
    const dns: DnsDeps = { ...u.deps, fetch, basis: cf.url };
    const host = `spaet.kanzlei.${DOMAIN}`;
    const id = anlegen(u, host);
    const vorher = cf.anfragen.length;
    await dnsAbgleichen(dns);
    expect(cf.anfragen.length).toBe(vorher);
    expect(u.db.select().from(ereignisse).all()[0]?.text).toContain("no API token set");
    dnsEinstellungenSetzen(u.deps, u.kontext("b1"), {
      domain: DOMAIN,
      zoneId: TEST_ZONE,
      token: TEST_TOKEN,
    });
    await dnsAbgleichen(dns);
    expect(zeile(u, id)?.dns).toBe("gesetzt");
  });

  it("are due at once after a new token saved while an attempt with the old one was under way", async () => {
    const u = installationsUmgebung();
    u.bereit();
    const alt = "cf-revoked-token-0000000000000000";
    dnsEinstellungenSetzen(u.deps, u.kontext("b1"), {
      domain: DOMAIN,
      zoneId: TEST_ZONE,
      token: alt,
    });
    const host = `neu.kanzlei.${DOMAIN}`;
    const id = anlegen(u, host);
    // a stand-in of its own: the old token stays out of the shared one's requests
    const eigener = cloudflareNachbau();
    onTestFinished(() => eigener.stoppen());
    let gespeichert = false;
    // the operator saves the right token while Cloudflare still answers the call with the old one
    const zwischendurch: typeof fetch = Object.assign(
      (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (!gespeichert) {
          gespeichert = true;
          dnsEinstellungenSetzen(u.deps, u.kontext("b1"), {
            domain: DOMAIN,
            zoneId: TEST_ZONE,
            token: TEST_TOKEN,
          });
        }
        return fetch(url, init);
      },
      { preconnect: fetch.preconnect },
    );
    await dnsAbgleichen({ ...u.deps, fetch: zwischendurch, basis: eigener.url });
    expect(zeile(u, id)?.dnsNaechsterVersuch).toBeLessThanOrEqual(u.uhr.ms);
    await dnsAbgleichen({ ...u.deps, fetch, basis: eigener.url });
    expect(zeile(u, id)?.dns).toBe("gesetzt");
  });

  it("are not set for a host outside the domain", async () => {
    const { u, dns } = umgebung();
    const vorher = cf.anfragen.length;
    const id = anlegen(u, "probe.kunde.example");
    expect(zeile(u, id)).toMatchObject({ dns: null, dnsNaechsterVersuch: null });
    expect(await dnsAbgleichen(dns)).toBe(0);
    expect(cf.anfragen.length).toBe(vorher);
    expect(cf.eintraege().filter((e) => e.name === "probe.kunde.example")).toEqual([]);
  });
});

describe("the DNS check", () => {
  it("runs every 30 s and at once when pushed, after making an installation", async () => {
    const { u, dns } = umgebung();
    const geplant: number[] = [];
    const schleife = dnsSchleife(dns, (_lauf, ms) => geplant.push(ms));
    expect(geplant).toEqual([30_000]);
    const mitStoss = { ...u, deps: { ...u.deps, dnsAnstossen: schleife.anstossen } };
    const id = anlegen(mitStoss, `sofort.kanzlei.${DOMAIN}`);
    await expect.poll(() => zeile(u, id)?.dns).toBe("gesetzt");
  });
});

describe("the DNS token", () => {
  it("stands only encrypted in the database and in no log, event, audit entry or agent message", async () => {
    const { u, agent, dns } = umgebung();
    const id = anlegen(u, `geheim.kanzlei.${DOMAIN}`);
    cf.scheitern(1);
    await dnsAbgleichen(dns);
    u.uhr.ms += 60_000;
    await dnsAbgleichen(dns);
    melden(u, EINRICHTUNG_AKTIONEN.einrichten, false);
    installationEntfernen(u.deps, u.kontext("b1"), id);
    melden(u, EINRICHTUNG_AKTIONEN.entfernen, true);
    await dnsAbgleichen(dns);

    expect(agent.length).toBeGreaterThan(0);
    expect(JSON.stringify(agent)).not.toContain(TEST_TOKEN);
    expect(u.log.join("\n")).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(u.db.select().from(ereignisse).all())).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(u.db.select().from(auditLog).all())).not.toContain(TEST_TOKEN);
    expect(dateiInhalt(u.pfad)).not.toContain(TEST_TOKEN);
    // only in the header of the requests to Cloudflare, never in a path or body
    const eigene = cf.anfragen.filter((a) => a.pfad.includes(TEST_ZONE));
    expect(eigene.length).toBeGreaterThan(0);
    for (const a of eigene) {
      expect(`${a.pfad} ${a.body}`).not.toContain(TEST_TOKEN);
      expect(a.autorisierung).toBe(`Bearer ${TEST_TOKEN}`);
    }
  });
});
