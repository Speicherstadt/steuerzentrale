import {
  type Geprueft,
  type Manifest,
  manifestPruefen,
  type Platzierung,
} from "@steuerzentrale/manifest";
import { m } from "@steuerzentrale/ui";
import { createMemo, createSignal } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type Feld, installationsFelder } from "../daten/einstellungs-formular.ts";
import { installationenQuelle, type PlatzWunsch } from "../daten/installationen.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { type ServerDerZentrale, serverQuelle } from "../daten/server.ts";
import type { Kunde } from "../daten/typen.ts";

/*
 * What the dialog "Installieren" has chosen so far, and what follows from it (BAULISTE.md Z-402):
 * the manifest read in the browser with the Zentrale's own function, its settings for the chosen
 * options, and the placement asked again on every change of customer, server, manifest, signature
 * or options. Created in the dialog's form, so it starts empty each time the dialog opens.
 */

export type Auswahl = {
  kunden: () => Antwort<Kunde[]>;
  server: () => Antwort<ServerDerZentrale[]>;
  kundeId: () => string;
  setKundeId: (id: string) => void;
  serverId: () => string;
  setServerId: (id: string) => void;
  /** A new manifest starts without options */
  manifestSetzen: (text: string) => void;
  setSignatur: (text: string) => void;
  optionen: () => string[];
  setOptionen: (optionen: string[]) => void;
  geprueft: () => Geprueft | undefined;
  gelesen: () => Manifest | undefined;
  einstellungen: () => Feld[];
  /** Undefined until customer, server, manifest and signature are there */
  wunsch: () => PlatzWunsch | undefined;
  platzierung: () => Antwort<Platzierung> | undefined;
  /** "<app> auf <server>", the line under the placement's verdict */
  titel: () => string;
};

export const auswahlZustand = (vorgewaehlt: () => string | undefined): Auswahl => {
  const [kundeId, setKundeId] = createSignal(() => vorgewaehlt() ?? "");
  const [serverId, setServerId] = createSignal("");
  const [manifest, setManifest] = createSignal("");
  const [signatur, setSignatur] = createSignal("");
  const [optionen, setOptionen] = createSignal<string[]>([]);
  const kunden = createMemo(() => kundenQuelle().liste());
  const server = createMemo(() => serverQuelle().liste());
  const geprueft = createMemo(() => (manifest() ? manifestPruefen(manifest()) : undefined));
  const gelesen = () => {
    const g = geprueft();
    return g?.ok ? g.manifest : undefined;
  };
  const einstellungen = createMemo(() => {
    const mf = gelesen();
    return mf ? installationsFelder(mf, optionen()) : [];
  });
  const wunsch = createMemo((): PlatzWunsch | undefined =>
    kundeId() && serverId() && manifest() && signatur()
      ? {
          kundeId: kundeId(),
          serverId: serverId(),
          manifest: manifest(),
          signatur: signatur(),
          optionen: optionen(),
        }
      : undefined,
  );
  const platzierung = createMemo(() => {
    const w = wunsch();
    return w ? installationenQuelle().platzierung(w) : undefined;
  });
  const titel = () => {
    const s = server();
    const name = s.ok ? s.daten.find((x) => x.serverId === serverId())?.name : undefined;
    return m.platz_auf({ app: gelesen()?.id ?? "", server: name ?? "" });
  };
  return {
    kunden,
    server,
    kundeId,
    setKundeId,
    serverId,
    setServerId,
    manifestSetzen: (text) => {
      setManifest(text);
      setOptionen([]);
    },
    setSignatur,
    optionen,
    setOptionen,
    geprueft,
    gelesen,
    einstellungen,
    wunsch,
    platzierung,
    titel,
  };
};
