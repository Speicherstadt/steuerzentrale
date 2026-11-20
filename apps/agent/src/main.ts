import { runCli } from "./cli.ts";

const result = runCli(process.argv.slice(2));
(result.code === 0 ? console.log : console.error)(result.out);
process.exit(result.code);
