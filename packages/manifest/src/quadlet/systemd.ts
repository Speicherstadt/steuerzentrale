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
 * generator, `Exec="--save" "" "a b"` even ends after --save)
 */
export const systemdWort = (wort: string): string | null => {
  if (wort === "" || hatSteuerzeichen(wort)) return null;
  const maskiert = wort
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$$$");
  return `"${maskiert}"`;
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
