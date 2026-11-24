import { eq } from "drizzle-orm";
import { user } from "../db/auth-schema.ts";
import { faktorenVon, zweiterFaktorVorhanden } from "../modules/anmeldung/faktoren.ts";
import { betriebsartLesen } from "../modules/betriebsart/index.ts";
import { betreiberLesen } from "../modules/mitglieder/index.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/**
 * The signed-in account: `/einrichtung` says which factors it has and whether it may go on (any
 * session reaches it); `/ich` names account, operator and role once it has its second factor
 */
export const kontoRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/einrichtung", (c) => {
    const faktoren = faktorenVon(deps.db, c.get("nutzerId"));
    return c.json({ ...faktoren, zweiterFaktor: zweiterFaktorVorhanden(faktoren) });
  });

  route("GET /api/v1/ich", (c) => {
    const konto = deps.db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, c.get("nutzerId")))
      .get();
    const betreiber = betreiberLesen(deps.db, c.get("betreiberId"));
    // the sidebar names how one signs in: a passkey where there is one, else TOTP (Z-406)
    const faktoren = faktorenVon(deps.db, c.get("nutzerId"));
    return c.json({
      nutzerId: c.get("nutzerId"),
      name: konto?.name ?? "",
      email: konto?.email ?? "",
      rolle: c.get("rolle"),
      faktor: faktoren.passkeys > 0 ? "passkey" : "totp",
      // Z-805: the interface hides customers in `selbst` and asks while it is null
      betreiber: {
        betreiberId: c.get("betreiberId"),
        name: betreiber?.name ?? "",
        ...betriebsartLesen(deps.db, c.get("betreiberId")),
      },
    });
  });
};
