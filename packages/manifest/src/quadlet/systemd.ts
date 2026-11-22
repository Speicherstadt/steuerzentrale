/*
 * Text for systemd unit files as Quadlet reads them (podman-systemd.unit(5) of Podman v4.9.0). A
 * value never passes through a shell: Quadlet splits Exec=, Environment= and Label= like a systemd
 * command line (pkg/systemd/parser/split.go, splitString with SplitUnquote|SplitCUnescape) and
 * writes the words into ExecStart=, where systemd itself still expands % specifiers and $VARIABLES
 * (systemd.service(5), "Command lines"). So a word is written in double quotes with \ and " escaped
 * and % and $ doubled, which systemd turns back into the literal character.
 */

/** C0 and C1 control characters, line breaks included: no unit line can carry them faithfully */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is the point
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f]/;

export const hatSteuerzeichen = (text: string): boolean => STEUERZEICHEN.test(text);

/**
 * One word of a systemd command line, or null for a word that cannot be written: one with a control
 * character, or the empty word, which Quadlet loses when it writes ExecStart= (escapeWords in
 * pkg/systemd/parser/split.go writes it as nothing, in v4.9.0 as in v5.4; tried with the v4.9.0
 * generator, `Exec="--save" "" "a b"` even ends after --save), or a lone ";", which Quadlet writes
 * bare into ExecStart= (tried with the v4.9.0 and v5 generators), where systemd reads it as the end
 * of the command and refuses the service (systemd 255, `systemd-analyze verify`: "more than one
 * ExecStart= setting")
 */
export const systemdWort = (wort: string): string | null => {
  if (wort === "" || wort === ";" || hatSteuerzeichen(wort)) return null;
  const maskiert = wort
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$$$");
  return `"${maskiert}"`;
};

/** The characters systemdWort doubles */
const VERDOPPELT = new Set(["%", "$"]);

/**
 * The text of a word systemdWort wrote, or null for anything it does not write (Z-405: the agent
 * reads the values of its own units back, the reverse of the escaping above)
 */
export const systemdWortLesen = (wort: string): string | null => {
  if (wort.length < 3 || !wort.startsWith('"') || !wort.endsWith('"')) return null;
  const innen = wort.slice(1, -1);
  let text = "";
  for (let i = 0; i < innen.length; i++) {
    const z = innen[i] as string;
    const naechstes = innen[i + 1];
    const paar =
      (z === "\\" && (naechstes === "\\" || naechstes === '"')) ||
      (VERDOPPELT.has(z) && naechstes === z);
    if (paar) i++;
    else if (z === '"' || z === "\\" || VERDOPPELT.has(z)) return null;
    text += paar ? (naechstes as string) : z;
  }
  return text;
};

export type Zeile = readonly [schluessel: string, wert: string];
export type Abschnitt = { name: string; zeilen: readonly Zeile[] };

/** A unit file: a comment line, then each section with at least one line */
export const unitText = (kopf: string, abschnitte: readonly Abschnitt[]): string =>
  `${[
    `# ${kopf}`,
    ...abschnitte
      .filter((a) => a.zeilen.length > 0)
      .map((a) => [`[${a.name}]`, ...a.zeilen.map(([k, w]) => `${k}=${w}`)].join("\n")),
  ].join("\n\n")}\n`;

/** The sections and keys of a unit text, for the tests and for a check before writing */
export const unitLesen = (text: string): Abschnitt[] => {
  const abschnitte: { name: string; zeilen: Zeile[] }[] = [];
  for (const zeile of text.split("\n")) {
    const kopf = /^\[(.+)\]$/.exec(zeile);
    if (kopf) abschnitte.push({ name: kopf[1] ?? "", zeilen: [] });
    else if (zeile !== "" && !zeile.startsWith("#")) {
      const i = zeile.indexOf("=");
      abschnitte.at(-1)?.zeilen.push([zeile.slice(0, i), zeile.slice(i + 1)]);
    }
  }
  return abschnitte;
};
