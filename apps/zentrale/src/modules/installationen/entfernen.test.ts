import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { oeffneDatenbank } from "../../db/oeffnen.ts";
import { auftraege, installationen, installationsPorts } from "../../db/schema.ts";
import { testSchluessel } from "../../db/test-db.ts";
import {
  installationsUmgebung,
  neueInstallation,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { rotieren } from "../geheim/rotieren.ts";
import { installationAnlegen } from "./anlegen.ts";
import { einrichtungFuer } from "./einrichtung.ts";
import { installationEntfernen } from "./entfernen.ts";

/*
 * BAULISTE.md Z-402: here only an installation whose setup failed is removed; one that was set up
 * keeps its data until Z-604 removes it after a backup.
 */

type U = ReturnType<typeof installationsUmgebung>;

const melden = (u: U, auftragId: string, ok: boolean) => {
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

const job = (u: U, aktion: string) =>
  u.db
    .select()
    .from(auftraege)
    .all()
    .filter((a) => a.aktion === aktion)
    .at(-1)?.auftragId ?? "";

/** An installation whose setup ended as `ok` says */
const eingerichtet = (ok: boolean) => {
  const u = installationsUmgebung();
  const agent = u.bereit();
  const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation());
  if (!a.ok) throw new Error(a.grund);
  melden(u, job(u, EINRICHTUNG_AKTIONEN.einrichten), ok);
  return { u, agent, id: a.installation.installationId };
};

const zustand = (u: U) => u.db.select().from(installationen).get()?.zustand;

describe("removing an installation", () => {
  it("is refused while it is set up and once it runs", () => {
    const u = installationsUmgebung();
    u.bereit();
    const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation());
    if (!a.ok) throw new Error(a.grund);
    const id = a.installation.installationId;
    expect(installationEntfernen(u.deps, u.kontext("b1"), id)).toEqual({
      ok: false,
      grund: "nicht_gescheitert",
    });
    melden(u, job(u, EINRICHTUNG_AKTIONEN.einrichten), true);
    expect(installationEntfernen(u.deps, u.kontext("b1"), id)).toEqual({
      ok: false,
      grund: "nicht_gescheitert",
    });
    expect(job(u, EINRICHTUNG_AKTIONEN.entfernen)).toBe("");
  });

  it("sends installation_entfernen for a failed one, which is removed with its ports once it succeeded", () => {
    const { u, agent, id } = eingerichtet(false);
    const entfernt = installationEntfernen(u.deps, u.kontext("b1"), id);
    expect(entfernt).toMatchObject({
      ok: true,
      auftrag: { aktion: EINRICHTUNG_AKTIONEN.entfernen, installationId: id, argumente: "{}" },
    });
    expect(agent.at(-1)).toMatchObject({ aktion: EINRICHTUNG_AKTIONEN.entfernen });
    expect(agent.at(-1)).not.toHaveProperty("einrichtung");
    expect(installationEntfernen(u.deps, u.kontext("b1"), id)).toMatchObject({
      grund: "entfernen_laeuft",
    });
    expect(zustand(u)).toBe("gescheitert");
    melden(u, job(u, EINRICHTUNG_AKTIONEN.entfernen), true);
    expect(zustand(u)).toBe("entfernt");
    expect(u.db.select().from(installationsPorts).all()).toEqual([]);
  });

  it("keeps a failed installation when removing it failed, so it can be tried again", () => {
    const { u, id } = eingerichtet(false);
    installationEntfernen(u.deps, u.kontext("b1"), id);
    melden(u, job(u, EINRICHTUNG_AKTIONEN.entfernen), false);
    expect(zustand(u)).toBe("gescheitert");
    expect(installationEntfernen(u.deps, u.kontext("b1"), id)).toMatchObject({ ok: true });
  });

  it("does not reach another operator's installation", () => {
    const { u, id } = eingerichtet(false);
    u.betreiber("b2");
    expect(installationEntfernen(u.deps, u.kontext("b2"), id)).toEqual({
      ok: false,
      grund: "keine_installation",
    });
  });
});

describe("the secrets of an installation", () => {
  it("are encrypted anew when the key is rotated, and only open in their own row", () => {
    const { u, id } = eingerichtet(true);
    const vorher = einrichtungFuer(u, "b1", id);
    u.schliessen();
    const neu = testSchluessel(9);
    const beide = oeffneDatenbank(u.pfad, 2, { aktuell: neu, alt: [u.schluessel.aktuell] });
    expect(rotieren(beide, 2)).toBeGreaterThanOrEqual(2);
    beide.schliessen();
    const nurNeu = oeffneDatenbank(u.pfad, 3, { aktuell: neu, alt: [] });
    expect(einrichtungFuer({ db: nurNeu.db, schluessel: nurNeu.schluessel }, "b1", id)).toEqual(
      vorher,
    );
    // the ciphertext copied into another row does not open there
    const zeile = nurNeu.db.select().from(installationen).get();
    nurNeu.sqlite.run(
      "INSERT INTO installationen SELECT betreiber_id, 'probe-kopie1', kunde_id, server_id, app, version, manifest_hash, manifest, signatur, 'kopie.kunde.example', ipv4, http_port, ports, optionen, einstellungen, geheim, zustand, angelegt_von, angelegt_am, geaendert_am, bewertung, bewertung_grund, bewertung_seit, gemeldet_am, meldung, dns, dns_versuche, dns_naechster_versuch FROM installationen",
    );
    expect(zeile?.geheim.startsWith(`v1.${neu.id}.`)).toBe(true);
    expect(
      einrichtungFuer({ db: nurNeu.db, schluessel: nurNeu.schluessel }, "b1", "probe-kopie1"),
    ).toMatchObject({ ok: false });
    nurNeu.schliessen();
  });
});
