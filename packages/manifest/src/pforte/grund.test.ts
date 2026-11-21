import { describe, expect, it } from "vitest";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import {
  GRUND_ID,
  PFORTE_ADMIN_IM_CONTAINER,
  PFORTE_SERVER,
  pforteGrundkonfiguration,
  UNBEKANNT_ID,
} from "./grund.ts";

describe("the Pforte's base configuration", () => {
  it("listens on 443 with redirects from 80 and takes certificates by ACME, as on a server", () => {
    expect(pforteGrundkonfiguration()).toEqual({
      admin: { listen: "unix//run/pforte/admin.sock", config: { persist: true } },
      apps: {
        http: {
          http_port: 80,
          https_port: 443,
          servers: {
            [PFORTE_SERVER]: {
              "@id": GRUND_ID,
              listen: [":443"],
              routes: [
                {
                  "@id": UNBEKANNT_ID,
                  handle: [{ handler: "static_response", status_code: 404 }],
                  terminal: true,
                },
              ],
            },
          },
        },
      },
    });
  });

  it("keeps the admin API on a Unix socket, never on a TCP port", () => {
    const { admin } = pforteGrundkonfiguration();
    expect(admin.listen).toBe(`unix/${PFORTE_ADMIN_IM_CONTAINER}`);
    expect(admin.listen).not.toMatch(/:\d+$/);
  });

  it("takes other ports and a local CA (tls internal) for tests", () => {
    const k = pforteGrundkonfiguration({
      httpPort: 28080,
      httpsPort: 28443,
      zertifikate: "intern",
    });
    expect(k.apps.http).toMatchObject({ http_port: 28080, https_port: 28443 });
    expect(k.apps.http.servers[PFORTE_SERVER]?.listen).toEqual([":28443"]);
    expect(k.apps.tls).toEqual({
      automation: { policies: [{ issuers: [{ module: "internal" }] }] },
    });
    expect(k.apps.pki).toEqual({ certificate_authorities: { local: { install_trust: false } } });
  });

  it("names its own objects so that no installation can take the name", () => {
    for (const id of [GRUND_ID, UNBEKANNT_ID]) expect(INSTALLATIONS_NAME.test(id)).toBe(false);
  });
});
