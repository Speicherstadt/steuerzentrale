import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";

/**
 * A customer of the first owner's operator, made over the API with the project's session (Z-801);
 * the name gets a suffix, as the projects and workers share one Zentrale
 */
export const kundeAnlegen = async (request: APIRequestContext, name: string) => {
  const antwort = await request.post("/api/v1/kunden", {
    data: {
      name: `${name} ${randomUUID().slice(0, 8)}`,
      kontakt: { name: "Petra Weber", email: "praxis@praxis-weber.test" },
      vertrag: { beginn: Date.UTC(2026, 4, 1, 22) },
      grund: "Test",
    },
  });
  expect(antwort.status()).toBe(201);
  return (await antwort.json()) as { id: string; name: string };
};
