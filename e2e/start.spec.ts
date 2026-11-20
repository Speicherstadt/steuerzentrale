import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ locale: "de-DE" });

test.describe("the start page", { tag: "@phone" }, () => {
  test("renders its heading without an axe finding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Steuerzentrale" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });

  test("reaches the Zentrale through the same origin", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
