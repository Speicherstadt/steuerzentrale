import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../..");

/** Where agents reach the Zentrale in tests (the e2e port, never a real server) */
export const TEST_AGENT_URL = "http://localhost:28300";

/**
 * A directory as STEUERZENTRALE_AGENT_DATEIEN holds it, for the routes that serve it: the install
 * script of the repository, the public test key, stand-ins for the binaries and their checksums.
 * Whether the signature holds is the script's test (scripts/install-sh.test.ts), not the routes'.
 */
export const testAgentDateien = (aufraeumen: (fn: () => void) => void): string => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-agent-dateien-"));
  aufraeumen(() => rmSync(ordner, { recursive: true, force: true }));
  writeFileSync(join(ordner, "install.sh"), readFileSync(join(REPO, "install/install.sh")));
  writeFileSync(join(ordner, "minisign.pub"), readFileSync(join(REPO, "test/schluessel/test.pub")));
  for (const arch of ["x64", "arm64"])
    writeFileSync(join(ordner, `steuerzentrale-agent-linux-${arch}`), `agent ${arch}\n`);
  writeFileSync(join(ordner, "SHA256SUMS"), "stand-in\n");
  writeFileSync(join(ordner, "SHA256SUMS.minisig"), "stand-in\n");
  return ordner;
};
