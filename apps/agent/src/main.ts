import { runCli } from "./cli.ts";

const result = await runCli(process.argv.slice(2));
(result.code === 0 ? console.log : console.error)(result.out);
// The service keeps running (its connection to the Zentrale comes with Z-303); systemd stops it
if (result.bleiben) setInterval(() => {}, 1 << 30);
else process.exit(result.code);
