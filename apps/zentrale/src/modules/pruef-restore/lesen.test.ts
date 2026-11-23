import { afterAll, describe, expect, it } from "vitest";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { pruefUmgebung } from "../../testhilfen/pruef-restore.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { PRUEF_RESTORE_ALT_MS, pruefRestoreAufmerksamkeit } from "./lesen.ts";
import { pruefRestorePlanen } from "./zeitplan.ts";

/*
 * BAULISTE.md Z-602: an installation needs attention for its test restore once the newest failed,
 * or once it had none for 8 days (counted from its first successful backup if it never had one).
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

describe("attention for the test restore", () => {
  it("comes 8 days after the first successful backup without one, and goes with a good one", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    const lesen = () =>
      pruefRestoreAufmerksamkeit(u.db, installationLesen(u.db, "b1", id) as never, u.uhr.ms);
    expect(lesen()).toBeUndefined();
    u.uhr.ms += PRUEF_RESTORE_ALT_MS;
    expect(lesen()).toBeUndefined();
    u.uhr.ms += 1;
    expect(lesen()).toEqual({ gescheitert: false, grund: null, seit: null });
    u.fakten("b1", "s1");
    pruefRestorePlanen(u.deps);
    const [job] = u.pruefAuftraege(id);
    const auftragId = job?.auftragId ?? "";
    u.pruefMelden(auftragId, u.ergebnis(auftragId, { ok: true, daten: {} }));
    const gelungen = u.uhr.ms;
    expect(lesen()).toBeUndefined();
    u.uhr.ms += PRUEF_RESTORE_ALT_MS + 1;
    expect(lesen()).toEqual({ gescheitert: false, grund: null, seit: gelungen });
  });

  it("stays while the newest failed, however young", async () => {
    const u = pruefUmgebung(minio);
    const id = await u.gesichert();
    pruefRestorePlanen(u.deps);
    const [job] = u.pruefAuftraege(id);
    const auftragId = job?.auftragId ?? "";
    u.pruefMelden(auftragId, u.ergebnis(auftragId, { ok: false, fehler: "Health rot" }));
    const i = installationLesen(u.db, "b1", id) as never;
    expect(pruefRestoreAufmerksamkeit(u.db, i, u.uhr.ms)).toEqual({
      gescheitert: true,
      grund: "Health rot",
      seit: u.uhr.ms,
    });
  });
});
