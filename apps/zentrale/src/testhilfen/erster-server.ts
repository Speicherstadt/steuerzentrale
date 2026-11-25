import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { totpCode, totpSchluessel } from "./totp.ts";

/*
 * For CI only (job `release-kandidat`, BAULISTE.md Z-1004): what a person does in the interface of
 * a freshly installed release candidate, over HTTPS through its Pforte as a browser would. The
 * Pforte's certificate is checked with the CA in NODE_EXTRA_CA_CERTS; the session's cookies are
 * kept in <kekse> (0600) between the calls.
 *
 *   erster-server.ts <url> <kekse> einrichten <setup-code>   first owner, TOTP, a shared server:
 *                                                            prints { serverId, befehl }
 *   erster-server.ts <url> <kekse> server <serverId>         prints the server as the interface reads it
 */
const [url = "", keksDatei = "", befehl = "", wert = ""] = process.argv.slice(2);
if (!URL.parse(url) || !keksDatei || !["einrichten", "server"].includes(befehl) || !wert) {
  console.error("usage: erster-server.ts <url> <kekse> einrichten <code> | server <serverId>");
  process.exit(2);
}
const PASSWORT = "sz-test-release-kandidat-1";
const kekse = new Map<string, string>(
  existsSync(keksDatei) ? JSON.parse(readFileSync(keksDatei, "utf8")) : [],
);

const anfrage = async (pfad: string, body?: unknown): Promise<Record<string, unknown>> => {
  const antwort = await fetch(`${url}${pfad}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      origin: url,
      cookie: [...kekse].map(([n, w]) => `${n}=${w}`).join("; "),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const zeile of antwort.headers.getSetCookie()) {
    const [name = "", inhalt = ""] = (zeile.split(";")[0] ?? "").split(/=(.*)/s);
    if (inhalt === "") kekse.delete(name.trim());
    else kekse.set(name.trim(), inhalt);
  }
  writeFileSync(keksDatei, JSON.stringify([...kekse]), { mode: 0o600 });
  if (!antwort.ok) throw new Error(`${pfad}: ${antwort.status} ${await antwort.text()}`);
  return (await antwort.json()) as Record<string, unknown>;
};

if (befehl === "einrichten") {
  await anfrage("/api/v1/erster-inhaber", {
    code: wert,
    betreiber: "sz-test",
    name: "sz-test",
    email: "inhaber@sz-test.invalid",
    passwort: PASSWORT,
  });
  const { totpURI } = await anfrage("/api/auth/two-factor/enable", { password: PASSWORT });
  await anfrage("/api/auth/two-factor/verify-totp", {
    code: totpCode(totpSchluessel(String(totpURI))),
  });
  const server = await anfrage("/api/v1/server", {
    name: "zentrale",
    wartungsfenster: { tage: [1], von: "03:00", bis: "04:00" },
    grund: "CI",
  });
  console.log(JSON.stringify({ serverId: server.serverId, befehl: server.befehl }));
} else {
  console.log(JSON.stringify(await anfrage(`/api/v1/server/${encodeURIComponent(wert)}`)));
}
