import { createFileRoute, redirect } from "@tanstack/solid-router";

/** Installations are called Apps now (docs/plan.md, "Navigation (Oberfläche 2026-11)"); old links still work */
export const Route = createFileRoute("/installationen/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/apps/$id", params: { id: params.id }, replace: true });
  },
});
