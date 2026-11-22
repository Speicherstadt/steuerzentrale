import { ausfuehren, echtSpawn } from "../src/auftraege/ausfuehren.ts";
import type { Plan } from "../src/auftraege/pruefen.ts";
import type { Nutzer } from "../src/einrichtung/nutzer.ts";

/*
 * Run as root through `sudo -n bun` by auftraege.agent.test.ts (CI only): the real `ausfuehren`
 * with the real spawn, as the agent runs it on a server. The agent tests' own job handling runs
 * root's part through sudo (einrichtung-hilfen.ts), and killing sudo is not what the agent does
 * at the time limit; this is. Prints the result as JSON.
 */
const [plan, nutzer] = JSON.parse(process.argv[2] ?? "[]") as [Plan, Nutzer];
const ergebnis = await ausfuehren(
  {
    spawn: echtSpawn,
    planen: (los, ms) => {
      const t = setTimeout(los, ms);
      return () => clearTimeout(t);
    },
  },
  plan,
  nutzer,
);
console.log(JSON.stringify(ergebnis));
