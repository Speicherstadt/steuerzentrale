import { BACKUP_AKTIONEN, EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, backupZugaenge, ereignisse } from "../../db/schema.ts";
import { BUCKET, backupUmgebung } from "../../testhilfen/backups.ts";
import { dateiInhalt, signiert } from "../../testhilfen/installationen.ts";
import { minioNachbau, TEST_ADMIN } from "../../testhilfen/minio.ts";
import { schreiben } from "../audit/index.ts";
import { auftragAnlegen } from "../auftraege/anlegen.ts";
import { installationEntfernen } from "../installationen/entfernen.ts";
import { backupAbgleichen, backupSchleife } from "./abgleich.ts";
import { zugangLesen } from "./zugaenge.ts";

/*
 * BAULISTE.md Z-601 against the stand-in of MinIO's admin API (testhilfen/minio.ts): an installation
 * whose setup succeeded gets its own service account, limited by policy to its prefix, and then the
 * job `installation_backup_einrichten` with repository, access and restic password; an account
 * that failed is tried again with backoff and makes `backup_fehler`; a removed installation's
 * account is deleted. Admin access, S3 secret and restic password stand nowhere but encrypted in
 * the database, in the request to MinIO (signed, the body encrypted) and in the job to the
 * installation's own server.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

type U = ReturnType<typeof backupUmgebung>;

const zugang = (u: U, id: string) => zugangLesen(u.db, "b1", id);
const konto = (id: string) => minio.konten().find((k) => k.name === `sz-${id}`);

/** The job `installation_backup_einrichten` as the agent got it */
const bekommen = (u: U, id: string) =>
  u.agent.find(
    (n) =>
      n.typ === "auftrag" && n.aktion === BACKUP_AKTIONEN.einrichten && n.installationId === id,
  ) as { backup: { repository: string; zugang: Record<string, string>; passwort: string } };

describe("an installation's own S3 access", () => {
  it("is made after its setup, limited to its prefix, and its job carries repository and password", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const id = u.laufend();
    expect(zugang(u, id)).toMatchObject({ zustand: "anlegen", versuche: 0 });
    expect(await backupAbgleichen(u.deps)).toBe(1);
    expect(zugang(u, id)).toMatchObject({ zustand: "angelegt", naechsterVersuch: null });
    const k = konto(id);
    expect(k?.policy).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: [`arn:aws:s3:::${BUCKET}`],
          Condition: { StringLike: { "s3:prefix": [`b1/${id}/`, `b1/${id}/*`] } },
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: [`arn:aws:s3:::${BUCKET}/b1/${id}/*`],
        },
      ],
    });
    const job = u.auftrag(id, BACKUP_AKTIONEN.einrichten);
    expect(job).toMatchObject({ serverId: "s1", argumente: "{}", zustand: "zugestellt" });
    const { backup } = bekommen(u, id);
    expect(backup.repository).toBe(`s3:${minio.url}/${BUCKET}/b1/${id}`);
    expect(backup.zugang).toEqual({ schluesselId: k?.accessKey, geheim: k?.secretKey });
    expect(backup.passwort).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(await backupAbgleichen(u.deps)).toBe(0);
  });

  it("is not made for a manifest that names nothing to back up", () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const id = u.laufend("probe");
    expect(zugang(u, id)).toBeUndefined();
  });

  it("waits for an S3 target, with an event, and is made once one is set", async () => {
    const u = backupUmgebung(minio);
    const id = u.laufend();
    const vorher = minio.anfragen.length;
    await backupAbgleichen(u.deps);
    expect(minio.anfragen.length).toBe(vorher);
    expect(zugang(u, id)).toMatchObject({ zustand: "anlegen", versuche: 1 });
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: "backup_fehler",
        schwere: "warn",
        ziel: `installation:${id}`,
        text: expect.stringContaining("no S3 target set"),
      }),
    ]);
    u.zielSetzen();
    expect(zugang(u, id)?.naechsterVersuch).toBe(u.uhr.ms);
    await backupAbgleichen(u.deps);
    expect(zugang(u, id)?.zustand).toBe("angelegt");
  });

  it("is tried again after a failure of MinIO, deleting a half-made one first", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const id = u.laufend();
    minio.scheitern(1);
    await backupAbgleichen(u.deps);
    expect(zugang(u, id)).toMatchObject({
      zustand: "anlegen",
      versuche: 1,
      naechsterVersuch: u.uhr.ms + 60_000,
    });
    const fehler = u.db.select().from(ereignisse).all();
    expect(fehler).toHaveLength(1);
    expect(fehler[0]?.text).toContain("HTTP 500 InternalError");
    expect(await backupAbgleichen(u.deps)).toBe(0);
    u.uhr.ms += 60_000;
    const ab = minio.anfragen.length;
    await backupAbgleichen(u.deps);
    expect(minio.anfragen.slice(ab).map((a) => `${a.methode} ${a.pfad.split("?")[0]}`)).toEqual([
      "DELETE /minio/admin/v3/delete-service-account",
      "PUT /minio/admin/v3/add-service-account",
    ]);
    expect(zugang(u, id)).toMatchObject({ zustand: "angelegt", versuche: 0 });
    expect(u.auftrag(id, BACKUP_AKTIONEN.einrichten)).toBeDefined();
  });

  it("is refused by MinIO with a wrong admin access, and nothing is sent to the agent", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen("b1", { accessKey: TEST_ADMIN.accessKey, secretKey: "falsch-falsch-falsch" });
    const id = u.laufend();
    await backupAbgleichen(u.deps);
    expect(zugang(u, id)?.versuche).toBe(1);
    expect(u.db.select().from(ereignisse).all()[0]?.text).toContain("SignatureDoesNotMatch");
    expect(u.auftrag(id, BACKUP_AKTIONEN.einrichten)).toBeUndefined();
  });

  it("is deleted once the installation is removed", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const id = u.laufend();
    await backupAbgleichen(u.deps);
    expect(konto(id)).toBeDefined();
    // a running installation is removed only with Z-604; here its state is set back by hand
    schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
      w.aendern("installationen", { installationId: id }, { zustand: "gescheitert" }),
    );
    const entfernt = installationEntfernen(u.deps, u.kontext("b1"), id);
    if (!entfernt.ok) throw new Error(entfernt.grund);
    expect(zugang(u, id)?.zustand).toBe("angelegt");
    u.melden(entfernt.auftrag.auftragId, true);
    expect(zugang(u, id)).toMatchObject({ zustand: "loeschen", naechsterVersuch: u.uhr.ms });
    await backupAbgleichen(u.deps);
    expect(konto(id)).toBeUndefined();
    expect(zugang(u, id)?.zustand).toBe("geloescht");
  });

  it("is checked every 30 s and at once when a setup ended", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const geplant: number[] = [];
    const schleife = backupSchleife(u.deps, (_lauf, ms) => geplant.push(ms));
    expect(geplant).toEqual([30_000]);
    u.deps.backupAnstossen = schleife.anstossen;
    const id = u.laufend();
    await expect.poll(() => zugang(u, id)?.zustand).toBe("angelegt");
  });
});

/** A second server `s2` of the operator, with facts and its agent connected; what it gets */
const zweiterServer = (u: U) => {
  schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
    w.einfuegen("server", {
      betreiberId: "b1",
      serverId: "s2",
      name: "s2",
      wartungsfenster: JSON.stringify({ tage: [0], von: "03:00", bis: "04:00" }),
      angelegtVon: "nutzer-1",
      angelegtAm: u.uhr.ms,
    }),
  );
  u.fakten("b1", "s2");
  return u.verbinden("b1", "s2");
};

const passwortIn = (agent: Record<string, unknown>[], id: string) =>
  (
    agent.find((n) => n.aktion === BACKUP_AKTIONEN.einrichten && n.installationId === id) as
      | { backup: { passwort: string } }
      | undefined
  )?.backup.passwort;

describe("a server", () => {
  it("gets only the access and password of its own installations", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const zweiter = zweiterServer(u);
    const hier = u.laufend();
    const dort = u.laufend("gesichert", { serverId: "s2" });
    await backupAbgleichen(u.deps);
    const p1 = passwortIn(u.agent, hier);
    const p2 = passwortIn(zweiter, dort);
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(JSON.stringify(zweiter)).not.toContain(p1 as string);
    expect(JSON.stringify(u.agent)).not.toContain(p2 as string);
  });

  it("never gets another server's installation's password, even in a job addressed to it", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const zweiter = zweiterServer(u);
    const hier = u.laufend();
    await backupAbgleichen(u.deps);
    const p1 = passwortIn(u.agent, hier) as string;
    const angelegt = auftragAnlegen(u.deps, u.kontext("b1"), {
      serverId: "s2",
      installationId: hier,
      aktion: BACKUP_AKTIONEN.einrichten,
      argumente: {},
      ...signiert("gesichert"),
      backup: {
        repository: "s3:https://s3.example.de/backups/fremd",
        zugang: { schluesselId: "fremd", geheim: "fremd-geheim" },
        passwort: "p".repeat(20),
      },
    });
    expect(angelegt.ok).toBe(true);
    expect(zweiter.filter((n) => n.typ === "auftrag")).toEqual([]);
    expect(JSON.stringify(zweiter)).not.toContain(p1);
    expect(u.log.join("\n")).toContain(`does not stand on server s2`);
  });
});

describe("the admin access, the S3 secret and the restic password", () => {
  it("stand only encrypted in the database and in no log, event, audit entry or other message", async () => {
    const u = backupUmgebung(minio);
    u.zielSetzen();
    const id = u.laufend();
    minio.scheitern(1);
    await backupAbgleichen(u.deps);
    u.uhr.ms += 60_000;
    await backupAbgleichen(u.deps);
    const job = bekommen(u, id);
    const geheim = [TEST_ADMIN.secretKey, job.backup.zugang.geheim ?? "", job.backup.passwort];
    const zeile = u.db.select().from(backupZugaenge).all()[0];
    expect(zeile?.geheim).toMatch(/^v\d+\.[0-9a-f]{8}\./);
    const anderswo = [
      u.log.join("\n"),
      JSON.stringify(u.db.select().from(ereignisse).all()),
      JSON.stringify(u.db.select().from(auditLog).all()),
      dateiInhalt(u.pfad),
      ...minio.anfragen.map((a) => `${a.pfad} ${a.autorisierung} ${a.body}`),
      JSON.stringify(u.agent.filter((n) => n.aktion !== BACKUP_AKTIONEN.einrichten)),
    ].join("\n");
    for (const g of geheim) expect(anderswo).not.toContain(g);
    expect(u.auftrag(id, EINRICHTUNG_AKTIONEN.einrichten)?.argumente).toBe("{}");
  });
});
