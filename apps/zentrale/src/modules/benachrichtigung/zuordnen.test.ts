import { afterEach, describe, expect, it } from "vitest";
import { benachrichtigungsUmgebung, ereignisSchreiben } from "../../testhilfen/benachrichtigung.ts";
import { webhookEmpfaenger } from "../../testhilfen/webhook.ts";
import { behobeneArt } from "./zuordnen.ts";

/*
 * BAULISTE.md Z-703 with Z-704: the check from outside reports its end as `aussen_gruen`, not
 * `aussen_rot_behoben`; it is the fix of `aussen_rot` all the same and reaches whoever heard of it.
 */
const SCHLUESSEL = "empfaenger-schluessel-0123456789abcdef01234567";

const stopper: (() => unknown)[] = [];
afterEach(async () => {
  for (const s of stopper.splice(0)) await s();
});

describe("behobeneArt", () => {
  it("names what a fix fixes: `<art>_behoben` and the green outside after red", () => {
    expect(behobeneArt("stoerung_behoben")).toBe("stoerung");
    expect(behobeneArt("pruefung_platte_behoben")).toBe("pruefung_platte");
    expect(behobeneArt("aussen_gruen")).toBe("aussen_rot");
    expect(behobeneArt("aussen_rot")).toBeUndefined();
    expect(behobeneArt("stoerung")).toBeUndefined();
    expect(behobeneArt("backup_gelungen")).toBeUndefined();
  });
});

describe("green outside after red", () => {
  it("goes out with the severity of the red, to whoever heard of it, as a fix", async () => {
    const u = benachrichtigungsUmgebung();
    const nurWarnungen = webhookEmpfaenger(SCHLUESSEL, { jetzt: () => u.uhr.ms });
    stopper.push(nurWarnungen.stoppen);
    u.empfaenger("b1", {
      art: "webhook",
      url: nurWarnungen.url(),
      schluessel: SCHLUESSEL,
      abSchwere: "warn",
    });
    const t = u.uhr.ms;
    const ziel = "installation:i1";
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t,
      art: "aussen_rot",
      schwere: "warn",
      ziel,
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 1,
      art: "aussen_gruen",
      schwere: "info",
      ziel,
    });
    // a green outside at another installation, never red there, stays a hint below the threshold
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 2,
      art: "aussen_gruen",
      schwere: "info",
      ziel: "installation:i2",
    });
    u.uhr.ms = t + 10;
    await u.lauf();
    const empfangen = nurWarnungen.empfangen.map((x) => JSON.parse(x.body));
    expect(empfangen.map((b) => b.ereignis.art).sort()).toEqual(["aussen_gruen", "aussen_rot"]);
    expect(empfangen.find((b) => b.ereignis.art === "aussen_gruen")?.text).toBe(
      "[Behoben] aussen_gruen auf s1",
    );
  });
});
