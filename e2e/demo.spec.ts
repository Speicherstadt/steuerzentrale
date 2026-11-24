import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// The demo build (`bun run --cwd apps/web build:demo`, the demo on the docs site) with its fixtures
// and hash routes, no Zentrale behind it: every route of the route tree opens without the router's
// error boundary and without an uncaught error. The other specs run signed in against a Zentrale,
// so a page broken only in the demo once reached main unseen.

/** The pages of the route tree (FileRoutesByFullPath, as the `pages` check reads them) */
const routen = (): string[] => {
  const baum = readFileSync(join(import.meta.dirname, "../apps/web/src/routeTree.gen.ts"), "utf8");
  const block = baum.match(/export interface FileRoutesByFullPath \{([^}]*)\}/)?.[1] ?? "";
  return [...block.matchAll(/'([^']+)':/g)].map(([, pfad = ""]) =>
    pfad === "/" ? pfad : pfad.replace(/\/$/, ""),
  );
};

/** An object of the demo fixtures (apps/web/src/demo/) for each detail page */
const DEMO_IDS: Record<string, string> = {
  "/apps/$id": "/apps/lind-haben",
  "/installationen/$id": "/installationen/lind-haben",
  "/katalog/$app": "/katalog/haben",
  "/kunden/$id": "/kunden/roth",
  "/server/$id": "/server/shared-1",
};

const pfadFuer = (route: string): string => {
  if (!route.includes("$")) return route;
  const pfad = DEMO_IDS[route];
  if (!pfad) throw new Error(`no demo object for ${route}: add one to DEMO_IDS`);
  return pfad;
};

test.use({ locale: "de-DE" });

for (const route of routen()) {
  test(`the demo opens ${route}`, async ({ page }) => {
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));
    await page.goto(`#${pfadFuer(route)}`);
    const kaputt = page.getByText(/Something went wrong/i);
    await expect(page.getByRole("heading", { level: 1 }).or(kaputt)).toBeVisible();
    await expect(kaputt).toHaveCount(0);
    expect(fehler).toEqual([]);
  });
}
