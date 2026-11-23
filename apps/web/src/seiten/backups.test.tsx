import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BackupQuelle, backupQuelleEinsetzen } from "../daten/backups.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoBackups } from "../demo/backups.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-601, Z-602, Z-603: the page "Backups", the settings' tab with the S3 target, "Backup
// jetzt", the newest test restore, "Prüf-Restore jetzt" and restoring a run on an installation's
// page, against the demo sources, which answer as the API does
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

let gesendet: { id: string; grund: string; was?: string; lauf?: string }[] = [];

beforeEach(() => {
  setLocale("de", { reload: false });
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  kundenQuelleEinsetzen(kunden);
  serverQuelleEinsetzen(server);
  installationenQuelleEinsetzen(
    demoInstallationenQuelle({
      jetzt: () => demo.jetzt,
      kunden: kunden.liste,
      server: server.liste,
      manifest: demoAppsQuelle(() => demo.jetzt).manifest,
      betreiberWerte: [],
    }),
  );
  gesendet = [];
  const q = demoBackups();
  const mitProtokoll: BackupQuelle = {
    ...q,
    jetzt: (id, grund) => {
      gesendet.push({ id, grund });
      return q.jetzt(id, grund);
    },
    pruefRestore: (id, grund) => {
      gesendet.push({ id, grund, was: "pruef" });
      return q.pruefRestore(id, grund);
    },
    wiederherstellen: (id, lauf, grund) => {
      gesendet.push({ id, grund, was: "wiederherstellen", lauf });
      return q.wiederherstellen(id, lauf, grund);
    },
  };
  backupQuelleEinsetzen(mitProtokoll);
  rolle("technik");
});
afterEach(aufraeumen);

const karte = (root: HTMLElement, titel: string) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titel,
  );
  if (!k) throw new Error(`no card "${titel}"`);
  return k;
};

describe("the page Backups", () => {
  it("shows each installation's parts and last run, a failed one with its reason", async () => {
    const { root } = await oeffne("/backups");
    await warten();
    const text = root.textContent ?? "";
    expect(text).toContain("pg_dump db, volume belege");
    expect(text).toContain("gescheitert: Backup älter als 26 h");
  });

  it("shows each installation's newest test restore, a failed one with its reason", async () => {
    const { root } = await oeffne("/backups");
    await warten();
    const text = root.textContent ?? "";
    expect(text).toContain("Prüf-Restore gelungen");
    expect(text).toContain("gescheitert: Health der Kopie blieb rot");
    const zeile = [...root.querySelectorAll("tr")].find((r) =>
      r.querySelector('a[href="/installationen/atelier-haben"]'),
    );
    expect(zeile?.textContent).toContain(", gelungen");
  });
});

describe("the S3 target", () => {
  it("is saved with a reason; the admin access shows only as set and its fields stay empty", async () => {
    backupQuelleEinsetzen(
      demoBackups(demo, { endpunkt: null, region: null, bucket: null, zugangGesetzt: false }),
    );
    const { root } = await oeffne("/einstellungen?tab=backup");
    await warten();
    const k = karte(root, "Backup");
    expect(feld<HTMLInputElement>("Secret Key des Admins", k).required).toBe(true);
    eintragen("Endpunkt", "https://s3.example.de", k);
    eintragen("Bucket", "sz-backups", k);
    eintragen("Access Key des Admins", "admin", k);
    eintragen("Secret Key des Admins", "minio-geheim-123", k);
    eintragen("Grund", "MinIO eingerichtet", k);
    flush();
    k.querySelector("form")?.requestSubmit();
    await warten();
    const neu = karte(root, "Backup");
    expect(neu.textContent).toContain("Backup-Ziel gespeichert.");
    expect(feld<HTMLInputElement>("Bucket", neu).value).toBe("sz-backups");
    expect(feld<HTMLInputElement>("Secret Key des Admins", neu).value).toBe("");
    expect(neu.textContent).toContain("gesetzt; beide leer lassen behält den Zugang");
    expect(root.textContent).not.toContain("minio-geheim-123");
  });

  it("is only read by support", async () => {
    rolle("support");
    const { root } = await oeffne("/einstellungen?tab=backup");
    await warten();
    const k = karte(root, "Backup");
    expect(k.querySelector("form")).toBeNull();
    expect(k.textContent).toContain("https://s3.example.net");
    expect(k.textContent).toContain("gesetzt");
  });
});

describe("Backup jetzt", () => {
  it("asks for a reason and makes the job", async () => {
    const { root } = await oeffne("/installationen/atelier-haben");
    await warten();
    knopf(root, "Backup jetzt")?.click();
    await warten();
    eintragen("Grund", "vor dem Update");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(gesendet).toEqual([{ id: "atelier-haben", grund: "vor dem Update" }]);
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Backup angefordert");
  });

  it("is not offered to support", async () => {
    rolle("support");
    const { root } = await oeffne("/installationen/atelier-haben");
    await warten();
    expect(knopf(root, "Backup jetzt")).toBeUndefined();
    expect(knopf(root, "Prüf-Restore jetzt")).toBeUndefined();
  });
});

describe("Prüf-Restore jetzt", () => {
  it("asks for a reason and makes the job", async () => {
    const { root } = await oeffne("/installationen/atelier-haben");
    await warten();
    knopf(root, "Prüf-Restore jetzt")?.click();
    await warten();
    expect(dialog().textContent).toContain("die Installation läuft unverändert weiter");
    eintragen("Grund", "nach dem Wechsel des Buckets");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(gesendet).toEqual([
      { id: "atelier-haben", grund: "nach dem Wechsel des Buckets", was: "pruef" },
    ]);
    expect(root.textContent).toContain("Prüf-Restore angefordert");
  });

  const reiterBackups = async (id: string) => {
    const { root } = await oeffne(`/installationen/${id}`);
    await warten();
    [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent?.trim() === "Backups")
      ?.click();
    await warten();
    return root.textContent ?? "";
  };

  it("shows a failed one on the tab Backups with its reason", async () => {
    expect(await reiterBackups("holm-belegt")).toContain("gescheitert: Health der Kopie blieb rot");
  });

  it("shows a good one on the tab Backups, with what it restored", async () => {
    const text = await reiterBackups("atelier-haben");
    expect(text).toContain("Zurückgespielt");
    expect(text).toMatch(/pg_dump:db:haben: [0-9a-f]{8}/);
    expect(text).toMatch(/Dauer\d+ s/);
  });
});

describe("restoring a run", () => {
  const reiter = async (id: string) => {
    const { root } = await oeffne(`/installationen/${id}`);
    await warten();
    [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent?.trim() === "Backups")
      ?.click();
    await warten();
    return root;
  };
  const wiederherstellenKnoepfe = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
      /^Lauf vom .+ wiederherstellen$/.test(b.getAttribute("aria-label") ?? ""),
    );

  it("asks for a reason, says the current state is backed up first, then shows the restore", async () => {
    const root = await reiter("atelier-haben");
    const knoepfe = wiederherstellenKnoepfe(root);
    expect(knoepfe).toHaveLength(5);
    knoepfe[1]?.click();
    await warten();
    expect(dialog().textContent).toContain("Lauf wiederherstellen?");
    expect(dialog().querySelector('[role="note"]')?.textContent).toContain(
      "Vorher wird der Ist-Zustand gesichert",
    );
    eintragen("Grund", "Auftrag des Kunden vom 20.11.");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(gesendet).toEqual([
      {
        id: "atelier-haben",
        grund: "Auftrag des Kunden vom 20.11.",
        was: "wiederherstellen",
        lauf: expect.stringMatching(/^backup-[0-9a-f]{32}$/),
      },
    ]);
    expect(document.querySelector("dialog[open]")).toBeNull();
    const text = root.textContent ?? "";
    expect(text).toContain("Wiederherstellen angefordert; zuerst wird der Ist-Zustand gesichert.");
    expect(text).toContain("läuft: Backup vom Ist-Zustand, dann Stand");
    // one restore at a time: no button while it is under way
    expect(wiederherstellenKnoepfe(root)).toEqual([]);
  });

  it("offers no failed run", async () => {
    const root = await reiter("lind-haben");
    // the newest of its five runs failed
    expect(wiederherstellenKnoepfe(root)).toHaveLength(4);
  });

  it("is not offered to support", async () => {
    rolle("support");
    const root = await reiter("atelier-haben");
    expect(wiederherstellenKnoepfe(root)).toEqual([]);
    expect(root.textContent).not.toContain("Wiederherstellen");
  });
});
