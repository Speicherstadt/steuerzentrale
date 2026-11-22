import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PFORTE_AKTIONEN,
  PFORTE_IMAGE,
  PFORTE_UNIT,
  pforteGrundkonfiguration,
  pforteUnit,
  schluesselLesen,
  signiertesManifestLaden,
  unitLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { auftraegeAnnehmen } from "../src/auftraege/auftraege.ts";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { speicher, TEST_PUB } from "../src/beitritt/testhilfen.ts";
import { installationenAuf } from "../src/einrichtung/testauftraege.ts";
import { testSystem } from "../src/einrichtung/testsystem.ts";
import { adminUeberSocket } from "../src/pforte/admin.ts";
import {
  alsNutzer,
  curlArgv,
  hostIp,
  lauf,
  muss,
  pforteCurl,
  pforteCurlNebenher,
  pforteRunArgumente,
  SONDE,
} from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-401 with real Podman and Caddy (CI only, `bun run test:agent`): the Pforte runs from
 * its rendered unit (Caddy by digest, rootless, Network=host) with the local CA (`tls internal`) on
 * high ports; two installations of the example app, each as a Linux user of its own (as on a
 * server, sz-<installation>) in its own network and published only on 127.0.0.1:<port>, get their
 * routes by jobs of the Pforte through the agent's job handling and Caddy's admin API.
 * Checked: both answer under their host names, the client's real address arrives in X-Forwarded-For
 * and a forged one does not, the upload limit of the manifest holds, A cannot reach B's port, and
 * removing B's route interrupts neither a running connection to A nor requests to A meanwhile.
 * The users come from ci.yml (SZ_TEST_PFORTE_NUTZER); without them the test cannot separate the
 * installations as a server does, so CI fails and a local run skips it.
 */
const podman = requirePodman(process.env.CI === "true");
const NUTZER = (process.env.SZ_TEST_PFORTE_NUTZER ?? "").split(/\s+/).filter(Boolean);
if (podman !== null && process.env.CI === "true" && NUTZER.length !== 2)
  throw new Error("SZ_TEST_PFORTE_NUTZER must name two Linux users (ci.yml, job agent)");
const bereit = podman !== null && NUTZER.length === 2;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_PFORTE_NUTZER is not set: the Pforte's test is skipped (it runs in CI)");

const HTTP_PORT = 28080;
const HTTPS_PORT = 28443;
const ZUFALL = crypto.randomUUID().slice(0, 6);
const PFORTE = `sz-test-pforte-${ZUFALL}`;
const ORDNER = mkdtempSync(join(tmpdir(), "sz-test-pforte-"));
const SOCKET = join(ORDNER, "admin", "admin.sock");

type Installation = {
  nutzer: string;
  name: string;
  host: string;
  port: number;
  subnetz: string;
  container: string;
};
const installation = (i: number, buchstabe: string): Installation => ({
  nutzer: NUTZER[i] ?? "",
  name: `sz-test-p${buchstabe}${ZUFALL}`,
  host: `${buchstabe}.sz-test.example`,
  port: 28511 + i,
  subnetz: `10.89.${200 + i}.0/24`,
  container: `sz-test-p${buchstabe}${ZUFALL}-app`,
});
const A = installation(0, "a");
const B = installation(1, "b");

const aufraeumen: (() => void)[] = [];
afterAll(() => {
  for (const f of aufraeumen.splice(0).reverse()) f();
  rmSync(ORDNER, { recursive: true, force: true });
});

// The example app's manifest 1.0.0, signed with the test key (beispiel-setup.ts builds it)
const manifestDateien = () => {
  const ordner = join(AUSGABE, "manifeste", "1.0.0");
  return {
    text: readFileSync(join(ordner, "manifest.yml"), "utf8"),
    signatur: readFileSync(join(ordner, "manifest.yml.minisig"), "utf8"),
  };
};

const schluessel = () => {
  const s = schluesselLesen(TEST_PUB);
  if (!s) throw new Error("test key");
  return s;
};

const admin = adminUeberSocket((url, init) => fetch(url, init), SOCKET);
const adminGet = async (pfad: string) => admin("GET", pfad, undefined, AbortSignal.timeout(5000));

const agent = () => {
  const gesendet: Record<string, unknown>[] = [];
  const a = auftraegeAnnehmen({
    dateien: speicher().dateien,
    pfad: "/z/auftraege.json",
    vertrauen: { schluessel: schluessel(), zweck: "test" },
    spawn: async () => {
      throw new Error("a job of the Pforte starts no process");
    },
    pforte: {
      admin,
      grund: pforteGrundkonfiguration({
        httpPort: HTTP_PORT,
        httpsPort: HTTPS_PORT,
        zertifikate: "intern",
      }),
    },
    // a job of the Pforte touches no installation's user
    installationen: installationenAuf(testSystem()),
    planen: (los, ms) => {
      const t = setTimeout(los, ms);
      return () => clearTimeout(t);
    },
    jetzt: Date.now,
    log: () => {},
  });
  const m = manifestDateien();
  const auftrag = async (i: Installation, aktion: string, nummer: string) => {
    const n: AuftragNachricht = {
      typ: "auftrag",
      protokoll: PROTOKOLL_VERSION,
      auftragId: `${aktion}-${i.name}-${nummer}`,
      installationId: i.name,
      aktion,
      argumente: aktion === PFORTE_AKTIONEN.setzen ? { host: i.host, port: i.port } : {},
      manifest: m.text,
      signatur: m.signatur,
      zeitlimitS: 60,
    };
    await a.empfangen(n, (t) => gesendet.push(JSON.parse(t)));
    return gesendet.at(-1);
  };
  return { auftrag };
};

const pforteLogs = () => {
  const l = lauf(["podman", "logs", "--tail", "60", PFORTE]);
  return `logs of the Pforte:\n${l.fehler}${l.aus}`;
};

/** Waits for a condition; on timeout says what it waited for, with the Pforte's last log lines */
const warten = async (was: string, pruefen: () => Promise<boolean> | boolean, ms = 60_000) => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (
      await Promise.resolve()
        .then(pruefen)
        .catch(() => false)
    )
      return;
    await Bun.sleep(250);
  }
  throw new Error(`${was}: not within ${ms / 1000} s\n${pforteLogs()}`);
};

const pforteStarten = async () => {
  const container = unitLesen(pforteUnit()).find((a) => a.name === "Container");
  if (!container) throw new Error("the Pforte's unit has no Container section");
  const { argumente, image, exec } = pforteRunArgumente(container, PFORTE, join(ORDNER, "admin"));
  muss(["mkdir", "-p", join(ORDNER, "admin")]);
  aufraeumen.push(() => {
    lauf(["podman", "rm", "-f", "-t", "0", PFORTE]);
    lauf(["podman", "volume", "rm", "-f", `${PFORTE}-daten`, `${PFORTE}-konfig`]);
  });
  muss(["podman", "run", "-d", ...argumente, image, ...exec], 300_000);
  await warten(
    `the Pforte's admin socket (${SOCKET})`,
    async () => existsSync(SOCKET) && (await adminGet("/config/")).status === 200,
  );
};

const installationStarten = async (i: Installation, image: string) => {
  const p = alsNutzer(i.nutzer);
  aufraeumen.push(() => {
    lauf(p("podman", "rm", "-f", "-t", "0", i.container));
    lauf(p("podman", "network", "rm", "-f", i.name));
  });
  muss(p("podman", "network", "create", "--subnet", i.subnetz, i.name));
  muss(
    p(
      "podman",
      "run",
      "-d",
      "--name",
      i.container,
      "--network",
      i.name,
      "--publish",
      `127.0.0.1:${i.port}:8080`,
      "--tls-verify=false",
      image,
    ),
    300_000,
  );
  await warten(`${i.name} on 127.0.0.1:${i.port}`, async () => {
    return (await fetch(`http://127.0.0.1:${i.port}/health`)).status === 200;
  });
};

/** From inside A's container, as A's user: reached or not */
const sonde = (ziel: string) =>
  muss(
    alsNutzer(A.nutzer)("podman", "exec", "-e", `ZIEL=${ziel}`, A.container, "bun", "-e", SONDE),
  );

const startzeit = () => muss(["podman", "inspect", "-f", "{{.State.StartedAt}}", PFORTE]);

describe.skipIf(!bereit)(
  "the Pforte with Caddy, two installations and their routes (Z-401)",
  () => {
    const IP = bereit ? hostIp() : "";
    const CA = join(ORDNER, "ca.pem");
    const ziel = { ip: IP, port: HTTPS_PORT, ca: CA };
    const curl = pforteCurl(ziel);
    const nebenher = pforteCurlNebenher(ziel);
    let j: ReturnType<typeof agent>;
    let gestartet = "";

    beforeAll(async () => {
      j = agent();
      const m = manifestDateien();
      const geladen = signiertesManifestLaden(
        new TextEncoder().encode(m.text),
        m.signatur,
        schluessel(),
      );
      if (!geladen.ok) throw new Error(geladen.fehler.join("\n"));
      const image = geladen.manifest.container[0]?.image;
      if (typeof image !== "string") throw new Error("the example app has no image");
      await pforteStarten();
      await installationStarten(A, image);
      await installationStarten(B, image);
    });

    it("runs from a unit Podman 4.9's generator accepts: Caddy by digest on the host's network", () => {
      const units = mkdtempSync(join(ORDNER, "units-"));
      writeFileSync(join(units, PFORTE_UNIT), pforteUnit());
      const generator = [
        "/usr/libexec/podman/quadlet",
        "/usr/lib/systemd/user-generators/podman-user-generator",
      ].find((g) => existsSync(g));
      if (!generator) throw new Error("no Quadlet generator");
      const l = Bun.spawnSync([generator, "--user", "--dryrun"], {
        env: { ...process.env, QUADLET_UNIT_DIRS: units },
      });
      const aus = l.stdout.toString();
      expect(l.exitCode, l.stderr.toString()).toBe(0);
      expect(aus).toContain(PFORTE_IMAGE.image);
      expect(aus).toMatch(/--network[ =]host/);
      expect(aus).not.toContain("io.containers.autoupdate");
      expect(aus).not.toContain("--publish");
    });

    it("gets both routes by jobs, loading its base configuration first, without a restart", async () => {
      gestartet = startzeit();
      expect(await j.auftrag(A, PFORTE_AKTIONEN.setzen, "1")).toMatchObject({
        ergebnis: { ok: true, daten: { geaendert: "neu" } },
      });
      expect(await j.auftrag(B, PFORTE_AKTIONEN.setzen, "1")).toMatchObject({
        ergebnis: { ok: true, daten: { geaendert: "neu" } },
      });
      const ca = JSON.parse((await adminGet("/pki/ca/local")).text) as { root_certificate: string };
      writeFileSync(CA, ca.root_certificate);
      expect(startzeit()).toBe(gestartet);
    });

    it("serves each installation under its host name with a certificate of the local CA", async () => {
      for (const i of [A, B])
        await warten(`https://${i.host} through the Pforte`, () => {
          return curl(i.host, "/health").status === "200";
        });
      const eintrag = curl(A.host, "/eintraege", ["-X", "POST", "--data", '{"text":"nur in A"}']);
      expect(eintrag.status).toBe("201");
      expect(curl(A.host, "/").body).toContain("nur in A");
      expect(curl(B.host, "/").body).not.toContain("nur in A");
      expect(JSON.parse(curl(B.host, "/anfrage").body)).toMatchObject({
        host: `${B.host}:${HTTPS_PORT}`,
      });
      expect(curl("unbekannt.sz-test.example", "/health").status).not.toBe("200");
    });

    it("hands the app the client's real address in X-Forwarded-For, never one the client sent", () => {
      expect(JSON.parse(curl(A.host, "/anfrage").body)).toMatchObject({ xForwardedFor: IP });
      for (const gefaelscht of ["203.0.113.66", "203.0.113.66, 198.51.100.1"]) {
        const sieht = JSON.parse(
          curl(A.host, "/anfrage", ["-H", `X-Forwarded-For: ${gefaelscht}`]).body,
        ) as { xForwardedFor: string };
        // the only, and so the last, entry is the address the Pforte saw (docs/plan.md, "Pforte")
        expect(sieht.xForwardedFor).toBe(IP);
        expect(sieht.xForwardedFor.split(",").at(-1)?.trim()).toBe(IP);
      }
    });

    it("keeps the upload limit of the manifest (max_body_mb: 1)", () => {
      const gross = join(ORDNER, "gross.json");
      writeFileSync(gross, JSON.stringify({ text: "x".repeat(2 * 1024 * 1024) }));
      const klein = join(ORDNER, "klein.json");
      writeFileSync(klein, JSON.stringify({ text: "x".repeat(512 * 1024) }));
      expect(curl(A.host, "/eintraege", ["--data-binary", `@${gross}`]).status).toBe("413");
      expect(curl(A.host, "/eintraege", ["--data-binary", `@${klein}`]).status).toBe("201");
    });

    it("does not let installation A reach the port of B, by any way round the Pforte", () => {
      // the probe works: A reaches itself
      expect(sonde("http://127.0.0.1:8080/health")).toBe("erreicht 200");
      const ipB = muss(
        alsNutzer(B.nutzer)(
          "podman",
          "inspect",
          "-f",
          "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
          B.container,
        ),
      );
      expect(ipB).toMatch(/^10\.89\.201\./);
      for (const ziel of [
        `http://127.0.0.1:${B.port}/health`,
        `http://${IP}:${B.port}/health`,
        // slirp4netns' address of the host's loopback, only with allow_host_loopback
        `http://10.0.2.2:${B.port}/health`,
        `http://host.containers.internal:${B.port}/health`,
        `http://${ipB}:8080/health`,
      ])
        expect(`${ziel}: ${sonde(ziel)}`).toMatch(new RegExp(`^${ziel}: nicht erreicht`));
    });

    it("removes B's route while A keeps answering, on one connection and on new ones", async () => {
      const urls = Array.from({ length: 40 }, () => [
        `https://${A.host}:${HTTPS_PORT}/health`,
        "-o",
        "/dev/null",
      ]).flat();
      // one connection kept alive for 4 s, 10 requests a second
      const verbindung = Bun.spawn(
        curlArgv(ziel, A.host, ["--rate", "10/s", "-w", "%{http_code}\n", ...urls]),
        { stdout: "pipe", stderr: "pipe" },
      );
      // and new connections meanwhile, each in a process of its own
      const neue: string[] = [];
      let weiter = true;
      const abfragen = (async () => {
        while (weiter) {
          neue.push((await nebenher(A.host, "/health")).status);
          await Bun.sleep(50);
        }
      })();
      await Bun.sleep(1000);
      expect(await j.auftrag(B, PFORTE_AKTIONEN.entfernen, "1")).toMatchObject({
        ergebnis: { ok: true, daten: { geaendert: "entfernt" } },
      });
      const codes = (await new Response(verbindung.stdout).text()).trim().split("\n");
      await verbindung.exited;
      weiter = false;
      await abfragen;
      expect(codes, await new Response(verbindung.stderr).text()).toEqual(Array(40).fill("200"));
      expect(neue.length).toBeGreaterThan(5);
      expect(neue.filter((s) => s !== "200")).toEqual([]);
      for (let n = 0; n < 5; n++) {
        expect(curl(B.host, "/health").status).not.toBe("200");
        expect(curl(A.host, "/health").status).toBe("200");
      }
      // removing it again changes nothing, and the Pforte never restarted
      expect(await j.auftrag(B, PFORTE_AKTIONEN.entfernen, "2")).toMatchObject({
        ergebnis: { ok: true, daten: { geaendert: "nichts" } },
      });
      expect(startzeit()).toBe(gestartet);
    });
  },
);
