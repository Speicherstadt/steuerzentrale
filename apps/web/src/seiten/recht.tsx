import type { JSX } from "@solidjs/web";
import { createMemo, Loading, Show } from "solid-js";
import { darfInstallieren, rolleLesen } from "../daten/rolle.ts";

/**
 * Shows its children only to a role that may make and remove installations (docs/plan.md, "Rollen
 * für Installationen"); a button without the right would only meet the Zentrale's refusal
 */
export const MitInstallationsRecht = (props: { children: JSX.Element }) => {
  const rolle = createMemo(() => rolleLesen());
  const darf = () => {
    const r = rolle();
    return r.ok && darfInstallieren(r.daten);
  };
  return (
    <Loading fallback={null}>
      <Show when={darf()}>{props.children}</Show>
    </Loading>
  );
};
