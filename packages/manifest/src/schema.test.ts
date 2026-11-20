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
      "a freeze window ending before it starts",
      (m) => {
        m.sperrzeiten[0].monatlich = "12-07";
      },
      "sperrzeiten.0.monatlich: the first day is after the last",
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
