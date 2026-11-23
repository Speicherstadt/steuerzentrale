import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1, VON_DER_ZENTRALE_V1 } from "./beispiele-v1.ts";
import { vomAgentenLesen, vonDerZentraleLesen } from "./lesen.ts";

/*
 * BAULISTE.md Z-601 in protocol 1, additive: the field `backup` of a job (repository, S3 access and
 * restic password of one installation, only with `installation_backup_einrichten`) and the message
 * `backup_stand`, one run of the backup on the server. Both bounded, a snapshot only as restic's ID.
 */

const STAND = VOM_AGENTEN_V1.find((n) => n.typ === "backup_stand") ?? {};
const MIT_BACKUP = VON_DER_ZENTRALE_V1.find((n) => n.typ === "auftrag" && "backup" in n) ?? {};

const fehlerVon = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("a job with backup", () => {
  it("has a frozen example", () => {
    expect(MIT_BACKUP).toMatchObject({ aktion: "installation_backup_einrichten" });
    expect(vonDerZentraleLesen(JSON.stringify(MIT_BACKUP))).toMatchObject({ ok: true });
  });

  it("refuses a backup without password or access", () => {
    const { passwort: _p, ...ohnePasswort } = (MIT_BACKUP as { backup: Record<string, unknown> })
      .backup;
    const { zugang: _z, ...ohneZugang } = (MIT_BACKUP as { backup: Record<string, unknown> })
      .backup;
    const lesen = (backup: unknown) =>
      fehlerVon(vonDerZentraleLesen(JSON.stringify({ ...MIT_BACKUP, backup })));
    expect(lesen(ohnePasswort)).toContain("backup.passwort");
    expect(lesen(ohneZugang)).toContain("backup.zugang");
  });
});

describe("backup_stand", () => {
  it("reads a failed run with its reason and without snapshot", () => {
    const gescheitert = {
      ...STAND,
      ok: false,
      fehler: "volume:daten: falsches Passwort des Repositorys",
      teile: [{ tag: "volume:daten", ok: false, fehler: "falsches Passwort des Repositorys" }],
    };
    expect(vomAgentenLesen(JSON.stringify(gescheitert))).toMatchObject({ ok: true });
  });

  it("refuses a snapshot that is not restic's ID, and an unbounded reason", () => {
    const teil = { tag: "volume:daten", ok: true, snapshot: "nicht-hex" };
    expect(fehlerVon(vomAgentenLesen(JSON.stringify({ ...STAND, teile: [teil] })))).toContain(
      "teile.0.snapshot",
    );
    const lang = { ...STAND, ok: false, fehler: "x".repeat(2001) };
    expect(fehlerVon(vomAgentenLesen(JSON.stringify(lang)))).toContain("fehler");
  });

  it("keeps the size of a part (Z-804) and reads a part without it, as an older agent sends", () => {
    const teil = { tag: "volume:daten", ok: true, snapshot: "a".repeat(64), bytes: 1_048_576 };
    const r = vomAgentenLesen(JSON.stringify({ ...STAND, teile: [teil] }));
    expect(r).toMatchObject({ ok: true, nachricht: { teile: [{ bytes: 1_048_576 }] } });
    const { bytes: _, ...ohne } = teil;
    expect(vomAgentenLesen(JSON.stringify({ ...STAND, teile: [ohne] }))).toMatchObject({
      ok: true,
    });
    for (const falsch of [-1, 1.5, "12"])
      expect(
        fehlerVon(
          vomAgentenLesen(JSON.stringify({ ...STAND, teile: [{ ...teil, bytes: falsch }] })),
        ),
      ).toContain("teile.0.bytes");
  });

  it("names its installation and run", () => {
    const { lauf: _, ...ohneLauf } = STAND as Record<string, unknown>;
    expect(fehlerVon(vomAgentenLesen(JSON.stringify(ohneLauf)))).toContain("lauf");
  });
});
