import type { JSX } from "@solidjs/web";
import { createMemo, Loading, Show } from "solid-js";
import { darfInstallieren, rolleLesen } from "../daten/rolle.ts";

/**
 * Whether the signed-in role may make and remove installations (docs/plan.md, "Rollen für
 * Installationen"), as an accessor to read under a `<Loading>`: it waits for the role
 */
export const installationsRecht = (): (() => boolean) => {
  const rolle = createMemo(() => rolleLesen());
  return () => {
    const r = rolle();
    return r.ok && darfInstallieren(r.daten);
  };
};

/**
 * Shows its children only to a role that may make and remove installations; a button without the
 * right would only meet the Zentrale's refusal. `sonst` is what a role without it sees instead,
 * such as the values read-only
 */
export const MitInstallationsRecht = (props: { children: JSX.Element; sonst?: JSX.Element }) => {
  const darf = installationsRecht();
  return (
    <Loading fallback={null}>
      <Show when={darf()} fallback={props.sonst}>
        {props.children}
      </Show>
    </Loading>
  );
};
