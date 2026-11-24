import { createFileRoute, redirect } from "@tanstack/solid-router";

/** Moved into the Protokoll (docs/plan.md, "Navigation (Oberfläche 2026-11)"); old links still work */
export const Route = createFileRoute("/auftraege")({
  beforeLoad: () => {
    throw redirect({ to: "/protokoll", search: { tab: "auftraege" }, replace: true });
  },
});
