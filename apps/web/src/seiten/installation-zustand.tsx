import { Icon, m } from "@steuerzentrale/ui";
import {
  Archive,
  CalendarX,
  ChartNoAxesColumn,
  Globe,
  LifeBuoy,
  Lock,
  Radar,
} from "@steuerzentrale/ui/icons";
import { Show } from "solid-js";
import {
  appVon,
  istAktuell,
  kundeVon,
  linuxNutzer,
  loeschungAm,
  monatVon,
  serverVon,
} from "../daten/ableitungen.ts";
import type { HealthDerZentrale } from "../daten/bewertung.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { welleVon } from "../daten/wellen.ts";
import { ZERTIFIKAT_TAGE } from "../daten/zustand.ts";
import { gb, prozent } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";
import { Angaben, Hinweisbox, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Pruefzeile } from "../teile/listen.tsx";
import { ZuKunde, ZuServer } from "../teile/verweise.tsx";
import { UnitsUndHealth } from "./installation-health.tsx";

/**
 * The tab "Zustand" of an installation the demo knows: units and health from the Zentrale (Z-403)
 * with the demo's backup, facts, the check from outside
 */

const Fakten = (props: { b: Bestand; i: Installation }) => {
  const app = () => appVon(props.b, props.i.app);
  const k = () => kundeVon(props.b, props.i.kunde);
  const sv = () => serverVon(props.b, props.i.server);
  const optionen = () =>
    app()
      .optionen.filter((o) => props.i.optionen.includes(o.id))
      .map((o) => o.name)
      .join(", ");
  return (
    <Karte>
      <KartenKopf titel={m.inst_installation()} />
      <KartenInhalt>
        <Angaben
          zeilen={[
            { name: m.inst_spalte_kunde(), wert: <ZuKunde id={k().id}>{k().name}</ZuKunde> },
            { name: m.inst_welle(), wert: welleName(welleVon(props.b, props.i)) },
            { name: m.server_spalte_server(), wert: <ZuServer id={sv().id}>{sv().name}</ZuServer> },
            {
              name: m.inst_linux_nutzer(),
              wert: <span class="font-mono text-xs">{linuxNutzer(props.i)}</span>,
            },
            {
              name: m.inst_betrieb(),
              wert: app().serverFuerSich ? m.inst_rootful() : m.inst_rootless(),
            },
            {
              name: m.inst_adresse(),
              wert: <span class="font-mono text-xs">{props.i.adresse}</span>,
            },
            { name: m.inst_optionen(), wert: optionen() || m.server_keine() },
            {
              name: m.server_version(),
              wert: istAktuell(props.b, props.i)
                ? props.i.version
                : `${props.i.version} → ${app().version ?? ""}`,
            },
            {
              name: m.inst_manifest(),
              wert: <span class="font-mono text-xs">{`manifeste/${app().id}/`}</span>,
            },
            { name: m.inst_spalte_daten(), wert: gb(props.i.datenGb) },
          ]}
        />
      </KartenInhalt>
    </Karte>
  );
};

const VonAussen = (props: { b: Bestand; i: Installation }) => {
  const sv = () => serverVon(props.b, props.i.server);
  const verfuegbar = () => props.i.verfuegbarkeit[monatVon(props.b.jetzt)] ?? 100;
  return (
    <Karte>
      <KartenKopf titel={m.inst_aussen()} text={m.inst_aussen_text()} />
      <KartenInhalt class="grid gap-3 sm:grid-cols-2">
        <Pruefzeile
          icon={Globe}
          name={m.inst_dns()}
          detail={`${props.i.adresse} → ${[sv().ipv4, sv().ipv6].filter(Boolean).join(", ")}`}
          ok
        />
        <Pruefzeile
          icon={Lock}
          name={m.inst_zertifikat()}
          detail={m.inst_zertifikat_tage({ tage: sv().zertifikatTage })}
          ok={sv().zertifikatTage > ZERTIFIKAT_TAGE}
        />
        <Pruefzeile
          icon={Radar}
          name={m.inst_von_aussen()}
          detail={props.i.health === "rot" ? m.inst_aussen_rot() : m.inst_aussen_ok()}
          ok={props.i.health !== "rot"}
        />
        <Pruefzeile
          icon={ChartNoAxesColumn}
          name={m.inst_verfuegbarkeit()}
          detail={prozent(verfuegbar(), 2)}
          ok={verfuegbar() >= 99.9}
        />
      </KartenInhalt>
    </Karte>
  );
};

const Backup = (props: { b: Bestand; i: Installation }) => (
  <Pruefzeile
    icon={Archive}
    name={m.inst_spalte_backup()}
    detail={`${appVon(props.b, props.i.app).backup} · ${zeitpunkt(props.i.backup.zeitpunkt, props.b.jetzt)}`}
    ok={props.i.backup.ok}
  />
);

export const InstallationZustand = (props: {
  b: Bestand;
  i: Installation;
  health: HealthDerZentrale;
}) => {
  const k = () => kundeVon(props.b, props.i.kunde);
  return (
    <div class="grid gap-4">
      <div class="grid gap-4 lg:grid-cols-3">
        <UnitsUndHealth health={props.health} class="lg:col-span-2">
          <Backup b={props.b} i={props.i} />
        </UnitsUndHealth>
        <Fakten b={props.b} i={props.i} />
      </div>
      <Show when={k().vertrag.ende}>
        {(ende) => (
          <Hinweisbox
            icon={<Icon icon={CalendarX} />}
            titel={m.kunde_gekuendigt_zum({ datum: datum(ende()) })}
          >
            {m.inst_gekuendigt_text({ datum: datum(loeschungAm(ende())) })}
          </Hinweisbox>
        )}
      </Show>
      <VonAussen b={props.b} i={props.i} />
      <Hinweisbox icon={<Icon icon={LifeBuoy} />} titel={m.nav_support()}>
        {m.inst_support_text()}
      </Hinweisbox>
    </div>
  );
};
