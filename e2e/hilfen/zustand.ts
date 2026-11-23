import { type APIRequestContext, expect } from "@playwright/test";
import type { Angelegt } from "./installationen.ts";

/*
 * An installation of the stand-in agent brought to a state (Z-403, Z-406): its setup done (a host
 * starting with `laeuft`), then red as the agent reports it. The Zentrale takes one report per
 * connection every 5 s, so the report is sent again until it arrived.
 */

type Antwort = { zustand: string; health: { zustand: string } };

const lesen = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}`)).json()) as Antwort;

export const rotGemeldet = async (request: APIRequestContext, i: Angelegt) => {
  await expect.poll(async () => (await lesen(request, i.installationId)).zustand).toBe("laeuft");
  await expect
    .poll(
      async () => {
        i.agent.melden([
          {
            installationId: i.installationId,
            units: [{ name: `${i.installationId}-app.service`, aktiv: "failed" }],
            health: { zustand: "rot", grund: "HTTP 503" },
          },
        ]);
        return (await lesen(request, i.installationId)).health.zustand;
      },
      { intervals: [500, 1000], timeout: 20_000 },
    )
    .toBe("rot");
};
