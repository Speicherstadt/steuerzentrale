import * as x509 from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import { pforteTls } from "./tls.ts";

/** The Pforte's certificate in CI (ci-pforte.ts) names the bridge address the VMs reach it on */
describe("pforteTls", () => {
  const adressen = async (ips?: string[]) => {
    const { zertifikat } = await pforteTls(Date.now(), ips);
    const san = new x509.X509Certificate(zertifikat).getExtension(
      x509.SubjectAlternativeNameExtension,
    );
    return san?.names.items.map((n) => `${n.type}:${n.value}`);
  };

  it("names localhost and 127.0.0.1", async () => {
    expect(await adressen()).toEqual(["dns:localhost", "ip:127.0.0.1"]);
  });

  it("names further addresses as given", async () => {
    expect(await adressen(["10.185.246.1"])).toEqual([
      "dns:localhost",
      "ip:127.0.0.1",
      "ip:10.185.246.1",
    ]);
  });
});
