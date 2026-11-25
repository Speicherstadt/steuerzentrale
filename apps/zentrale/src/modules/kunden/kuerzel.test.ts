import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../../db/schema.ts";
import {
  installationsUmgebung,
  neueInstallation,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { auftragMelden } from "../auftraege/melden.ts";
import { installationAnlegen } from "../installationen/anlegen.ts";
import { type Ergebnis, kundeAendern, kundeAnlegen, kundeLesen } from "./kunden.ts";

/*
 * BAULISTE.md Z-407: a customer's short name is unique within its operator, suggested from its name
 * and fixed while an installation of the customer runs or is being set up (docs/plan.md, "Adresse
 * einer Installation").
 */

type U = ReturnType<typeof installationsUmgebung>;

const stamm = (name: string, kuerzel?: string) => ({
  name,
  kontakt: { name: "Kim", email: "kim@kunde.test" },
  ...(kuerzel === undefined ? {} : { kuerzel }),
});

const anlegen = (u: U, betreiberId: string, name: string, kuerzel?: string): Ergebnis =>
  kundeAnlegen(u.db, u.schreibDb, u.kontext(betreiberId), {
    ...stamm(name, kuerzel),
    vertrag: { beginn: 0 },
  });

const id = (e: Ergebnis) => {
  if (!e.ok) throw new Error(e.grund);
  return e.kunde.id;
};

const aendern = (u: U, kundeId: string, kuerzel: string) =>
  kundeAendern(u.db, u.schreibDb, u.kontext("b1"), kundeId, {
    ...stamm(kundeLesen(u.db, "b1", kundeId)?.name ?? "", kuerzel),
    beginn: 0,
  });

/** An installation of the customer, its setup job ended as `ende` says (or still open) */
const installation = (u: U, kundeId: string, ende?: boolean) => {
  const a = installationAnlegen(
    u.deps,
    u.kontext("b1"),
    TEST_SCHLUESSEL,
    neueInstallation({ kundeId }),
  );
  if (!a.ok) throw new Error(a.grund);
  if (ende === undefined) return;
  const job = u.db
    .select()
    .from(auftraege)
    .all()
    .find(
      (x) =>
        x.aktion === EINRICHTUNG_AKTIONEN.einrichten &&
        x.installationId === a.installation.installationId,
    );
  const server = { betreiberId: "b1", serverId: "s1" } as Parameters<typeof auftragMelden>[1];
  const auftragId = job?.auftragId ?? "";
  auftragMelden(u.deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
  auftragMelden(
    u.deps,
    server,
    {
      typ: "ergebnis",
      protokoll: 1,
      auftragId,
      zeit: 1,
      ergebnis: ende ? { ok: true, daten: {} } : { ok: false, fehler: "exit 1" },
    },
    u.uhr.ms,
  );
};

describe("a customer's short name", () => {
  it("is suggested from the name and made unique within the operator", () => {
    const u = installationsUmgebung();
    u.betreiber("b1");
    u.betreiber("b2");
    const erster = anlegen(u, "b1", "Kanzlei West");
    const zweiter = anlegen(u, "b1", "Kanzlei West");
    const anderer = anlegen(u, "b2", "Kanzlei West");
    expect(erster.ok && erster.kunde.kuerzel).toBe("kanzlei-west");
    expect(zweiter.ok && zweiter.kunde.kuerzel).toBe("kanzlei-west-2");
    expect(anderer.ok && anderer.kunde.kuerzel).toBe("kanzlei-west");
  });

  it("is refused when another customer of the operator has it", () => {
    const u = installationsUmgebung();
    u.betreiber("b1");
    u.betreiber("b2");
    const a = id(anlegen(u, "b1", "Atelier", "atelier"));
    const b = id(anlegen(u, "b1", "Büro", "buero"));
    expect(anlegen(u, "b1", "Noch ein Atelier", "atelier")).toEqual({
      ok: false,
      grund: "kuerzel_vergeben",
    });
    expect(aendern(u, b, "atelier")).toEqual({ ok: false, grund: "kuerzel_vergeben" });
    expect(anlegen(u, "b2", "Atelier beim Partner", "atelier").ok).toBe(true);
    expect(kundeLesen(u.db, "b1", a)?.kuerzel).toBe("atelier");
  });

  it("changes with a reason in the audit log while no installation holds it", () => {
    const u = installationsUmgebung();
    u.betreiber("b1");
    const k = id(anlegen(u, "b1", "Atelier", "atelier"));
    const geaendert = aendern(u, k, "atelier-nord");
    expect(geaendert).toMatchObject({ ok: true, kunde: { kuerzel: "atelier-nord" } });
    const eintrag = u.db.select().from(auditLog).all().at(-1);
    expect(eintrag?.aktion).toBe("kunde.aendern");
    expect(JSON.parse(eintrag?.inhalt ?? "{}")).toEqual({
      art: "aendern",
      werte: { kuerzel: "atelier-nord" },
    });
  });

  it("is fixed while an installation is being set up or runs", () => {
    const u = installationsUmgebung();
    u.bereit();
    const k = id(anlegen(u, "b1", "Atelier", "atelier"));
    installation(u, k);
    expect(kundeLesen(u.db, "b1", k)?.kuerzelAenderbar).toBe(false);
    expect(aendern(u, k, "atelier-neu")).toEqual({ ok: false, grund: "kuerzel_fest" });
    // the same short name is no change
    expect(aendern(u, k, "atelier").ok).toBe(true);

    const laeuft = installationsUmgebung();
    laeuft.bereit();
    const k2 = id(anlegen(laeuft, "b1", "Atelier", "atelier"));
    installation(laeuft, k2, true);
    expect(aendern(laeuft, k2, "atelier-neu")).toEqual({ ok: false, grund: "kuerzel_fest" });
    expect(kundeLesen(laeuft.db, "b1", k2)?.kuerzel).toBe("atelier");
  });

  it("is free again when the installation's setup failed", () => {
    const u = installationsUmgebung();
    u.bereit();
    const k = id(anlegen(u, "b1", "Atelier", "atelier"));
    installation(u, k, false);
    expect(kundeLesen(u.db, "b1", k)?.kuerzelAenderbar).toBe(true);
    expect(aendern(u, k, "atelier-neu").ok).toBe(true);
  });
});
