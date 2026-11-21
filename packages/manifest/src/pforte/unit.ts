import { systemdWort, unitText, type Zeile } from "../quadlet/systemd.ts";
import { PFORTE_IMAGE } from "../system.ts";
import { PFORTE_ADMIN_IM_CONTAINER } from "./grund.ts";

/*
 * The Quadlet unit of the Pforte under the Linux user sz-pforte (docs/plan.md, "Pforte";
 * podman-systemd.unit(5) of Podman v4.9.0): Caddy by digest from system.ts, rootless with
 * Network=host, so it takes 80 and 443 itself (net.ipv4.ip_unprivileged_port_start=80, install.sh)
 * and reaches each installation on 127.0.0.1:<port>. No AutoUpdate: Caddy is updated with the agent.
 * The admin API listens on a Unix socket (CADDY_ADMIN, admin.go: DefaultAdminListen), in a folder of
 * the user's home; the agent loads the base configuration through it (grund.ts) and Caddy resumes
 * from its autosave after a restart (`caddy run --resume`, cmd/commandfuncs.go). The image has no
 * ENTRYPOINT, so Exec= is the whole command.
 */

export const PFORTE_UNIT = "sz-pforte.container";
/** The folder of the admin socket, relative to the home of sz-pforte */
export const PFORTE_ADMIN_VERZEICHNIS = "pforte";

const wort = (text: string): string => systemdWort(text) ?? "";

const container: Zeile[] = [
  ["ContainerName", "sz-pforte"],
  ["Image", PFORTE_IMAGE.image],
  ["Network", "host"],
  ["NoNewPrivileges", "true"],
  ["Environment", wort(`CADDY_ADMIN=unix/${PFORTE_ADMIN_IM_CONTAINER}`)],
  ["Volume", `%h/${PFORTE_ADMIN_VERZEICHNIS}:/run/pforte`],
  // certificates and the local CA (XDG_DATA_HOME of the image), and the autosaved configuration
  ["Volume", "sz-pforte-daten:/data"],
  ["Volume", "sz-pforte-konfig:/config"],
  ["Exec", ["caddy", "run", "--resume"].map(wort).join(" ")],
];

export const pforteUnit = (): string =>
  unitText(`Pforte (Caddy ${PFORTE_IMAGE.tag}), rendered by the Steuerzentrale; do not edit`, [
    { name: "Unit", zeilen: [["Description", "Pforte der Steuerzentrale (Caddy)"]] },
    { name: "Container", zeilen: container },
    {
      name: "Service",
      zeilen: [
        // Podman does not create the source of a bind mount
        ["ExecStartPre", `/usr/bin/mkdir -p %h/${PFORTE_ADMIN_VERZEICHNIS}`],
        ["Restart", "always"],
        ["TimeoutStartSec", "900"],
      ],
    },
    { name: "Install", zeilen: [["WantedBy", "default.target"]] },
  ]);
