import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { benachrichtigungsQuelleEinsetzen } from "../daten/benachrichtigungen.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoBenachrichtigungen, demoStart } from "../demo/benachrichtigungen.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

/*
 * BAULISTE.md Z-703: the settings' tab "Benachrichtigungen" against the demo source, which answers
 * as the Zentrale's API: the owner sets mail server and quiet hours with a reason, adds a
 * webhook whose key is made in the browser and shown only before saving, sends a test and removes a
 * recipient with a reason; a member only reads. No password or key shows after saving.
 */
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  benachrichtigungsQuelleEinsetzen(demoBenachrichtigungen());
  rolle("inhaber");
});
afterEach(aufraeumen);

const karte = (root: HTMLElement, titel: string) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titel,
  );
  if (!k) throw new Error(`no card "${titel}"`);
  return k;
};

const tab = async () => {
  const { root } = await oeffne("/einstellungen?tab=melden");
  return root;
};

describe("mail server and quiet hours", () => {
  it("are saved with a reason; the password shows only as set and its field stays empty", async () => {
    const root = await tab();
    const k = karte(root, "Benachrichtigungen");
    expect(feld<HTMLInputElement>("SMTP-Server", k).value).toBe("smtp.beispiel-hosting.de");
    expect(feld<HTMLInputElement>("Ruhezeit von", k).value).toBe("22:00");
    expect(k.textContent).toContain("gesetzt; leer lassen behält das Passwort");
    eintragen("SMTP-Server", "mail.example.de", k);
    eintragen("Passwort", "neues-passwort-4711", k);
    eintragen("Ruhezeit von", "", k);
    eintragen("Ruhezeit bis", "", k);
    eintragen("Grund", "neuer Mailserver", k);
    flush();
    k.querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Benachrichtigungen gespeichert.");
    const neu = karte(root, "Benachrichtigungen");
    expect(feld<HTMLInputElement>("SMTP-Server", neu).value).toBe("mail.example.de");
    expect(feld<HTMLInputElement>("Passwort", neu).value).toBe("");
    expect(feld<HTMLInputElement>("Ruhezeit von", neu).value).toBe("");
    expect(root.textContent).not.toContain("neues-passwort-4711");
  });

  it("are only read by a member, without any form or button that changes", async () => {
    rolle("mitglied");
    const root = await tab();
    const k = karte(root, "Benachrichtigungen");
    expect(k.querySelector("form")).toBeNull();
    expect(k.textContent).toContain("smtp.beispiel-hosting.de:587");
    expect(k.textContent).toContain("22:00–07:00, nur Störungen");
    expect(knopf(root, "Empfänger hinzufügen")).toBeUndefined();
    expect(knopf(root, "Test senden")).toBeUndefined();
  });
});

describe("recipients", () => {
  it("list address or a webhook's host, threshold and the newest deliveries", async () => {
    const root = await tab();
    const liste = karte(root, "Empfänger");
    expect(liste.textContent).toContain("betrieb@beispiel-hosting.de");
    expect(liste.textContent).toContain("https://chat.example");
    expect(liste.textContent).toContain("Warnung");
    const zustellungen = karte(root, "Letzte Zustellungen");
    expect(zustellungen.textContent).toContain("Störung atelier-haben");
    expect(zustellungen.textContent).toContain("webhook HTTP 503");
    expect(zustellungen.textContent).toContain("zugestellt");
  });

  it("get a webhook with a key made here, shown before saving and never after", async () => {
    const root = await tab();
    knopf(root, "Empfänger hinzufügen")?.click();
    await warten();
    const art = feld<HTMLSelectElement>("Art");
    art.value = "webhook";
    art.dispatchEvent(new Event("change", { bubbles: true }));
    await warten();
    const schluessel = feld<HTMLInputElement>("Signierschlüssel").value;
    expect(schluessel).toMatch(/^[A-Za-z0-9_-]{43}$/);
    knopf(dialog(), "Neuen Schlüssel erzeugen")?.click();
    await warten();
    expect(feld<HTMLInputElement>("Signierschlüssel").value).not.toBe(schluessel);
    eintragen("URL des Webhooks", "https://hooks.portal.example/zentrale/geheim");
    eintragen("Grund", "Portal");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Empfänger hinzugefügt.");
    expect(karte(root, "Empfänger").textContent).toContain("https://hooks.portal.example");
    expect(root.textContent).not.toContain("/zentrale/geheim");
  });

  it("get a ntfy topic without a reason, its token never shown after (Z-1105)", async () => {
    const root = await tab();
    expect(karte(root, "Empfänger").textContent).toContain("ntfy (Handy)");
    knopf(root, "Empfänger hinzufügen")?.click();
    await warten();
    const art = feld<HTMLSelectElement>("Art");
    art.value = "ntfy";
    art.dispatchEvent(new Event("change", { bubbles: true }));
    await warten();
    expect(dialog().textContent).not.toContain("Grund");
    eintragen("Adresse des Themas", "https://ntfy.sh/sz-geheimes-thema");
    eintragen("Zugriffstoken", "tk_geheim0123");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).not.toContain("sz-geheimes-thema");
    expect(root.textContent).not.toContain("tk_geheim0123");
  });

  it("get a test message and are removed with a reason", async () => {
    const root = await tab();
    const test = root.querySelector<HTMLButtonElement>(
      '[aria-label="Test senden an betrieb@beispiel-hosting.de"]',
    );
    test?.click();
    await warten();
    expect(root.textContent).toContain("Testnachricht an betrieb@beispiel-hosting.de zugestellt.");
    root
      .querySelector<HTMLButtonElement>('[aria-label="betrieb@beispiel-hosting.de entfernen"]')
      ?.click();
    await warten();
    expect(dialog().textContent).toContain(
      "betrieb@beispiel-hosting.de bekommt keine Nachrichten mehr",
    );
    eintragen("Grund", "Postfach aufgelöst");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Empfänger entfernt.");
    const tabelle = root.querySelector('section[aria-label="Empfänger"]');
    expect(tabelle?.textContent).toContain("https://chat.example");
    expect(tabelle?.textContent).not.toContain("betrieb@beispiel-hosting.de");
  });

  it("say when there are none yet", async () => {
    benachrichtigungsQuelleEinsetzen(
      demoBenachrichtigungen({ ...demoStart(), smtp: null, empfaenger: [], zustellungen: [] }),
    );
    rolle("mitglied");
    const root = await tab();
    expect(root.textContent).toContain("keiner, nur Webhooks");
    expect(root.textContent).toContain("Noch keine Empfänger.");
    expect(root.textContent).toContain("Noch keine Zustellungen.");
  });
});
