import { beispielImagesBauen } from "../../../scripts/beispiel-images.ts";
import { podmanVersion } from "./podman.ts";

/** vitest globalSetup of the agent tests: the example app's images and manifests, where Podman is */
export default function setup(): void {
  if (podmanVersion() === null) return;
  beispielImagesBauen();
}
