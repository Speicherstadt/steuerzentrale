import { ABWICKLUNG_AKTIONEN, BACKUP_AKTIONEN } from "@steuerzentrale/manifest";
import { fristen, tagesbeginn } from "@steuerzentrale/planung";
import { afterAll, describe, expect, it } from "vitest";
import {
  abwicklungen,
  auditLog,
  backupZugaenge,
  ereignisse,
  installationen,
  zustellungen,
} from "../../db/schema.ts";
import { BUCKET, backupUmgebung } from "../../testhilfen/backups.ts";
import { cloudflareNachbau, TEST_TOKEN, TEST_ZONE } from "../../testhilfen/cloudflare.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { schreiben } from "../audit/index.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { backupAbgleichen } from "../backups/index.ts";
import { zustellungenAnlegen } from "../benachrichtigung/index.ts";
import { dnsAbgleichen } from "../dns/abgleich.ts";
import { dnsEinstellungenSetzen } from "../dns/einstellungen.ts";
import { vertragsendeSetzen } from "../kunden/kunden.ts";
import type { Server } from "../server/index.ts";
import { abwicklungRunde, archivLink, GELOESCHT_ART } from "./index.ts";

/*
 * BAULISTE.md Z-604 against the stand-ins of MinIO (admin API and S3 objects, with its own clock)
 * and Cloudflare: at the contract's end the last backup and the archive for the customer, whose
 * pre-signed link works until its time and is refused after; nothing is deleted before 90 days
 * after the end; then the installation is taken down on its server, its repository, S3 access
 * and DNS records go, and the deletion log goes out as an event to the recipients (webhook, Z-703).
 * A notice taken back before the deletion drops what followed it; after, it cannot be taken back.
 */

const uhr = { ms: 0 };
const minio = minioNachbau({ jetzt: () => uhr.ms });
const cf = cloudflareNachbau();
afterAll(() => {
  minio.stoppen();
  cf.stoppen();
});

const DOMAIN = "apps.example.de";

const umgebung = async () => {
  const u = backupUmgebung(minio);
  uhr.ms = u.uhr.ms;
  const takt = (ms: number) => {
    u.uhr.ms = ms;
    uhr.ms = ms;
  };
  u.zielSetzen();
  dnsEinstellungenSetzen(u.deps, u.kontext("b1"), {
    domain: DOMAIN,
    zoneId: TEST_ZONE,
    token: TEST_TOKEN,
  });
  const host = `${crypto.randomUUID().slice(0, 8)}.${DOMAIN}`;
  const id = u.laufend("gesichert", { host });
  const dns = { ...u.deps, basis: cf.url };
  await dnsAbgleichen(dns);
  await backupAbgleichen(u.deps);
  u.melden(u.auftrag(id, BACKUP_AKTIONEN.einrichten)?.auftragId ?? "", true);
  u.melden(u.auftrag(id, "pforte_route_setzen")?.auftragId ?? "", true);
  const ende = tagesbeginn(u.uhr.ms, 1);
  const k = vertragsendeSetzen(u.db, u.schreibDb, u.kontext("b1"), "k1", ende);
  if (!k.ok) throw new Error(k.grund);
  return { u, id, host, ende, takt, dns, ...fristen(ende) };
};

type U = Awaited<ReturnType<typeof umgebung>>;

/** The agent reports the newest job of `aktion` with `daten` */
const melden = (x: U, aktion: string, ok: boolean, daten: Record<string, unknown> = {}) => {
  const a = x.u.auftrag(x.id, aktion);
  if (!a) throw new Error(`no job ${aktion}`);
  const s = { betreiberId: "b1", serverId: "s1" } as Server;
  const ergebnis: AuftragsMeldung = {
    typ: "ergebnis",
    protokoll: 1,
    auftragId: a.auftragId,
    zeit: x.u.uhr.ms,
    ergebnis: ok ? { ok: true, daten } : { ok: false, fehler: "exit 1" },
  };
  auftragMelden(x.u.deps, s, { typ: "bestaetigt", protokoll: 1, auftragId: a.auftragId }, 1);
  auftragMelden(x.u.deps, s, ergebnis, x.u.uhr.ms);
};

const zeile = (x: U) =>
  x.u.db
    .select()
    .from(abwicklungen)
    .all()
    .find((a) => a.installationId === x.id);
const praefix = (x: U) => `${BUCKET}/b1/${x.id}/`;
const objekteDa = (x: U) => [...minio.objekte.keys()].filter((k) => k.startsWith(praefix(x)));
const deps = (x: U) => ({ ...x.u.deps, fetch });

/** Archive made: the agent's backup and upload, as the real agent leaves them in the bucket */
const archiviert = async (x: U) => {
  x.takt(x.ende);
  await abwicklungRunde(deps(x));
  melden(x, BACKUP_AKTIONEN.jetzt, true);
  minio.objekte.set(`${praefix(x)}data/ab`, new TextEncoder().encode("restic"));
  minio.objekte.set(`${praefix(x)}archiv/volume-daten.tar`, new TextEncoder().encode("tar"));
  const objekte = [{ tag: "volume:daten", datei: "volume-daten.tar", bytes: 3 }];
  melden(x, ABWICKLUNG_AKTIONEN.archiv, true, { installation: x.id, objekte });
  await abwicklungRunde(deps(x));
};

describe("after a contract's end", () => {
  it("does nothing before the end, then backs up and archives for the customer", async () => {
    const x = await umgebung();
    x.takt(x.ende - 1);
    await abwicklungRunde(deps(x));
    expect(zeile(x)).toBeUndefined();
    expect(x.u.auftrag(x.id, ABWICKLUNG_AKTIONEN.archiv)).toBeUndefined();
    await archiviert(x);
    expect(zeile(x)).toMatchObject({ schritt: "warten", vertragsende: x.ende });
    const archiv = x.u.auftrag(x.id, ABWICKLUNG_AKTIONEN.archiv);
    expect(JSON.parse(archiv?.argumente ?? "{}")).toEqual({ region: minio.region });
  });

  it("makes a link that works until its time and is refused after it", async () => {
    const x = await umgebung();
    await archiviert(x);
    x.takt(x.ende + 3600_000);
    const k = { ...x.u.kontext("b1"), grund: "Kunde bat um seine Daten" };
    const r = await archivLink(x.u.deps, k, x.id);
    if (!r.ok) throw new Error(r.grund);
    expect(r.gueltigBis).toBe(x.ende + 3600_000 + 7 * 24 * 3600_000);
    const url = r.links[0]?.url ?? "";
    expect(await (await fetch(url)).text()).toBe("tar");
    x.takt(r.gueltigBis + 1000);
    const spaet = await fetch(url);
    expect(spaet.status).toBe(403);
    expect(await spaet.text()).toContain("Request has expired");
    // the link is nowhere but in the answer
    const log = JSON.stringify(x.u.db.select().from(auditLog).all());
    expect(log).not.toContain("X-Amz-Signature");
    expect(log).toContain("Kunde bat um seine Daten");
    x.takt(x.nurLesenBis);
    expect(await archivLink(x.u.deps, x.u.kontext("b1"), x.id)).toMatchObject({
      ok: false,
      grund: "frist_abgelaufen",
    });
  });

  it("deletes nothing before 90 days, then installation, repository, access and DNS records", async () => {
    const x = await umgebung();
    await archiviert(x);
    expect(cf.eintraege().filter((e) => e.name === x.host).length).toBeGreaterThan(0);
    x.takt(x.loeschenAb - 1);
    await abwicklungRunde(deps(x));
    expect(x.u.auftrag(x.id, ABWICKLUNG_AKTIONEN.loeschen)).toBeUndefined();
    expect(objekteDa(x).length).toBe(2);
    expect(minio.konten().length).toBeGreaterThan(0);

    x.takt(x.loeschenAb);
    await abwicklungRunde(deps(x));
    const backup = x.u.auftrag(x.id, BACKUP_AKTIONEN.jetzt);
    const loeschen = x.u.auftrag(x.id, ABWICKLUNG_AKTIONEN.loeschen);
    expect(JSON.parse(loeschen?.wartetAuf ?? "[]")).toEqual([backup?.auftragId]);
    melden(x, BACKUP_AKTIONEN.jetzt, true);
    melden(x, ABWICKLUNG_AKTIONEN.loeschen, true, { installation: x.id, geaendert: "geloescht" });
    const inst = () =>
      x.u.db
        .select()
        .from(installationen)
        .all()
        .find((i) => i.installationId === x.id);
    expect(inst()).toMatchObject({ zustand: "entfernt", dns: "loeschen" });

    await abwicklungRunde(deps(x));
    expect(zeile(x)?.schritt).toBe("repository");
    await abwicklungRunde(deps(x));
    expect(objekteDa(x)).toEqual([]);
    await backupAbgleichen(x.u.deps);
    await dnsAbgleichen(x.dns);
    await abwicklungRunde(deps(x));
    await abwicklungRunde(deps(x));

    expect(zeile(x)).toMatchObject({ schritt: "geloescht", geloeschtAm: x.loeschenAb });
    expect(cf.eintraege().filter((e) => e.name === x.host)).toEqual([]);
    expect(minio.konten().filter((k) => k.name === `sz-${x.id}`)).toEqual([]);
    expect(x.u.db.select().from(backupZugaenge).all()).toEqual([]);
    const e = x.u.db
      .select()
      .from(ereignisse)
      .all()
      .find((r) => r.art === GELOESCHT_ART);
    expect(e?.text).toContain(`Löschprotokoll ${x.id}`);
    expect(e?.text).toContain("2 Objekte gelöscht");
    expect(e?.text).toContain("DNS-Einträge gelöscht");
  });

  it("sends the deletion log to a webhook recipient", async () => {
    const x = await umgebung();
    schreiben(x.u.schreibDb, x.u.kontext("b1"), "test", (w) =>
      w.einfuegen("empfaenger", {
        betreiberId: "b1",
        empfaengerId: "e1",
        art: "webhook",
        anzeige: "portal.example.de",
        abSchwere: "warn",
        geheim: "x",
        angelegtAm: x.u.uhr.ms,
      }),
    );
    await archiviert(x);
    x.takt(x.loeschenAb);
    await abwicklungRunde(deps(x));
    melden(x, BACKUP_AKTIONEN.jetzt, true);
    melden(x, ABWICKLUNG_AKTIONEN.loeschen, true);
    for (let i = 0; i < 5; i++) {
      await abwicklungRunde(deps(x));
      await backupAbgleichen(x.u.deps);
      await dnsAbgleichen(x.dns);
    }
    expect(zeile(x)?.schritt).toBe("geloescht");
    zustellungenAnlegen(x.u.db, x.u.schreibDb, x.u.uhr.ms);
    const e = x.u.db
      .select()
      .from(ereignisse)
      .all()
      .find((r) => r.art === GELOESCHT_ART);
    expect(x.u.db.select().from(zustellungen).all()).toContainEqual(
      expect.objectContaining({ ereignisId: e?.ereignisId, empfaengerId: "e1" }),
    );
  });

  it("deletes nothing when the backup before it fails, and tries again later", async () => {
    const x = await umgebung();
    await archiviert(x);
    x.takt(x.loeschenAb);
    await abwicklungRunde(deps(x));
    melden(x, BACKUP_AKTIONEN.jetzt, false);
    expect(x.u.auftrag(x.id, ABWICKLUNG_AKTIONEN.loeschen)?.zustand).toBe("abgebrochen");
    await abwicklungRunde(deps(x));
    expect(zeile(x)).toMatchObject({ schritt: "warten", versuche: 1 });
    expect(objekteDa(x).length).toBe(2);
    expect(
      x.u.db
        .select()
        .from(ereignisse)
        .all()
        .map((r) => r.art),
    ).toContain("loeschung_gescheitert");
  });

  it("drops what followed the end when the notice is taken back, not once deletion began", async () => {
    const x = await umgebung();
    await archiviert(x);
    expect(vertragsendeSetzen(x.u.db, x.u.schreibDb, x.u.kontext("b1"), "k1", null).ok).toBe(true);
    expect(zeile(x)).toBeUndefined();
    const y = await umgebung();
    await archiviert(y);
    y.takt(y.loeschenAb);
    await abwicklungRunde(deps(y));
    expect(vertragsendeSetzen(y.u.db, y.u.schreibDb, y.u.kontext("b1"), "k1", null)).toEqual({
      ok: false,
      grund: "loeschung_laeuft",
    });
  });
});
