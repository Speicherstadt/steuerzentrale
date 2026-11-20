// biome-ignore-all lint/suspicious/noTemplateCurlyInString: manifest templates write ${…} placeholders as plain text
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { manifestPruefen } from "./laden.ts";

// The YAML is edited freely here, against the shape of the manifest on purpose
// biome-ignore lint/suspicious/noExplicitAny: test cases write wrong types into the manifest
type Roh = Record<string, any>;

const DIGEST = `sha256:${"a".repeat(64)}`;

/** The example of docs/plan.md ("Manifest"), with the shortened digests filled in */
const planBeispiel = (): string => {
  const plan = readFileSync(join(import.meta.dirname, "../../../docs/plan.md"), "utf8");
  const block = /## Manifest[\s\S]*?```yaml\n([\s\S]*?)```/.exec(plan)?.[1];
  if (!block) throw new Error("no yaml block under ## Manifest in docs/plan.md");
  return block.replaceAll("sha256:…", DIGEST);
};

/** The plan example with one change, as YAML */
const mit = (aendern: (m: Roh) => void): string => {
  const m = parse(planBeispiel());
  aendern(m);
  return stringify(m);
};

const fehler = (text: string): string[] => {
  const ergebnis = manifestPruefen(text);
  return ergebnis.ok ? [] : ergebnis.fehler;
};

describe("the example of docs/plan.md", () => {
  it("is a valid manifest", () => {
    expect(fehler(planBeispiel())).toEqual([]);
    const ergebnis = manifestPruefen(planBeispiel());
    expect(ergebnis.ok && ergebnis.manifest.sperrzeiten).toEqual([
      { monatlich: "07-12", grund: "Umsatzsteuer-Voranmeldung" },
    ]);
  });
});

describe("freeze windows", () => {
  it("may cross the month's end (packages/planung reads 28-03 as the 28th to the 3rd)", () => {
    expect(
      fehler(
        mit((m) => {
          m.sperrzeiten[0].monatlich = "28-03";
        }),
      ),
    ).toEqual([]);
  });
});

describe("invalid manifests", () => {
  // Each one fails with a message that names the field and the reason
  const faelle: [string, (m: Roh) => void, string][] = [
    [
      "an image without digest",
      (m) => {
        m.container[0].image = "docker.io/tristanteu/haben:1.9.0";
      },
      "container.0.image: an image needs registry, name and digest",
    ],
    [
      "an image without registry",
      (m) => {
        m.container[0].image = `tristanteu/haben@${DIGEST}`;
      },
      "container.0.image: an image needs registry, name and digest",
    ],
    [
      "a step as shell text",
      (m) => {
        m.befehle = { migrieren: { container: "app", argv: ["bun", "migrate"] } };
        m.schritte.nach_update = ["bun migrate && echo ok"];
      },
      'schritte.nach_update.0: "bun migrate && echo ok" is not the name of a command',
    ],
    [
      "a command that starts a shell",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["/bin/sh", "-c", "id"] } };
      },
      "befehle.x.argv.0: sh would start a shell",
    ],
    [
      "a command that starts a shell through a wrapper",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["timeout", "60", "sh", "-c", "id"] } };
      },
      "befehle.x.argv.2: sh would start a shell",
    ],
    [
      "a command that starts a shell through nice",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["nice", "/bin/bash", "-c", "id"] } };
      },
      "befehle.x.argv.1: bash would start a shell",
    ],
    [
      "a command that starts the shell of toybox",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["toybox", "sh", "-c", "id"] } };
      },
      "befehle.x.argv.0: toybox would start a shell",
    ],
    [
      "a command that starts mksh",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["mksh", "-c", "id"] } };
      },
      "befehle.x.argv.0: mksh would start a shell",
    ],
    [
      "a command that starts csh",
      (m) => {
        m.befehle = { x: { container: "app", argv: ["/bin/csh", "-c", "id"] } };
      },
      "befehle.x.argv.0: csh would start a shell",
    ],
    [
      "a container whose command starts a shell",
      (m) => {
        m.container[0].argv = ["sh", "-c", "id"];
      },
      "container.0.argv.0: sh would start a shell",
    ],
    [
      "an option container whose command starts a shell",
      (m) => {
        m.optionen = [
          {
            id: "extra",
            name: "Extra",
            container: [{ name: "extra", image: m.container[0].image, argv: ["bash", "-c", "id"] }],
          },
        ];
      },
      "optionen.0.container.0.argv.0: bash would start a shell",
    ],
    [
      "rootful on a shared server",
      (m) => {
        m.rootful = true;
      },
      "rootful: rootful needs netz.server_fuer_sich: true",
    ],
    [
      "a proxy of its own on a shared server",
      (m) => {
        m.proxy = "eigen";
      },
      "proxy: a proxy of its own needs netz.server_fuer_sich: true",
    ],
    [
      "a reference to a missing container",
      (m) => {
        m.container[0].braucht = ["redis"];
      },
      "container.0.braucht.0: no container named redis",
    ],
    [
      "a backup of a volume nobody mounts",
      (m) => {
        m.backup[1].volume = "fehlt";
      },
      "backup.1.volume: no container mounts a volume named fehlt",
    ],
    [
      "an auto value without source",
      (m) => {
        m.env[2] = { name: "BETTER_AUTH_SECRET", ebene: "auto" };
      },
      "env.2: an auto value needs exactly one of erzeugen, aus or vorlage",
    ],
    [
      "an unknown health kind",
      (m) => {
        m.health = { art: "ping", dienst: "app" };
      },
      "health.art: ",
    ],
    [
      "a version that is no version",
      (m) => {
        m.version = "neu";
      },
      "version: a version as major.minor.patch",
    ],
    [
      "an unknown field",
      (m) => {
        m.autoupdate = true;
      },
      "(manifest): ",
    ],
    [
      "an env value of a container that is not declared",
      (m) => {
        m.container[0].env = ["GEHEIM"];
      },
      "container.0.env.0: GEHEIM is not declared under env",
    ],
  ];

  it.each(faelle)("refuses %s", (_name, aendern, erwartet) => {
    const gefunden = fehler(mit(aendern));
    expect(gefunden.length, `no finding for: ${_name}`).toBeGreaterThan(0);
    expect(
      gefunden.some((f) => f.startsWith(erwartet)),
      gefunden.join("\n"),
    ).toBe(true);
  });

  it("covers at least ten cases", () => {
    expect(faelle.length).toBeGreaterThanOrEqual(10);
  });

  it("refuses YAML with a duplicate key or an alias", () => {
    expect(fehler(`${planBeispiel()}\nid: doppelt\n`)[0]).toMatch(/^\(yaml\): /);
    expect(fehler("a: &x 1\nb: *x\n")[0]).toMatch(/^\(yaml\): /);
  });

  it("refuses an image with a tag in front of its digest only if the digest is malformed", () => {
    expect(
      fehler(
        mit((m) => {
          m.container[0].image = "docker.io/tristanteu/haben@sha256:abc";
        }),
      )[0],
    ).toMatch(/^container\.0\.image: /);
  });
});

describe("configuration files (Z-203: the Caddyfile of an app with a proxy of its own)", () => {
  it("are mounted by absolute path with their content", () => {
    const ergebnis = manifestPruefen(
      mit((m) => {
        m.container[0].dateien = [{ pfad: "/etc/caddy/Caddyfile", inhalt: "{$DOMAIN} {\n}\n" }];
      }),
    );
    expect(ergebnis.ok && ergebnis.manifest.container[0]?.dateien).toEqual([
      { pfad: "/etc/caddy/Caddyfile", inhalt: "{$DOMAIN} {\n}\n" },
    ]);
  });

  it("refuses a relative path or an empty file", () => {
    expect(
      fehler(
        mit((m) => {
          m.container[0].dateien = [{ pfad: "Caddyfile", inhalt: "x" }];
        }),
      )[0],
    ).toMatch(/^container\.0\.dateien\.0\.pfad: an absolute path/);
    expect(
      fehler(
        mit((m) => {
          m.container[0].dateien = [{ pfad: "/etc/x", inhalt: "" }];
        }),
      )[0],
    ).toMatch(/^container\.0\.dateien\.0\.inhalt: /);
  });
});

describe("generated values", () => {
  it("know hex for values inside a URL (a database password in DATABASE_URL)", () => {
    expect(
      fehler(
        mit((m) => {
          m.env.push({
            name: "DB_PASSWORT",
            ebene: "auto",
            typ: "geheim",
            erzeugen: "zufall_hex_32",
          });
        }),
      ),
    ).toEqual([]);
  });
});

describe("templates", () => {
  const mitVorlage = (vorlage: string) =>
    fehler(
      mit((m) => {
        m.env.push({ name: "DB_PASSWORT", ebene: "auto", erzeugen: "zufall_hex_32" });
        m.env.push({ name: "VERBINDUNG", ebene: "auto", vorlage });
      }),
    );

  it("name address, host, an assigned port and another setting; other braces are text", () => {
    expect(mitVorlage("postgres://haben:${env:DB_PASSWORT}@db:5432/haben")).toEqual([]);
    expect(mitVorlage("${adresse} ${host}")).toEqual([]);
    expect(mitVorlage("tcp://${host}:${port:app:3000}")).toEqual([]);
    expect(
      mitVorlage('{api_secret: "${env:DB_PASSWORT}", redis: {address: "redis:6379"}}'),
    ).toEqual([]);
  });

  it.each([
    ["${wer}", "${wer} is no placeholder"],
    ["${ipv6}", "${ipv6} is no placeholder"],
    ["${container:db}", "${container:db} is no placeholder"],
    ["${port:app:22001}", "no port 22001 of app under netz"],
    ["${env:FEHLT}", "FEHLT is not declared under env"],
    ["${env:VERBINDUNG}", "VERBINDUNG is a template itself"],
  ])("refuse %s", (vorlage, grund) => {
    const gefunden = mitVorlage(vorlage);
    expect(
      gefunden.some((f) => f.startsWith("env.") && f.includes(grund)),
      gefunden.join("\n"),
    ).toBe(true);
  });
});

describe("DNS records", () => {
  it("use the placeholders of templates, and only known ones", () => {
    const mitEintrag = (wert: string) =>
      fehler(
        mit((m) => {
          m.env.push({ name: "MAIL_DOMAIN", ebene: "installation", pflicht: true });
          m.dns = [{ typ: "A", name: "mail.${env:MAIL_DOMAIN}", wert }];
        }),
      );
    expect(mitEintrag("${ipv4}")).toEqual([]);
    expect(mitEintrag("${ipv6}")).toEqual([
      "dns.0.wert: ${ipv6} is no placeholder (adresse, host, ipv4, port:, env:)",
    ]);
  });
});

describe("settings of an option", () => {
  it("name an option of the manifest", () => {
    const mitOption = (option: string) =>
      fehler(
        mit((m) => {
          m.optionen = [{ id: "ki", name: "KI", container: [] }];
          m.env.push({ name: "KI_URL", ebene: "installation", option });
        }),
      );
    expect(mitOption("ki")).toEqual([]);
    expect(mitOption("ftp")).toContain("env.4.option: no option named ftp");
  });
});
