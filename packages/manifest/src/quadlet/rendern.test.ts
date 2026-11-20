// biome-ignore-all lint/suspicious/noTemplateCurlyInString: manifest templates write ${…} placeholders as plain text
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "../schema.ts";
import { quadletsRendern } from "./rendern.ts";
import { beispielManifest, testAnfrage, testManifest } from "./testeingabe.ts";
import type { QuadletAnfrage, Quadlets } from "./typen.ts";

const MANIFESTE = join(import.meta.dirname, "../../../../manifeste");

const appManifest = (app: string): Manifest => {
  const [version] = readdirSync(join(MANIFESTE, app));
  return testManifest(readFileSync(join(MANIFESTE, app, version ?? "", "manifest.yml"), "utf8"));
};
const beispiel = () =>
  beispielManifest(readFileSync(join(MANIFESTE, "beispiel/manifest.vorlage.yml"), "utf8"));

const gerendert = (a: QuadletAnfrage): Quadlets => {
  const r = quadletsRendern(a);
  if (!r.ok) throw new Error(JSON.stringify(r.gruende));
  return r.quadlets;
};
const gruende = (a: QuadletAnfrage): string[] => {
  const r = quadletsRendern(a);
  return r.ok ? [] : r.gruende.map((g) => `${g.pfad.join(".")}: ${g.grund}`);
};

/** Every line `key=value` of every unit */
const zeilen = (q: Quadlets, schluessel: string): string[] =>
  Object.values(q.units).flatMap((t) =>
    t
      .split("\n")
      .filter((z) => z.startsWith(`${schluessel}=`))
      .map((z) => z.slice(schluessel.length + 1)),
  );

/** Every name the installation gives to something on the server */
const namen = (q: Quadlets): string[] => [
  ...Object.keys(q.units),
  ...Object.keys(q.systemd),
  ...Object.keys(q.secrets),
  ...["ContainerName", "NetworkName", "VolumeName"].flatMap((s) => zeilen(q, s)),
  ...(q.pforte ? [q.pforte["@id"]] : []),
];

/** Every host port the installation takes */
const hostPorts = (q: Quadlets): string[] =>
  zeilen(q, "PublishPort").map((p) => p.split(":").at(-2) ?? "");

describe("two installations of the same app", () => {
  it.each(["haben", "stellwerk", "beispiel"])("%s: share no name and no port", (app) => {
    const m = app === "beispiel" ? beispiel() : appManifest(app);
    const optionen = m.optionen.map((o) => o.id);
    const a = gerendert(testAnfrage(m, optionen, "a1", 20001));
    const b = gerendert(testAnfrage(m, optionen, "b2", 20002));
    expect(namen(a).filter((n) => namen(b).includes(n))).toEqual([]);
    expect(hostPorts(a).filter((p) => hostPorts(b).includes(p))).toEqual([]);
    for (const n of namen(a)) expect(n.startsWith("a1")).toBe(true);
  });
});

describe("generated values", () => {
  it("an auto secret stays the same on every rendering: rendering generates nothing", () => {
    const a = testAnfrage(appManifest("haben"), []);
    a.einstellungen.auto.BETTER_AUTH_SECRET = "der-gespeicherte-wert";
    const [erst, dann] = [gerendert(a), gerendert(a)];
    expect(erst).toEqual(dann);
    expect(erst.secrets["haben-k1-better-auth-secret"]).toBe("der-gespeicherte-wert");
  });

  it("refuses a generated value that was not passed in", () => {
    const a = testAnfrage(appManifest("haben"), []);
    delete a.einstellungen.auto.BETTER_AUTH_SECRET;
    expect(gruende(a)).toEqual([
      expect.stringMatching(/^env\.\d+: BETTER_AUTH_SECRET is generated once by the Zentrale/),
    ]);
  });

  it("refuses a required value that is missing", () => {
    const a = testAnfrage(appManifest("haben"), []);
    delete a.einstellungen.betreiber.ELSTER_HERSTELLER_ID;
    expect(gruende(a)).toEqual([expect.stringContaining("ELSTER_HERSTELLER_ID is required")]);
  });

  it("fills templates: a secret inside a URL, the assigned port, the host", () => {
    const h = gerendert(testAnfrage(appManifest("haben"), []));
    expect(h.secrets["haben-k1-database-url"]).toBe(
      "postgres://haben:test-erzeugt-postgres_password@db:5432/haben",
    );
    const s = gerendert(testAnfrage(appManifest("stellwerk"), [], "s1", 20001));
    expect(zeilen(s, "Environment")).toContain(
      '"STELLWERK_HUB_ADDRESS=tcp://s1.kunde.example:20101"',
    );
    expect(zeilen(s, "PublishPort")).toContain("20101:22001/tcp");
  });

  it("leaves out an empty optional secret: Podman refuses a secret of 0 bytes", () => {
    // containers/common pkg/secrets/secrets.go (Podman v4.9.0): "secret data must be larger than 0"
    const a = testAnfrage(appManifest("haben"), []);
    a.einstellungen.betreiber.ANTHROPIC_API_KEY = "";
    const q = gerendert(a);
    expect(Object.values(q.secrets)).not.toContain("");
    expect(q.units["haben-k1-app.container"]).not.toContain("target=ANTHROPIC_API_KEY");
  });

  it("uses a default and writes secrets only as Podman secrets", () => {
    const h = gerendert(testAnfrage(appManifest("haben"), []));
    expect(zeilen(h, "Environment")).toContain('"OIDC_ONLY=false"');
    expect(zeilen(h, "Secret")).toContain("haben-k1-database-url,type=env,target=DATABASE_URL");
    for (const wert of Object.values(h.secrets))
      for (const text of Object.values(h.units)) expect(text).not.toContain(wert);
  });
});

describe("options", () => {
  it("switch on their containers and their settings", () => {
    const m = appManifest("kontext");
    const ohne = gerendert(testAnfrage(m, []));
    const mit = gerendert(testAnfrage(m, ["documents"]));
    expect(Object.keys(ohne.units)).not.toContain("kontext-k1-schreibzeug.container");
    expect(Object.keys(mit.units)).toContain("kontext-k1-schreibzeug.container");
    expect(ohne.units["kontext-k1-caddy.container"]).not.toContain("SCHREIBZEUG_URL");
    expect(mit.units["kontext-k1-caddy.container"]).toContain(
      '"SCHREIBZEUG_URL=test-schreibzeug_url"',
    );
    expect(ohne.systemd["kontext-k1.slice"]).toContain("MemoryMax=4096M");
    expect(mit.systemd["kontext-k1.slice"]).toContain("MemoryMax=5120M");
  });

  it("refuses an option the manifest does not have", () => {
    expect(gruende(testAnfrage(appManifest("haben"), ["gibt-es-nicht"]))).toEqual([
      "installation.optionen: no option named gibt-es-nicht",
    ]);
  });
});

describe("containers", () => {
  it("are reachable under their manifest name and run in the installation's slice", () => {
    const h = gerendert(testAnfrage(appManifest("haben"), []));
    const app = h.units["haben-k1-app.container"] ?? "";
    expect(app).toContain("Network=haben-k1.network:alias=app\n");
    expect(app).toContain("Slice=haben-k1.slice\n");
    expect(app).toContain("Requires=haben-k1-db.service\nAfter=haben-k1-db.service\n");
    expect(h.units["haben-k1.network"]).toContain("NetworkName=haben-k1\n");
    expect(h.units["haben-k1-belege.volume"]).toContain("VolumeName=haben-k1-belege\n");
  });

  it("write argv as Exec= in quotes, the empty word kept out", () => {
    const k = gerendert(testAnfrage(appManifest("kontext"), []));
    expect(k.units["kontext-k1-livekit.container"]).toContain(
      'Exec="--config" "/etc/livekit.yaml" "--udp-port" "7882"\n',
    );
    const m = beispiel();
    for (const argv of [
      ["worker", ""],
      ["worker", "a\nb"],
    ]) {
      const kaputt = {
        ...m,
        container: [{ ...m.container[0], argv } as Manifest["container"][number]],
      };
      expect(gruende(testAnfrage(kaputt, []))).toEqual([
        "container.0.argv.1: an argument is empty or has a control character; Quadlet drops an empty one",
      ]);
    }
  });

  it("refuse a lone ; in argv: Quadlet writes it bare and systemd splits ExecStart= there", () => {
    // Quadlet v4.9.0 and v5 turn Exec="redis-server" ";" "x" into ExecStart=… redis-server ; x, and
    // systemd 255 refuses the service: "more than one ExecStart= setting" (systemd.service(5))
    const m = beispiel();
    const kaputt = {
      ...m,
      container: [
        { ...m.container[0], argv: ["worker", ";", "x"] } as Manifest["container"][number],
      ],
    };
    expect(gruende(testAnfrage(kaputt, []))).toEqual([
      expect.stringMatching(/^container\.0\.argv\.1: /),
    ]);
  });

  it("mount their files read-only from the installation's home", () => {
    const k = gerendert(testAnfrage(appManifest("kontext"), []));
    expect(k.units["kontext-k1-livekit.container"]).toContain(
      "Volume=%h/.config/steuerzentrale/dateien/livekit/etc/livekit.yaml:/etc/livekit.yaml:ro\n",
    );
    expect(k.dateien["livekit/etc/livekit.yaml"]).toContain("port: 7880");
  });

  it("refuse a value with a control character for Environment=, but not for a secret", () => {
    const a = testAnfrage(appManifest("haben"), []);
    a.einstellungen.betreiber.FINTS_PRODUKT_ID = "zeile\nzwei";
    a.einstellungen.betreiber.ANTHROPIC_API_KEY = "geheim\nmit zeilen";
    expect(gruende(a)).toEqual([
      "container.0.env.6: the value of FINTS_PRODUKT_ID has a control character",
    ]);
  });

  it("refuse a path that would leave its place", () => {
    const m = beispiel();
    const c = {
      ...m.container[0],
      volumes: [{ name: "daten", pfad: "/daten/../etc" }],
    } as Manifest["container"][number];
    expect(gruende(testAnfrage({ ...m, container: [c] }, []))).toEqual([
      expect.stringMatching(/^container\.0\.volumes\.0\.pfad: /),
    ]);
  });
});

describe("apps without an image", () => {
  it.each(["belegt", "fixpunkt", "kennwort", "soll"])("%s is refused with the reason", (app) => {
    const r = gruende(testAnfrage(appManifest(app), []));
    expect(r).toContainEqual(
      expect.stringMatching(/^container\.0\.image: app has no published image \(.+\)/),
    );
  });
});

describe("the installation", () => {
  it.each([
    [{ name: "Gross" }, "installation.name"],
    [{ name: "x".repeat(30) }, "installation.name"],
    [{ host: "a b.example" }, "installation.host"],
    [{ adresse: "http://haben-k1.kunde.example" }, "installation.adresse"],
    [{ httpPort: null }, "installation.httpPort"],
    [{ httpPort: 70000 }, "installation.httpPort"],
  ])("%j is refused", (aenderung, feld) => {
    const a = testAnfrage(appManifest("haben"), []);
    expect(
      gruende({ ...a, installation: { ...a.installation, ...aenderung } }).join("\n"),
    ).toContain(feld);
  });

  it("refuses a port taken twice", () => {
    const a = testAnfrage(appManifest("stellwerk"), []);
    a.installation.ports["zentrale:22001"] = a.installation.httpPort ?? 0;
    expect(gruende(a)).toEqual(["netz.ports.0: host port 20001 is taken twice"]);
  });
});

describe("the Pforte's route", () => {
  it("proxies the host to 127.0.0.1 with the limits of the manifest", () => {
    const q = gerendert(testAnfrage(appManifest("stellwerk"), [], "s1", 20005));
    expect(q.pforte).toEqual({
      "@id": "s1",
      match: [{ host: ["s1.kunde.example"] }],
      handle: [
        { handler: "request_body", max_size: 10 * 1024 * 1024 },
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: "127.0.0.1:20005" }],
          transport: { protocol: "http", response_header_timeout: "60s" },
          headers: {
            request: {
              set: { "X-Forwarded-For": ["{http.request.remote.host}"] },
              delete: ["Forwarded", "X-Real-IP"],
            },
          },
          stream_close_delay: "5m",
        },
      ],
      terminal: true,
    });
  });

  it("flushes at once for server-sent events and is null for a proxy of its own", () => {
    const f = { ...appManifest("fixpunkt"), container: appManifest("schreibzeug").container };
    const q = gerendert(testAnfrage({ ...f, env: [], optionen: [] }, []));
    expect(q.pforte?.handle[1]).toMatchObject({ flush_interval: -1 });
    expect(gerendert(testAnfrage(appManifest("kontext"), [])).pforte).toBeNull();
  });
});
