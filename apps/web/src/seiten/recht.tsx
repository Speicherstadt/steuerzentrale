import type { JSX } from "@solidjs/web";
import { createMemo, Loading, Show } from "solid-js";
import { betriebsartLesen, nurFuerMich } from "../daten/betriebsart.ts";
import {
  darfAuditLesen,
  darfInstallieren,
  darfInternMarkieren,
  rolleLesen,
} from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";

/** Whether the signed-in role passes `pruefen`, as an accessor to read under a `<Loading>` */
const recht = (pruefen: (rolle: Rolle) => boolean): (() => boolean) => {
  const rolle = createMemo(() => rolleLesen());
  return () => {
    const r = rolle();
    return r.ok && pruefen(r.daten);
  };
};

/**
 * Whether the signed-in role may make and remove installations (docs/plan.md, "Rollen für
 * Installationen"), and import manifests and ask the registries (Z-501), which the same roles do
 */
export const installationsRecht = (): (() => boolean) => recht(darfInstallieren);

/** Whether the signed-in role is the owner: marks a customer as internal (Z-501) */
export const inhaberRecht = (): (() => boolean) => recht(darfInternMarkieren);

/** Whether the signed-in role reads the audit log (the tab "Änderungen" of the Protokoll) */
export const auditRecht = (): (() => boolean) => recht(darfAuditLesen);

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

/**
 * Shows its children only to the owner: marking a customer as internal (Z-501), changing the
 * Betriebsart (Z-805); `sonst` is what another role sees instead
 */
export const NurInhaber = (props: { children: JSX.Element; sonst?: JSX.Element }) => {
  const darf = recht(darfInternMarkieren);
  return (
    <Loading fallback={null}>
      <Show when={darf()} fallback={props.sonst}>
        {props.children}
      </Show>
    </Loading>
  );
};

/** Shows its children unless the operator runs "Nur für mich" (Z-805): customers' things only */
export const FuerKunden = (props: { children: JSX.Element }) => {
  const art = createMemo(() => betriebsartLesen());
  return (
    <Loading fallback={null}>
      <Show when={!nurFuerMich(art())}>{props.children}</Show>
    </Loading>
  );
};
