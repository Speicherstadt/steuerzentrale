import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BackupQuelle, backupQuelleEinsetzen } from "../daten/backups.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoBackups } from "../demo/backups.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-601: the page "Backups", the settings' tab with the S3 target and "Backup jetzt" on
// an installation's page, against the demo sources, which answer as the API does
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

let gesendet: { id: string; grund: string }[] = [];

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
    expect(text).toContain("Den wöchentlichen Prüf-Restore bringt Z-602.");
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
  });
});
