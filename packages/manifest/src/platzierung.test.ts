import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { manifestPruefen } from "./laden.ts";
import { type PlatzAnfrage, type PlatzInstallation, platzieren, ramBedarf } from "./platzierung.ts";
import type { Manifest } from "./schema.ts";

const D = (n: number) => `ghcr.io/speicherstadt/app@sha256:${String(n).repeat(64)}`;

/** A small valid manifest; `extra` overrides top-level fields */
const manifest = (extra: Record<string, unknown> = {}): Manifest => {
  const roh = {
    schema: 1,
    id: "app",
    version: "1.0.0",
    lizenz: "AGPL-3.0-only",
    quelle: "https://example.org/app",
    container: [{ name: "app", image: D(1) }],
    architektur: ["amd64", "arm64"],
    ressourcen: { ram_mb: 1024, platte_gb: 10 },
    netz: { http: { dienst: "app", port: 3000 } },
    anmeldung: "oidc",
    health: { art: "http", dienst: "app", pfad: "/health" },
    aktionen: { nur_lesen: "nicht_unterstuetzt", export: "nicht_unterstuetzt" },
    ...extra,
  };
  const geprueft = manifestPruefen(JSON.stringify(roh));
  if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
  return geprueft.manifest;
};

type Aenderung = Partial<Omit<PlatzAnfrage, "server">> & {
  server?: Partial<PlatzAnfrage["server"]>;
};

const anfrage = (aenderung: Aenderung = {}): PlatzAnfrage => ({
  manifest: manifest(),
  optionen: [],
  installationen: [],
  kunde: { id: "k1", betreiberId: "b1", bietet: [] },
  betreiberWerte: [],
  ...aenderung,
  server: {
    betreiberId: "b1",
    art: "gemeinsam",
    kundeId: null,
    agentVerbunden: true,
    architektur: "amd64",
    ramMb: 4096,
    platteFreiMb: 100 * 1024,
    platteGesamtMb: 200 * 1024,
    ipv4: ["203.0.113.10"],
    ptr: { "203.0.113.10": "server.example.org" },
    port25Ausgehend: true,
    portsBelegt: [],
    ...aenderung.server,
  },
});

const andere = (extra: Partial<PlatzInstallation> = {}): PlatzInstallation => ({
  kundeId: "k2",
  ramMb: 1024,
  platteGb: 10,
  festePorts: [],
  serverFuerSich: false,
  ...extra,
});

const codes = (a: PlatzAnfrage) => {
  const p = platzieren(a);
  return {
    art: p.art,
    gruende: p.art === "passt_nicht" ? p.gruende.map((g) => g.code) : [],
    hinweise: p.hinweise.map((h) => h.code),
  };
};

describe("placement", () => {
  it("fits an app on an empty, matching server", () => {
    expect(platzieren(anfrage())).toEqual({ art: "passt", hinweise: [] });
  });

  describe("architecture per container and option", () => {
    const nurAmd = manifest({
      container: [{ name: "app", image: D(1), architektur: ["amd64"] }],
      architektur: ["amd64"],
    });
    it("passt", () => expect(codes(anfrage({ manifest: nurAmd })).art).toBe("passt"));
    it("Grenze: an option of its own architecture fits only when chosen on that architecture", () => {
      const mitOption = manifest({
        optionen: [
          {
            id: "extra",
            name: "Extra",
            architektur: ["amd64"],
            container: [{ name: "extra", image: D(2) }],
          },
        ],
      });
      expect(codes(anfrage({ manifest: mitOption, server: { architektur: "arm64" } })).art).toBe(
        "passt",
      );
      expect(
        codes(
          anfrage({ manifest: mitOption, optionen: ["extra"], server: { architektur: "arm64" } }),
        ).gruende,
      ).toEqual(["architektur"]);
    });
    it("passt nicht", () =>
      expect(
        codes(anfrage({ manifest: nurAmd, server: { architektur: "arm64" } })).gruende,
      ).toEqual(["architektur"]));
    it("passt nicht with a chosen option of another architecture that brings no container", () => {
      const nurOption = manifest({
        optionen: [{ id: "extra", name: "Extra", architektur: ["amd64"] }],
      });
      expect(
        platzieren(
          anfrage({ manifest: nurOption, optionen: ["extra"], server: { architektur: "arm64" } }),
        ),
      ).toEqual({
        art: "passt_nicht",
        gruende: [{ code: "architektur", werte: { option: "extra", server: "arm64" } }],
        hinweise: [],
      });
    });
  });

  describe("RAM as the sum of the limits", () => {
    it("passt", () =>
      expect(codes(anfrage({ installationen: [andere({ ramMb: 1024 })] })).art).toBe("passt"));
    it("Grenze: exactly the server's RAM fits, with a hint", () => {
      expect(codes(anfrage({ installationen: [andere({ ramMb: 3072 })] }))).toEqual({
        art: "hinweise",
        gruende: [],
        hinweise: ["ram_knapp"],
      });
    });
    it("passt nicht one MB over", () =>
      expect(codes(anfrage({ installationen: [andere({ ramMb: 3073 })] })).gruende).toEqual([
        "ram",
      ]));
    it("counts the RAM of chosen options", () => {
      const m = manifest({ optionen: [{ id: "gross", name: "Groß", ram_mb: 4096 }] });
      expect(ramBedarf(m, ["gross"])).toBe(5120);
      expect(codes(anfrage({ manifest: m, optionen: ["gross"] })).gruende).toEqual(["ram"]);
    });
  });

  describe("disk as planned value", () => {
    it("passt", () => expect(codes(anfrage()).art).toBe("passt"));
    it("Grenze: exactly the free space fits, with a hint", () => {
      expect(codes(anfrage({ server: { platteFreiMb: 10 * 1024 } })).hinweise).toEqual([
        "platte_knapp",
      ]);
    });
    it("passt nicht", () =>
      expect(codes(anfrage({ server: { platteFreiMb: 10 * 1024 - 1 } })).gruende).toEqual([
        "platte",
      ]));
    it("Grenze: the planned sizes of all installations may fill the disk exactly, with a hint", () =>
      expect(codes(anfrage({ installationen: [andere({ platteGb: 190 })] })).hinweise).toEqual([
        "platte_knapp",
      ]));
    it("passt nicht when the planned sizes together exceed the disk, however empty it is now", () =>
      expect(codes(anfrage({ installationen: [andere({ platteGb: 191 })] })).gruende).toEqual([
        "platte",
      ]));
  });

  describe("fixed ports", () => {
    const mail = manifest({
      netz: {
        http: { dienst: "app", port: 3000 },
        ports: [
          { dienst: "app", port: 25, fest: true },
          { dienst: "app", port: 20000, bis: 20100, proto: "udp", fest: true },
        ],
      },
    });
    it("passt", () =>
      expect(
        codes(
          anfrage({
            manifest: mail,
            installationen: [andere({ festePorts: [{ port: 26, proto: "tcp" }] })],
          }),
        ).art,
      ).toBe("passt"));
    it("Grenze: the same number with the other protocol and the port right after a range fit", () => {
      const nebenan = [
        andere({
          festePorts: [
            { port: 25, proto: "udp" },
            { port: 20101, proto: "udp" },
          ],
        }),
      ];
      expect(codes(anfrage({ manifest: mail, installationen: nebenan })).art).toBe("passt");
    });
    it("passt nicht: a port taken twice, also inside a range or by the server itself", () => {
      expect(
        codes(
          anfrage({
            manifest: mail,
            installationen: [andere({ festePorts: [{ port: 25, proto: "tcp" }] })],
          }),
        ).gruende,
      ).toEqual(["port_belegt"]);
      expect(
        codes(
          anfrage({
            manifest: mail,
            installationen: [andere({ festePorts: [{ port: 20100, proto: "udp" }] })],
          }),
        ).gruende,
      ).toEqual(["port_belegt"]);
      expect(
        codes(anfrage({ manifest: mail, server: { portsBelegt: [{ port: 25, proto: "tcp" }] } }))
          .gruende,
      ).toEqual(["port_belegt"]);
    });
    it("leaves assigned ports (fest: false) to the Zentrale", () => {
      const stellwerk = manifest({
        netz: {
          http: { dienst: "app", port: 3000 },
          ports: [{ dienst: "app", port: 22001, fest: false }],
        },
      });
      expect(
        codes(
          anfrage({
            manifest: stellwerk,
            server: { portsBelegt: [{ port: 22001, proto: "tcp" }] },
          }),
        ).art,
      ).toBe("passt");
    });
  });

  describe("public IPv4", () => {
    const braucht = manifest({
      netz: { http: { dienst: "app", port: 3000 }, oeffentliche_ipv4: true },
    });
    it("passt", () => expect(codes(anfrage({ manifest: braucht })).art).toBe("passt"));
    it("Grenze: a private address beside a public one fits", () => {
      expect(
        codes(anfrage({ manifest: braucht, server: { ipv4: ["10.0.0.2", "203.0.113.10"] } })).art,
      ).toBe("passt");
    });
    it("passt nicht behind NAT", () => {
      expect(
        codes(anfrage({ manifest: braucht, server: { ipv4: ["192.168.1.5", "100.64.0.1"] } }))
          .gruende,
      ).toEqual(["keine_oeffentliche_ipv4"]);
    });
  });

  describe("mail", () => {
    const m = manifest({ netz: { http: { dienst: "app", port: 3000 }, mail: true } });
    it("passt", () => expect(codes(anfrage({ manifest: m })).art).toBe("passt"));
    it("Grenze: a PTR on the public address is enough, one on a private address is not", () => {
      expect(
        codes(
          anfrage({
            manifest: m,
            server: {
              ipv4: ["10.0.0.2", "203.0.113.10"],
              ptr: { "203.0.113.10": "mx.example.org" },
            },
          }),
        ).art,
      ).toBe("passt");
      expect(
        codes(
          anfrage({
            manifest: m,
            server: { ipv4: ["10.0.0.2", "203.0.113.10"], ptr: { "10.0.0.2": "intern" } },
          }),
        ).gruende,
      ).toEqual(["kein_ptr"]);
    });
    it("passt nicht without PTR and with port 25 blocked or unknown", () => {
      expect(
        codes(anfrage({ manifest: m, server: { ptr: {}, port25Ausgehend: false } })).gruende,
      ).toEqual(["kein_ptr", "port25_gesperrt"]);
      expect(codes(anfrage({ manifest: m, server: { port25Ausgehend: null } })).gruende).toEqual([
        "port25_gesperrt",
      ]);
    });
  });

  describe("a server of its own, both ways", () => {
    const allein = manifest({
      netz: { http: { dienst: "app", port: 3000 }, server_fuer_sich: true },
    });
    it("passt on an empty server", () =>
      expect(codes(anfrage({ manifest: allein })).art).toBe("passt"));
    it("Grenze: one installation beside it is already one too many", () => {
      expect(codes(anfrage({ manifest: allein, installationen: [andere()] })).gruende).toEqual([
        "braucht_server_fuer_sich",
      ]);
    });
    it("passt nicht beside an app that needs the server for itself", () => {
      expect(
        codes(anfrage({ installationen: [andere({ serverFuerSich: true })] })).gruende,
      ).toEqual(["server_belegt_fuer_sich"]);
    });
  });

  describe("rootful and a proxy of its own only on a server of their own", () => {
    const rootful = manifest({
      rootful: true,
      netz: { http: { dienst: "app", port: 3000 }, server_fuer_sich: true },
    });
    const eigenerProxy = manifest({ proxy: "eigen", netz: { http: null, server_fuer_sich: true } });
    it("passt alone", () => {
      expect(codes(anfrage({ manifest: rootful })).art).toBe("passt");
      expect(codes(anfrage({ manifest: eigenerProxy })).art).toBe("passt");
    });
    it("Grenze: an installation of the same customer beside it counts too", () => {
      expect(
        codes(anfrage({ manifest: rootful, installationen: [andere({ kundeId: "k1" })] })).gruende,
      ).toEqual(["braucht_server_fuer_sich"]);
    });
    it("passt nicht beside others", () => {
      expect(
        codes(anfrage({ manifest: eigenerProxy, installationen: [andere()] })).gruende,
      ).toEqual(["braucht_server_fuer_sich"]);
    });
  });

  describe("server of another customer or operator", () => {
    it("passt on a shared server and on the customer's own", () => {
      expect(codes(anfrage()).art).toBe("passt");
      expect(codes(anfrage({ server: { art: "eigen", kundeId: "k1" } })).art).toBe("passt");
    });
    it("Grenze: a server at the customer belongs to that customer only", () => {
      expect(codes(anfrage({ server: { art: "beim_kunden", kundeId: "k1" } })).art).toBe("passt");
      expect(codes(anfrage({ server: { art: "beim_kunden", kundeId: "k2" } })).gruende).toEqual([
        "server_anderer_kunde",
      ]);
    });
    it("passt nicht on another operator's server, even a shared one", () => {
      expect(codes(anfrage({ server: { betreiberId: "b2" } })).gruende).toEqual([
        "server_anderer_betreiber",
      ]);
    });
  });

  describe("braucht without bietet at the customer", () => {
    const kennwort = manifest({ braucht: ["oidc-anbieter"] });
    it("passt", () =>
      expect(
        codes(
          anfrage({
            manifest: kennwort,
            kunde: { id: "k1", betreiberId: "b1", bietet: ["oidc-anbieter", "smtp"] },
          }),
        ).art,
      ).toBe("passt"));
    it("Grenze: another service of the customer is not enough", () => {
      expect(
        codes(
          anfrage({ manifest: kennwort, kunde: { id: "k1", betreiberId: "b1", bietet: ["smtp"] } }),
        ).gruende,
      ).toEqual(["braucht_dienst"]);
    });
    it("passt nicht", () =>
      expect(codes(anfrage({ manifest: kennwort })).gruende).toEqual(["braucht_dienst"]));
  });

  describe("required values of the operator", () => {
    const haben = manifest({
      env: [
        { name: "ELSTER_HERSTELLER_ID", ebene: "betreiber", pflicht: true },
        { name: "KI_SCHLUESSEL", ebene: "betreiber" },
      ],
    });
    it("passt", () =>
      expect(
        codes(anfrage({ manifest: haben, betreiberWerte: ["ELSTER_HERSTELLER_ID"] })).art,
      ).toBe("passt"));
    it("Grenze: an optional value may be missing", () =>
      expect(
        codes(anfrage({ manifest: haben, betreiberWerte: ["ELSTER_HERSTELLER_ID"] })).gruende,
      ).toEqual([]));
    it("passt nicht", () =>
      expect(
        codes(anfrage({ manifest: haben, betreiberWerte: ["KI_SCHLUESSEL"] })).gruende,
      ).toEqual(["betreiberwert_fehlt"]));
  });

  describe("agent and image", () => {
    it("passt with a connected agent and published images", () =>
      expect(codes(anfrage()).art).toBe("passt"));
    it("Grenze: an unpublished image in an option not chosen does not count", () => {
      const m = manifest({
        optionen: [
          {
            id: "neu",
            name: "Neu",
            container: [{ name: "neu", image: { noch_nicht_veroeffentlicht: "Soll#1" } }],
          },
        ],
      });
      expect(codes(anfrage({ manifest: m })).art).toBe("passt");
      expect(codes(anfrage({ manifest: m, optionen: ["neu"] })).gruende).toEqual(["kein_image"]);
    });
    it("passt nicht with the agent disconnected or without an image", () => {
      expect(codes(anfrage({ server: { agentVerbunden: false } })).gruende).toEqual([
        "agent_getrennt",
      ]);
      const soll = manifest({
        container: [{ name: "app", image: { noch_nicht_veroeffentlicht: "Soll" } }],
      });
      expect(codes(anfrage({ manifest: soll })).gruende).toEqual(["kein_image"]);
    });
    it("refuses an option the manifest does not know", () => {
      expect(codes(anfrage({ optionen: ["gibts-nicht"] })).gruende).toEqual(["unbekannte_option"]);
    });
  });

  it("refuses Kontext with documents on arm64", () => {
    // Kontext's option documents brings Schreibzeug, which runs on amd64 only (docs/plan.md)
    const kontext = manifest({
      id: "kontext",
      optionen: [
        {
          id: "documents",
          name: "Dokumente",
          architektur: ["amd64"],
          container: [{ name: "schreibzeug", image: D(3) }],
        },
      ],
    });
    expect(codes(anfrage({ manifest: kontext, server: { architektur: "arm64" } })).art).toBe(
      "passt",
    );
    expect(
      platzieren(
        anfrage({ manifest: kontext, optionen: ["documents"], server: { architektur: "arm64" } }),
      ),
    ).toEqual({
      art: "passt_nicht",
      gruende: [{ code: "architektur", werte: { container: "schreibzeug", server: "arm64" } }],
      hinweise: [],
    });
  });
});

describe("placement, for any sequence of apps (fast-check)", () => {
  const app = fc.record({
    ram: fc.integer({ min: 64, max: 4096 }),
    ports: fc.uniqueArray(fc.integer({ min: 20, max: 40 }), { maxLength: 3 }),
  });

  it("never puts two installations on the same fixed port and never gives out more RAM than the server has", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 16_384 }),
        fc.array(app, { maxLength: 12 }),
        (serverRam, apps) => {
          const installationen: PlatzInstallation[] = [];
          for (const a of apps) {
            const m = manifest({
              ressourcen: { ram_mb: a.ram, platte_gb: 1 },
              netz: {
                http: { dienst: "app", port: 3000 },
                ports: a.ports.map((port) => ({ dienst: "app", port, fest: true })),
              },
            });
            const ergebnis = platzieren(
              anfrage({ manifest: m, installationen, server: { ramMb: serverRam } }),
            );
            if (ergebnis.art !== "passt_nicht")
              installationen.push(
                andere({
                  ramMb: a.ram,
                  festePorts: a.ports.map((port) => ({ port, proto: "tcp" as const })),
                }),
              );
          }
          const ports = installationen.flatMap((i) => i.festePorts.map((p) => p.port));
          expect(new Set(ports).size).toBe(ports.length);
          expect(installationen.reduce((s, i) => s + i.ramMb, 0)).toBeLessThanOrEqual(serverRam);
        },
      ),
      { numRuns: 200 },
    );
  });
});
