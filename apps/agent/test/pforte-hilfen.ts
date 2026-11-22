import { networkInterfaces } from "node:os";
import { type Abschnitt, PFORTE_ADMIN_VERZEICHNIS } from "@steuerzentrale/manifest";

/*
 * Helpers of the Pforte's test with real Podman and Caddy (pforte.agent.test.ts, CI only): commands
 * with their output, Podman as another Linux user, the Pforte's unit as `podman run`, curl against
 * the Pforte with its own CA and SNI, and a probe that tries a connection from inside a container.
 */

export type Lauf = { code: number; aus: string; fehler: string };

export const lauf = (argv: string[], timeout = 120_000): Lauf => {
  const l = Bun.spawnSync(argv, { cwd: "/", timeout, stdout: "pipe", stderr: "pipe" });
  return { code: l.exitCode ?? -1, aus: l.stdout.toString(), fehler: l.stderr.toString() };
};

/** Runs or throws with the command and what it wrote, so a broken setup says where it broke */
export const muss = (argv: string[], timeout?: number): string => {
  const l = lauf(argv, timeout);
  if (l.code !== 0) throw new Error(`${argv.join(" ")} ended with ${l.code}:\n${l.fehler}${l.aus}`);
  return l.aus.trim();
};

/**
 * Podman as a Linux user of its own, as each installation has (docs/plan.md, "Pforte"): its own
 * rootless network namespace. ci.yml makes the users with lingering, so /run/user/<uid> is there.
 * `env -i`: the runner's sudo passes its environment on (XDG_CONFIG_HOME and the like), and Podman
 * would then read the runner's ~/.config, which the user may not
 */
export const alsNutzer = (nutzer: string) => {
  const uid = muss(["id", "-u", nutzer]);
  return (...argv: string[]): string[] => [
    "sudo",
    "-n",
    "-u",
    nutzer,
    "env",
    "-i",
    `HOME=/home/${nutzer}`,
    `USER=${nutzer}`,
    `LOGNAME=${nutzer}`,
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    `XDG_RUNTIME_DIR=/run/user/${uid}`,
    ...argv,
  ];
};

/** The words of a unit value written by systemdWort: "a" "b c" → a, b c */
export const woerter = (wert: string): string[] =>
  [...wert.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? "").replaceAll(/\\(.)/g, "$1"));

/**
 * The Container section of the Pforte's unit as `podman run` arguments, so the test runs what the
 * unit says (systemd does not run the runner's user services). `%h/pforte` becomes the test's
 * folder, the volumes and the name get the test's prefix; a key the test cannot map fails it
 */
export const pforteRunArgumente = (
  container: Abschnitt,
  name: string,
  ordner: string,
): { argumente: string[]; image: string; exec: string[] } => {
  let image = "";
  let exec: string[] = [];
  const argumente = container.zeilen.flatMap(([k, w]): string[] => {
    switch (k) {
      case "ContainerName":
        return ["--name", name];
      case "Image":
        image = w;
        return [];
      case "Network":
        return ["--network", w];
      case "NoNewPrivileges":
        return w === "true" ? ["--security-opt", "no-new-privileges"] : [];
      case "Environment":
        return woerter(w).flatMap((e) => ["--env", e]);
      case "Volume":
        return [
          "--volume",
          w
            .replace(`%h/${PFORTE_ADMIN_VERZEICHNIS}:`, `${ordner}:`)
            .replace(/^sz-pforte-/, `${name}-`),
        ];
      case "Exec":
        exec = woerter(w);
        return [];
      default:
        throw new Error(`the test cannot run the key ${k} of the Pforte's unit`);
    }
  });
  return { argumente, image, exec };
};

/** An IPv4 address of the runner other than loopback: a client the Pforte sees as itself */
export const hostIp = (): string => {
  const ip = Object.entries(networkInterfaces())
    .filter(([n]) => !/^(lo|docker|podman|cni|veth|br-|virbr|incus|tap)/.test(n))
    .flatMap(([, a]) => a ?? [])
    .find((a) => a.family === "IPv4" && !a.internal)?.address;
  if (!ip)
    throw new Error(`no IPv4 address besides loopback: ${JSON.stringify(networkInterfaces())}`);
  return ip;
};

export type Antwort = { status: string; body: string };

/** curl's output with `-w "\n%{http_code}"`: the body, then the status ("000" without one) */
export const antwortLesen = (aus: string): Antwort => {
  const i = aus.lastIndexOf("\n");
  return { status: aus.slice(i + 1).trim(), body: aus.slice(0, Math.max(i, 0)) };
};

export type PforteZiel = { ip: string; port: number; ca: string };

/** curl against the Pforte under a host name: SNI and Host as on the internet, its CA trusted */
export const curlArgv = (ziel: PforteZiel, host: string, extra: string[]): string[] => [
  "curl",
  "-sS",
  "--max-time",
  "10",
  "--cacert",
  ziel.ca,
  "--resolve",
  `${host}:${ziel.port}:${ziel.ip}`,
  ...extra,
];

const mitStatus = (ziel: PforteZiel, host: string, pfad: string, extra: string[]) =>
  curlArgv(ziel, host, ["-w", "\n%{http_code}", ...extra, `https://${host}:${ziel.port}${pfad}`]);

/** One request, waiting for it (blocks the test's thread) */
export const pforteCurl =
  (ziel: PforteZiel) =>
  (host: string, pfad: string, extra: string[] = []): Antwort =>
    antwortLesen(lauf(mitStatus(ziel, host, pfad, extra)).aus);

/** One request in its own process, so that others go on meanwhile */
export const pforteCurlNebenher =
  (ziel: PforteZiel) =>
  async (host: string, pfad: string): Promise<Antwort> => {
    const p = Bun.spawn(mitStatus(ziel, host, pfad, []), { stdout: "pipe", stderr: "ignore" });
    const aus = await new Response(p.stdout).text();
    await p.exited;
    return antwortLesen(aus);
  };

/**
 * Tries a URL from inside a container with the image's Bun, 3 s at most: "erreicht <status>" or
 * "nicht erreicht <reason>"
 */
export const SONDE = `(async () => {
  try {
    const r = await fetch(process.env.ZIEL, { signal: AbortSignal.timeout(3000) });
    console.log("erreicht " + r.status);
  } catch (e) {
    console.log("nicht erreicht " + (e && (e.code || e.name)));
  }
})();`;
