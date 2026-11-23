import { Icon, m } from "@steuerzentrale/ui";
import { Hourglass } from "@steuerzentrale/ui/icons";
import { Hinweisbox, Seitenkopf } from "./karte.tsx";

/**
 * What a later item of BAULISTE.md brings (docs/plan.md, "Echte Daten (Z-406)"): signed in, a page
 * or part without an API yet shows this note instead of the demo's made-up data
 */
export const KommtNoch = (props: { punkt: string; text: string }) => (
  <Hinweisbox icon={<Icon icon={Hourglass} />} titel={m.kommt_mit({ punkt: props.punkt })}>
    {props.text}
  </Hinweisbox>
);

/** A whole page a later item brings: its heading and the note, nothing of the demo */
export const NochNicht = (props: {
  titel: string;
  text: string;
  punkt: string;
  hinweis: string;
}) => (
  <div class="grid gap-4">
    <Seitenkopf titel={props.titel} text={props.text} />
    <KommtNoch punkt={props.punkt} text={props.hinweis} />
  </div>
);
