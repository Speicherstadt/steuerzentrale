import { VERSION } from "@steuerzentrale/protokoll";
import { createApp } from "./app.ts";
import { parseEnv } from "./env.ts";

const readEnv = () => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // The reason names the variable, never its value
    const reasons = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues?.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    console.error(
      JSON.stringify({ msg: "refusing to start", reasons: reasons ?? ["invalid environment"] }),
    );
    process.exit(1);
  }
};

const env = readEnv();
const app = createApp({ log: (line) => console.log(line), now: Date.now, version: VERSION });
const server = Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch });
console.log(JSON.stringify({ msg: "listening", url: server.url.href, version: VERSION }));
