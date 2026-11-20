import { m } from "@steuerzentrale/ui";
import {
  Archive,
  Clock,
  Container,
  Cpu,
  HardDrive,
  type IconNode,
  Lock,
  Plug,
  Power,
  ShieldCheck,
} from "@steuerzentrale/ui/icons";
import { titel } from "../daten/ableitungen.ts";
import type { Bestand, Server } from "../daten/typen.ts";
import type { Pruefung } from "../daten/zustand.ts";
import { prozent, zahl } from "../format/zahl.ts";
import { vor } from "../format/zeit.ts";

/** The texts of a server's agent and checks */

export const agentText = (b: Bestand, sv: Server): string => {
  const seit = vor(sv.agent.letzteMeldung, b.jetzt);
  if (sv.agent.zustand === "verbunden") return m.agent_verbunden_seit({ seit });
  return sv.agent.zustand === "still"
    ? m.agent_still_seit({ seit })
    : m.agent_getrennt_seit({ seit });
};

type PruefText = { icon: IconNode; name: string; detail: string };

const plattenDetail = (p: Extract<Pruefung, { art: "platte" }>) =>
  p.grenze === null
    ? m.pruefung_platte({ prozent: prozent(p.prozent) })
    : m.pruefung_platte_grenze({ prozent: prozent(p.prozent), grenze: prozent(p.grenze) });

/** Name, icon and detail of a check, from what the agent measured */
export const pruefText = (b: Bestand, p: Pruefung): PruefText => {
  switch (p.art) {
    case "kernel":
      return {
        icon: Cpu,
        name: m.pruefung_kernel(),
        detail: p.ok
          ? m.pruefung_kernel_aktuell({ version: p.laeuft })
          : m.pruefung_kernel_alt({ laeuft: p.laeuft, installiert: p.installiert }),
      };
    case "sicherheitsupdates":
      return {
        icon: ShieldCheck,
        name: m.pruefung_sicherheitsupdates(),
        detail: p.ok ? m.pruefung_updates_alle() : m.pruefung_updates_offen({ n: p.anzahl }),
      };
    case "neustart":
      return {
        icon: Power,
        name: m.pruefung_neustart(),
        detail: p.ok
          ? m.pruefung_neustart_nein()
          : m.pruefung_neustart_geplant({ zeit: p.wartung }),
      };
    case "podman":
      return {
        icon: Container,
        name: m.pruefung_podman(),
        detail: m.pruefung_podman_detail({ version: p.version }),
      };
    case "platte":
      return { icon: HardDrive, name: m.pruefung_platte_name(), detail: plattenDetail(p) };
    case "ports":
      return {
        icon: Plug,
        name: m.pruefung_ports(),
        detail: m.pruefung_ports_detail({ ports: p.ports.join(", ") }),
      };
    case "zertifikate":
      return {
        icon: Lock,
        name: m.pruefung_zertifikate(),
        detail: m.pruefung_zertifikate_detail({ tage: p.tage }),
      };
    case "backups":
      return {
        icon: Archive,
        name: m.pruefung_backups(),
        detail: p.ok
          ? m.pruefung_backups_ok()
          : m.pruefung_backups_alt({ namen: p.alt.map((i) => titel(b, i)).join(", ") }),
      };
    case "uhrzeit":
      return {
        icon: Clock,
        name: m.pruefung_uhrzeit(),
        detail: m.pruefung_uhrzeit_detail({ ms: zahl(p.ms) }),
      };
  }
};
