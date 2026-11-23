import type { GeleseneZeile } from "./schwaerzen.ts";

/*
 * The lines of an output as the agent keeps them while it reads (Z-405, the journal): only the last
 * `maxZeilen`, each with at most `maxZeichen` characters and marked when it was cut off, so neither
 * a flood of lines nor one endless line fills its memory. Pure: pieces in, lines out.
 */

export type ZeilenSammler = {
  /** The next piece of the output, cut anywhere */
  hinzu: (stueck: string) => void;
  /** The lines, the last one too when the output did not end with a line break */
  ende: () => GeleseneZeile[];
};

export const zeilenSammler = (maxZeilen: number, maxZeichen: number): ZeilenSammler => {
  const fertig: GeleseneZeile[] = [];
  let offen: GeleseneZeile = { text: "", abgeschnitten: false };

  const anhaengen = (teil: string) => {
    const platz = maxZeichen - offen.text.length;
    if (teil.length <= platz) offen.text += teil;
    else offen = { text: offen.text + teil.slice(0, platz), abgeschnitten: true };
  };

  const abschliessen = () => {
    fertig.push(offen);
    if (fertig.length > maxZeilen) fertig.shift();
    offen = { text: "", abgeschnitten: false };
  };

  return {
    hinzu: (stueck) => {
      const teile = stueck.split("\n");
      teile.forEach((teil, i) => {
        anhaengen(teil);
        if (i < teile.length - 1) abschliessen();
      });
    },
    ende: () => {
      if (offen.text !== "" || offen.abgeschnitten) abschliessen();
      return [...fertig];
    },
  };
};
