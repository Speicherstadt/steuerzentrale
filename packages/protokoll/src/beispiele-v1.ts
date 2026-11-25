/**
 * One message of every kind as an agent and a Zentrale of protocol 1 send it. Frozen: never change
 * these; a later protocol adds its own file and must still read this one (lesen.test.ts), so an agent
 * one version behind keeps working with a newer Zentrale.
 */
const MANIFEST = "schema: 1\nid: beispiel\n";
const CSR = "-----BEGIN CERTIFICATE REQUEST-----\nMIIB...\n-----END CERTIFICATE REQUEST-----\n";
const ZERTIFIKAT = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n";
const SIGNATUR = "untrusted comment: signature\nRUR...\ntrusted comment: beispiel\nAAA...\n";

export const VOM_AGENTEN_V1: readonly Record<string, unknown>[] = [
  {
    typ: "hallo",
    protokoll: 1,
    agentVersion: "0.1.0",
    architektur: "arm64",
    zeit: 1_795_000_000_000,
  },
  { typ: "heartbeat", protokoll: 1, zeit: 1_795_000_030_000 },
  {
    typ: "fakten",
    protokoll: 1,
    zeit: 1_795_000_000_000,
    cpuKerne: 4,
    ramMb: 8192,
    platten: [{ mount: "/", gesamtMb: 81920, freiMb: 40960 }],
    architektur: "amd64",
    os: { name: "Debian GNU/Linux", version: "13" },
    kernel: { laeuft: "6.12.0-1-amd64", installiert: "6.12.0-2-amd64" },
    neustartNoetig: true,
    updatesAusstehend: 3,
    podman: "5.4.2",
    ipv4: ["203.0.113.10"],
    ipv6: ["2001:db8::10"],
    ptr: { "203.0.113.10": "server-a.example.org" },
    portsBelegt: [{ port: 443, proto: "tcp" }],
    port25Ausgehend: false,
    uhrzeitAbweichungMs: 12,
    bootId: "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4",
    gestartetAm: 1_794_900_000_000,
    unattendedUpgrades: { installiert: true, aktiv: true, letzterLauf: 1_794_990_000_000 },
    portsOffen: [
      { port: 22, proto: "tcp" },
      { port: 443, proto: "tcp" },
    ],
    zertifikate: [{ host: "haben.mueller.apps.example.org", gueltigBis: 1_800_000_000_000 }],
    uhrSynchron: true,
  },
  {
    typ: "zustand",
    protokoll: 1,
    zeit: 1_795_000_000_000,
    installationen: [
      {
        installationId: "haben-mueller",
        units: [{ name: "haben-mueller-app.service", aktiv: "active" }],
        health: { zustand: "gruen", grund: "HTTP 200 auf /healthz" },
      },
    ],
  },
  // Z-1103, still before the first release: the observed units of a service
  {
    typ: "zustand",
    protokoll: 1,
    zeit: 1_795_000_000_000,
    installationen: [],
    dienste: [
      {
        dienstId: "d-1",
        units: [{ name: "kontext.service", aktiv: "active" }],
        health: { zustand: "gruen", grund: "HTTP 200" },
      },
    ],
  },
  { typ: "bestaetigt", protokoll: 1, auftragId: "a-1" },
  {
    typ: "fortschritt",
    protokoll: 1,
    auftragId: "a-1",
    schritt: "image ziehen",
    zeit: 1_795_000_000_000,
  },
  {
    typ: "ergebnis",
    protokoll: 1,
    auftragId: "a-1",
    zeit: 1_795_000_000_000,
    ergebnis: { ok: true, daten: { version: "1.9.0" } },
  },
  {
    typ: "ergebnis",
    protokoll: 1,
    auftragId: "a-2",
    zeit: 1_795_000_000_000,
    ergebnis: { ok: false, fehler: "Health rot" },
  },
  {
    typ: "log_auszug",
    protokoll: 1,
    auftragId: "a-3",
    zeilen: ["Nov 20 12:00:00 app[1]: started", "token=***"],
  },
  {
    typ: "ssh_anmeldung",
    protokoll: 1,
    zeit: 1_795_000_000_000,
    nutzer: "tristan",
    von: "10.8.0.2",
    methode: "publickey",
  },
  { typ: "zertifikat_anfrage", protokoll: 1, csr: CSR },
  {
    typ: "backup_stand",
    protokoll: 1,
    installationId: "beispiel-x7k2p9",
    lauf: "5b0c8f0e-3c1d-4d2a-9a57-0f6a2f1e8c11",
    beginn: 1_795_000_000_000,
    ende: 1_795_000_042_000,
    ok: true,
    teile: [
      { tag: "volume:daten", ok: true, snapshot: "a".repeat(64) },
      { tag: "befehl:export", ok: true, snapshot: "b".repeat(64) },
    ],
  },
];

export const VON_DER_ZENTRALE_V1: readonly Record<string, unknown>[] = [
  { typ: "willkommen", protokoll: 1, zeit: 1_795_000_000_000 },
  {
    typ: "auftrag",
    protokoll: 1,
    auftragId: "a-1",
    installationId: "haben-mueller",
    aktion: "update",
    argumente: { version: "1.9.0" },
    manifest: MANIFEST,
    signatur: SIGNATUR,
    zeitlimitS: 1800,
  },
  {
    typ: "auftrag",
    protokoll: 1,
    auftragId: "a-2",
    installationId: "beispiel-x7k2p9",
    aktion: "installation_einrichten",
    argumente: {},
    manifest: MANIFEST,
    signatur: SIGNATUR,
    zeitlimitS: 1800,
    einrichtung: {
      installation: {
        kundeId: "k-1",
        optionen: [],
        httpPort: 20001,
        ports: { "app:9000": 20002 },
        host: "beispiel.kunde.example",
        ipv4: "203.0.113.10",
      },
      einstellungen: {
        betreiber: {},
        installation: { BEISPIEL_TITEL: "Beispiel" },
        auto: { BEISPIEL_SCHLUESSEL: "c2VjcmV0" },
      },
    },
  },
  {
    typ: "zertifikat",
    protokoll: 1,
    zertifikat: ZERTIFIKAT,
    ca: ZERTIFIKAT,
    gueltigBis: 1_826_536_000_000,
  },
  {
    typ: "willkommen",
    protokoll: 1,
    zeit: 1_795_000_000_000,
    zertifikatGueltigBis: 1_826_536_000_000,
  },
  {
    typ: "auftrag",
    protokoll: 1,
    auftragId: "a-3",
    installationId: "beispiel-x7k2p9",
    aktion: "installation_backup_einrichten",
    argumente: {},
    manifest: MANIFEST,
    signatur: SIGNATUR,
    zeitlimitS: 1800,
    backup: {
      repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
      zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: "c2VjcmV0LXNjaGx1ZXNzZWw" },
      passwort: "restic-passwort-der-installation",
    },
  },
  // Z-504: the update of the agent itself, which every agent of this protocol must read, also one
  // version behind its Zentrale: SHA256SUMS and its signature in the place of the manifest
  {
    typ: "auftrag",
    protokoll: 1,
    auftragId: "a-4",
    installationId: null,
    aktion: "agent_update",
    argumente: { version: "0.2.0" },
    manifest: `${"0".repeat(64)}  steuerzentrale-agent-linux-x64\n${"1".repeat(64)}  steuerzentrale-agent-linux-arm64\n`,
    signatur: SIGNATUR,
    zeitlimitS: 600,
  },
  {
    typ: "auftrag",
    protokoll: 1,
    auftragId: "a-5",
    installationId: null,
    aktion: "server_neustart",
    argumente: { bootId: "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4" },
    manifest: "-",
    signatur: "-",
    zeitlimitS: 600,
  },
  // Z-1103, still before the first release: the observed units of a server, read only
  {
    typ: "beobachten",
    protokoll: 1,
    dienste: [
      {
        dienstId: "d-1",
        nutzer: "tristan",
        units: ["kontext.service"],
        health: { art: "http", port: 3000, pfad: "/health" },
      },
      { dienstId: "d-2", nutzer: null, units: ["caddy.service"], health: { art: "keine" } },
    ],
  },
];
