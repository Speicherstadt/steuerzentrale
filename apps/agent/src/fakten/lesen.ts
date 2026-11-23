import { type Fakten, PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { bootIdLesen, gestartetAm, unattendedUpgrades } from "./betriebssystem.ts";
import { adressen, port25Ausgehend, ptrLesen } from "./netz.ts";
import { podmanVersion, updatesAusstehend } from "./pakete.ts";
import { platten } from "./platten.ts";
import { belegtePorts, offenePorts } from "./ports.ts";
import type { FaktenQuellen } from "./quellen.ts";
import { architektur, cpuKerne, kernel, neustartNoetig, osLesen, ramMb } from "./system.ts";
import { uhrSynchron } from "./uhr.ts";
import { zertifikateLesen } from "./zertifikate.ts";

/*
 * All facts of the server as one `fakten` message (BAULISTE.md Z-304; open ports, certificates and
 * the time service for the checks of Z-702). Each fact is read on its own and is null when it
 * cannot be read; one that fails never keeps the others from being sent.
 */

export type FaktenNachricht = typeof Fakten._output;

/** The boot and unattended-upgrades (Z-701) */
const bootLesen = async (q: FaktenQuellen) => {
  const [bootId, seit, unattended] = await Promise.all([
    bootIdLesen(q),
    gestartetAm(q),
    unattendedUpgrades(q),
  ]);
  return { bootId, gestartetAm: seit, unattendedUpgrades: unattended };
};

export const faktenLesen = async (
  q: FaktenQuellen,
  angaben: { jetzt: number; uhrzeitAbweichungMs: number | null },
): Promise<FaktenNachricht> => {
  const netz = adressen(q);
  const k = await kernel(q);
  const [offen, zertifikate, synchron] = await Promise.all([
    offenePorts(q),
    zertifikateLesen(q),
    uhrSynchron(q),
  ]);
  const [kerne, ram, plattenListe, os, neustart, updates, podman, ptr, ports, port25, boot] =
    await Promise.all([
      cpuKerne(q),
      ramMb(q),
      platten(q),
      osLesen(q),
      neustartNoetig(q, k),
      updatesAusstehend(q),
      podmanVersion(q),
      ptrLesen(q, [...netz.ipv4, ...netz.ipv6]),
      belegtePorts(q),
      port25Ausgehend(q),
      bootLesen(q),
    ]);
  return {
    typ: "fakten",
    protokoll: PROTOKOLL_VERSION,
    zeit: angaben.jetzt,
    cpuKerne: kerne,
    ramMb: ram,
    platten: plattenListe,
    architektur: architektur(q),
    os,
    kernel: k,
    neustartNoetig: neustart,
    updatesAusstehend: updates,
    podman,
    ipv4: netz.ipv4,
    ipv6: netz.ipv6,
    ptr,
    portsBelegt: ports,
    port25Ausgehend: port25,
    uhrzeitAbweichungMs: angaben.uhrzeitAbweichungMs,
    ...boot,
    portsOffen: offen,
    zertifikate,
    uhrSynchron: synchron,
  };
};

/**
 * How far the agent's clock is ahead (positive) of the Zentrale's: `willkommen` carries the
 * Zentrale's time, taken somewhere between sending `hallo` and receiving the answer; halfway is the
 * best guess (as NTP assumes), off by at most half the round trip
 */
export const uhrAbweichung = (t: { gesendet: number; empfangen: number; zentrale: number }) =>
  Math.round((t.gesendet + t.empfangen) / 2 - t.zentrale);
