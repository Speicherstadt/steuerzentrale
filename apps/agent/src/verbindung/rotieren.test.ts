import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { pfadeIn } from "../pfade.ts";
import { rotationAbschliessen, rotationSpeichern } from "./rotieren.ts";

const pfade = pfadeIn("/k", "/z");
const alt = {
  "/z/agent.key": "alter-schluessel",
  "/z/agent.pem": "altes-zertifikat",
  "/z/ca.pem": "ca",
};

describe("keeping a rotated certificate", () => {
  it("puts key and certificate in place together, the key readable by root only", async () => {
    const fs = speicher(alt);
    await rotationSpeichern(fs.dateien, pfade, {
      schluessel: "neuer",
      zertifikat: "neues",
      ca: "ca",
    });
    expect(fs.inhalt.get("/z/agent.key")).toEqual({ text: "neuer", modus: 0o600 });
    expect(fs.inhalt.get("/z/agent.pem")?.text).toBe("neues");
    expect(fs.inhalt.has("/z/agent.key.rotiert")).toBe(false);
    expect(fs.inhalt.has("/z/agent.pem.rotiert")).toBe(false);
    // the certificate is the last thing written: the point of no return
    expect(fs.reihenfolge.indexOf("/z/agent.pem.rotiert")).toBeGreaterThan(
      fs.reihenfolge.indexOf("/z/agent.key.rotiert"),
    );
  });

  it("finishes a swap a stop interrupted after the commit", async () => {
    const fs = speicher({ ...alt, "/z/agent.key": "neuer", "/z/agent.pem.rotiert": "neues" });
    await rotationAbschliessen(fs.dateien, pfade);
    expect(fs.inhalt.get("/z/agent.key")?.text).toBe("neuer");
    expect(fs.inhalt.get("/z/agent.pem")?.text).toBe("neues");
  });

  it("keeps the old pair when only the new key was written", async () => {
    const fs = speicher({ ...alt, "/z/agent.key.rotiert": "neuer" });
    await rotationAbschliessen(fs.dateien, pfade);
    expect(fs.inhalt.get("/z/agent.key")?.text).toBe("alter-schluessel");
    expect(fs.inhalt.get("/z/agent.pem")?.text).toBe("altes-zertifikat");
  });
});
