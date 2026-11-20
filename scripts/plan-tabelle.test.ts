import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Manifest, manifestPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { manifestDateien } from "./manifeste-signieren.ts";

/*
 * The table "Die Apps der Speicherstadt" in docs/plan.md against the manifests (Z-203): the table is
 * read from the file, each cell is computed from the manifest. When a manifest differs because of a
 * source, the table is corrected, never the other way round.
 */

const root = join(import.meta.dirname, "..");

type Zeile = Record<string, string>;

const tabelleLesen = (plan: string): Zeile[] => {
  const abschnitt = /## Die Apps der Speicherstadt\n([\s\S]*?)\n## /.exec(plan)?.[1] ?? "";
  const zeilen = abschnitt.split("\n").filter((z) => z.startsWith("|"));
  const zellen = (z: string) =>
    z
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
  const [kopf = [], , ...rest] = zeilen.map(zellen);
  return rest.map((r) => Object.fromEntries(kopf.map((k, i) => [k, r[i] ?? ""])));
};

const janein = (wert: boolean) => (wert ? "ja" : "nein");

const portText = (p: Manifest["netz"]["ports"][number]): string =>
  `${p.port}${p.bis ? `-${p.bis}` : ""}${p.proto === "udp" ? "/udp" : ""}${p.fest ? "" : " (je Installation)"}`;

/** Ports of the app's own containers; an option's ports as "<option> (Option)" */
const portsText = (m: Manifest): string => {
  const optionVon = new Map(
    m.optionen.flatMap((o) => o.container.map((c) => [c.name, o.id] as const)),
  );
  const teile: string[] = [];
  for (const p of m.netz.ports) {
    const option = optionVon.get(p.dienst);
    const text = option ? `${option} (Option)` : portText(p);
    if (!teile.includes(text)) teile.push(text);
  }
  return teile.length === 0 ? "–" : teile.join(", ");
};

const healthText = (h: Manifest["health"]): string => {
  if (h.art === "http") return `http ${h.pfad}`;
  if (h.art === "tcp") return `tcp ${h.port}`;
  if (h.art === "befehl") return `befehl ${h.befehl}`;
  return "keine";
};

/** The row as the manifest says it; Health "keine" may carry a reason in parentheses */
const zeileAusManifest = (m: Manifest): Zeile => ({
  App: m.id,
  Container: [
    ...m.container.map((c) => c.name),
    ...m.optionen.flatMap((o) => o.container.map((c) => `${c.name} (Option)`)),
  ].join(", "),
  Arch: m.architektur.join(", "),
  RAM: String(m.ressourcen.ram_mb),
  HTTP: m.proxy === "eigen" ? "eigen" : janein(m.netz.http !== null),
  Ports: portsText(m),
  IPv4: janein(m.netz.oeffentliche_ipv4),
  "Für sich": janein(m.netz.server_fuer_sich),
  Anmeldung: m.anmeldung,
  Health: healthText(m.health),
  Image: m.container.every((c) => typeof c.image === "string") ? "ja" : "noch nicht",
});

const manifeste = manifestDateien().map((datei) => {
  const geprueft = manifestPruefen(readFileSync(datei, "utf8"));
  if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
  return geprueft.manifest;
});
const tabelle = tabelleLesen(readFileSync(join(root, "docs/plan.md"), "utf8"));

describe('the table "Die Apps der Speicherstadt" in docs/plan.md', () => {
  it("has one row per manifest", () => {
    expect(tabelle.map((z) => z.App).sort()).toEqual(manifeste.map((m) => m.id).sort());
  });

  it.each(manifeste.map((m) => [m.id, m] as const))("matches the manifest of %s", (id, m) => {
    const zeile = tabelle.find((z) => z.App === id);
    const health = (zeile?.Health ?? "").replace(/\s*\(.*\)$/, "");
    expect({ ...zeile, Health: health }).toEqual(zeileAusManifest(m));
  });
});

describe("reading the table", () => {
  it("takes the header as keys and each row's cells", () => {
    const plan =
      "## Die Apps der Speicherstadt\n\n| App | RAM |\n| --- | --- |\n| haben | 2048 |\n\n## Manifest\n";
    expect(tabelleLesen(plan)).toEqual([{ App: "haben", RAM: "2048" }]);
  });
});
