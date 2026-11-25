import type { PruefungName, Serverpruefung } from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import {
  Archive,
  Clock,
  Container,
  Cpu,
  HardDrive,
  type IconNode,
  Lock,
  MemoryStick,
  Plug,
  Power,
  ShieldCheck,
} from "@steuerzentrale/ui/icons";
import type { ServerPruefung } from "../daten/server.ts";
import type { AgentZustand, Bestand } from "../daten/typen.ts";
import { PLATTE_STOERUNG, PLATTE_WARNUNG, type Pruefung } from "../daten/zustand.ts";
import { prozent, zahl } from "../format/zahl.ts";
import { vor } from "../format/zeit.ts";

/** The texts of a server's agent and checks */

/** The agent's state and its last sign of life; a server of the demo or one of the Zentrale */
export const agentText = (
  b: Pick<Bestand, "jetzt">,
  sv: { agent: { zustand: AgentZustand; letzteMeldung: number | null } },
): string => {
  if (sv.agent.letzteMeldung === null) return m.agent_noch_nie();
  const seit = vor(sv.agent.letzteMeldung, b.jetzt);
  if (sv.agent.zustand === "verbunden") return m.agent_verbunden_seit({ seit });
  return sv.agent.zustand === "still"
    ? m.agent_still_seit({ seit })
    : m.agent_getrennt_seit({ seit });
};

export type PruefText = { icon: IconNode; name: string; detail: string };

/** Name, icon and detail of a check of the operating system (demo only) */
export const pruefText = (p: Pruefung): PruefText => {
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
  }
};

/** The icon of a check of Z-702 */
export const PRUEFUNG_ICONS: Record<PruefungName, IconNode> = {
  platte: HardDrive,
  zertifikate: Lock,
  backups: Archive,
  ports: Plug,
  uhrzeit: Clock,
  arbeitsspeicher: MemoryStick,
};

/** The name of a check of Z-702 in the interface's language */
export const pruefungName = (p: PruefungName): string =>
  ({
    platte: m.pruefung_platte_name,
    zertifikate: m.pruefung_zertifikate,
    backups: m.pruefung_backups,
    ports: m.pruefung_ports,
    uhrzeit: m.pruefung_uhrzeit,
    arbeitsspeicher: m.pruefung_arbeitsspeicher,
  })[p]();

type Ergebnis<P extends PruefungName> = Extract<Serverpruefung, { pruefung: P }>;

const TAG = 86_400_000;

/** The fullest disk, with the limit it is over */
const plattenDetail = (p: Ergebnis<"platte">): string => {
  const voll = p.platten?.[0];
  if (!voll) return m.pruefung_unbekannt();
  const wert = prozent(voll.prozent, voll.prozent % 1 === 0 ? 0 : 1);
  const grenze = p.ergebnis === "rot" ? PLATTE_STOERUNG : PLATTE_WARNUNG;
  const text =
    p.ergebnis === "gruen"
      ? m.pruefung_platte({ prozent: wert })
      : m.pruefung_platte_grenze({ prozent: wert, grenze: prozent(grenze) });
  return voll.mount === "/" ? text : m.pruefung_platte_mount({ mount: voll.mount, text });
};

/** The certificate that expires first */
const zertifikatDetail = (p: Ergebnis<"zertifikate">, jetzt: number): string => {
  if (!p.zertifikate) return m.pruefung_unbekannt();
  const z = p.zertifikate[0];
  if (!z) return m.pruefung_zertifikate_keine();
  if (z.gueltigBis <= jetzt) return m.pruefung_zertifikate_abgelaufen({ host: z.host });
  return m.pruefung_zertifikate_host({
    host: z.host,
    tage: Math.ceil((z.gueltigBis - jetzt) / TAG),
  });
};

const uhrDetail = (p: Ergebnis<"uhrzeit">): string => {
  const teile: string[] = [
    ...(p.synchron === true ? [m.pruefung_uhrzeit_synchron()] : []),
    ...(p.synchron === false ? [m.pruefung_uhrzeit_nicht_synchron()] : []),
    ...(p.abweichungMs === null
      ? []
      : [m.pruefung_uhrzeit_abweichung({ ms: zahl(p.abweichungMs) })]),
  ];
  return teile.length > 0 ? teile.join(", ") : m.pruefung_unbekannt();
};

const portsDetail = (p: Ergebnis<"ports">): string => {
  if (!p.fremd) return m.pruefung_unbekannt();
  if (p.fremd.length === 0) return m.pruefung_ports_ok();
  return m.pruefung_ports_fremd({ ports: p.fremd.map((x) => `${x.port}/${x.proto}`).join(", ") });
};

/** What a check of Z-702 measured, as one line */
export const pruefungDetail = (p: Serverpruefung, jetzt: number): string => {
  switch (p.pruefung) {
    case "platte":
      return plattenDetail(p);
    case "zertifikate":
      return zertifikatDetail(p, jetzt);
    case "backups":
      return p.alt.length === 0
        ? m.pruefung_backups_ok()
        : m.pruefung_backups_alt({ namen: p.alt.map((i) => i.name).join(", ") });
    case "ports":
      return portsDetail(p);
    case "uhrzeit":
      return uhrDetail(p);
    case "arbeitsspeicher":
      return p.prozent === null
        ? m.pruefung_unbekannt()
        : m.pruefung_arbeitsspeicher_detail({ prozent: prozent(p.prozent, 1) });
  }
};

/** Name, icon and detail of a check of Z-702, from what the Zentrale rated */
export const serverPruefungText = (p: ServerPruefung, jetzt: number): PruefText => ({
  icon: PRUEFUNG_ICONS[p.pruefung],
  name: pruefungName(p.pruefung),
  detail: pruefungDetail(p, jetzt),
});
