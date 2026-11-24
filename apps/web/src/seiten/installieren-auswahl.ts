import {
  adresseVorschlag,
  alleOptionen,
  einstellungsFormular,
  type Geprueft,
  type Manifest,
  manifestPruefen,
  type Platzierung,
} from "@steuerzentrale/manifest";
import { m } from "@steuerzentrale/ui";
import { createMemo, createSignal } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type AppVersion, appsQuelle, installierbar } from "../daten/apps.ts";
import { dnsQuelle } from "../daten/dns.ts";
import type { Feld } from "../daten/einstellungs-formular.ts";
import { installationenQuelle, type PlatzWunsch } from "../daten/installationen.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { type ServerDerZentrale, serverQuelle } from "../daten/server.ts";
import type { Kunde } from "../daten/typen.ts";

/*
 * What the dialog "Installieren" has chosen so far, and what follows from it (BAULISTE.md Z-402):
 * app and version among the imported manifests (Z-501; a pre-release only for an internal
 * customer), the manifest's text from the Zentrale read in the browser with its own function, its
 * settings for the chosen options, and the placement asked again on every change of customer,
 * server, app, version or options, and the address it suggests, `<app>.<kuerzel>.<domain>` (Z-407).
 * Created in the dialog's form, so it starts empty each time the dialog opens.
 */

export type Auswahl = {
  kunden: () => Antwort<Kunde[]>;
  server: () => Antwort<ServerDerZentrale[]>;
  kundeId: () => string;
  setKundeId: (id: string) => void;
  serverId: () => string;
  setServerId: (id: string) => void;
  /** The apps with an imported version the customer may get */
  angeboteneApps: () => string[];
  app: () => string;
  /** Another app starts without a version and options */
  appSetzen: (app: string) => void;
  /** The versions of the chosen app the customer may get, newest first */
  versionen: () => AppVersion[];
  version: () => string;
  /** Another version starts without options */
  versionSetzen: (version: string) => void;
  optionen: () => string[];
  setOptionen: (optionen: string[]) => void;
  geprueft: () => Geprueft | undefined;
  gelesen: () => Manifest | undefined;
  einstellungen: () => Feld[];
  /**
   * The operator's fields of the manifest whose required value the placement found missing
   * (`betreiberwert_fehlt`, Z-404): the dialog asks for them and they are stored with the
   * installation. Read under the placement's Loading, as they follow its answer.
   */
  betreiberFelder: () => Feld[];
  /** Every field of the operator's form of the manifest, to read what the dialog entered */
  betreiberFormular: () => Feld[];
  /** Undefined until customer, server, app and version are chosen */
  wunsch: () => PlatzWunsch | undefined;
  platzierung: () => Antwort<Platzierung> | undefined;
  /** "<app> auf <server>", the line under the placement's verdict */
  titel: () => string;
  /** The operator's domain from its DNS settings, null while it has none (Z-407) */
  domain: () => string | null;
  /** `<app>.<kuerzel>.<domain>` once customer and manifest are chosen and a domain is set */
  vorschlag: () => string | undefined;
};

/**
 * App and version among the imported manifests the customer may get (a pre-release only for an
 * internal one), and the chosen version's manifest read from its text; a new app or version starts
 * without options (`ohneOptionen`)
 */
const versionsWahl = (
  intern: () => boolean,
  ohneOptionen: () => void,
  vorgewaehlt: () => string | undefined,
) => {
  const [app, setApp] = createSignal(() => vorgewaehlt() ?? "");
  const [version, setVersion] = createSignal("");
  const apps = createMemo(() => appsQuelle().liste());
  const versionenDer = (name: string) => {
    const a = apps();
    return installierbar(a.ok ? a.daten.find((x) => x.app === name) : undefined, intern());
  };
  // the chosen version's text from the Zentrale, which the dialog reads its form from
  const text = createMemo(() =>
    app() && version() ? appsQuelle().manifest(app(), version()) : undefined,
  );
  const geprueft = createMemo((): Geprueft | undefined => {
    const t = text();
    if (!t) return undefined;
    return t.ok ? manifestPruefen(t.daten.text) : { ok: false, fehler: [t.fehler] };
  });
  return {
    angeboteneApps: () => {
      const a = apps();
      return a.ok ? a.daten.map((x) => x.app).filter((x) => versionenDer(x).length > 0) : [];
    },
    app,
    appSetzen: (neu: string) => {
      setApp(neu);
      setVersion("");
      ohneOptionen();
    },
    versionen: () => versionenDer(app()),
    version,
    versionSetzen: (neu: string) => {
      setVersion(neu);
      ohneOptionen();
    },
    geprueft,
    gelesen: () => {
      const g = geprueft();
      return g?.ok ? g.manifest : undefined;
    },
  };
};

export const auswahlZustand = (
  vorgewaehlt: () => string | undefined,
  vorgewaehlteApp: () => string | undefined = () => undefined,
): Auswahl => {
  const [kundeId, setKundeId] = createSignal(() => vorgewaehlt() ?? "");
  const [serverId, setServerId] = createSignal("");
  const [optionen, setOptionen] = createSignal<string[]>([]);
  const kunden = createMemo(() => kundenQuelle().liste());
  const server = createMemo(() => serverQuelle().liste());
  const kunde = () => {
    const k = kunden();
    return k.ok ? k.daten.find((x) => x.id === kundeId()) : undefined;
  };
  const wahl = versionsWahl(
    () => kunde()?.intern ?? false,
    () => setOptionen([]),
    vorgewaehlteApp,
  );
  const { app, version, gelesen } = wahl;
  const einstellungen = createMemo(() => {
    const mf = gelesen();
    return mf ? einstellungsFormular(mf, "installation", optionen()) : [];
  });
  const wunsch = createMemo((): PlatzWunsch | undefined =>
    kundeId() && serverId() && app() && version()
      ? {
          kundeId: kundeId(),
          serverId: serverId(),
          app: app(),
          version: version(),
          optionen: optionen(),
        }
      : undefined,
  );
  const platzierung = createMemo(() => {
    const w = wunsch();
    return w ? installationenQuelle().platzierung(w) : undefined;
  });
  const betreiberFormular = createMemo(() => {
    const mf = gelesen();
    return mf ? einstellungsFormular(mf, "betreiber", alleOptionen(mf)) : [];
  });
  const betreiberFelder = () => {
    const p = platzierung();
    if (!p?.ok || p.daten.art !== "passt_nicht") return [];
    const fehlt = new Set(
      p.daten.gruende.filter((g) => g.code === "betreiberwert_fehlt").map((g) => g.werte.name),
    );
    return betreiberFormular().filter((f) => fehlt.has(f.name));
  };
  const dns = createMemo(() => dnsQuelle().lesen());
  const domain = () => {
    const d = dns();
    return d.ok ? d.daten.domain : null;
  };
  const vorschlag = () => {
    const k = kunde();
    return k && app() ? adresseVorschlag(app(), k.kuerzel, domain()) : undefined;
  };
  const titel = () => {
    const s = server();
    const name = s.ok ? s.daten.find((x) => x.serverId === serverId())?.name : undefined;
    return m.platz_auf({ app: app(), server: name ?? "" });
  };
  return {
    kunden,
    server,
    kundeId,
    setKundeId,
    serverId,
    setServerId,
    ...wahl,
    optionen,
    setOptionen,
    einstellungen,
    betreiberFelder,
    betreiberFormular,
    wunsch,
    platzierung,
    titel,
    domain,
    vorschlag,
  };
};
