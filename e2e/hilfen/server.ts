import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";

/**
 * A shared server of the first owner's operator, added over the API (Z-302); no agent joins it, so
 * it has no facts yet (Z-304)
 */
export const serverAnlegen = async (request: APIRequestContext, name: string) => {
  const antwort = await request.post("/api/v1/server", {
    data: {
      name: `${name} ${randomUUID().slice(0, 8)}`,
      wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
      grund: "Test",
    },
  });
  expect(antwort.status()).toBe(201);
  return (await antwort.json()) as { serverId: string; name: string; befehl: string };
};
