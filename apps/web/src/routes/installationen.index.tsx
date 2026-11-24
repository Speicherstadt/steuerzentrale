import { createFileRoute, redirect } from "@tanstack/solid-router";

/** Installations are called Apps now (docs/plan.md, "Navigation (Oberfläche 2026-11)"); old links still work */
export const Route = createFileRoute("/installationen/")({
  beforeLoad: () => {
    throw redirect({ to: "/apps", replace: true });
  },
});
