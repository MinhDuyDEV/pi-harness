import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readExtensionGate } from "../lib/harness-settings.js";

// The snap-edit extension is a faithful, vendored port of sting8k/pi-snap-edit
// 5.0.0. Upstream peers `@earendil-works/pi-coding-agent`/`pi-tui` at ^0.78.0,
// which ERESOLVEs against Pi 0.81.1, so the source is vendored here and bound
// to the host's installed 0.81.1 packages instead. The only adaptation is the
// typebox import name in schemas.ts; every editing routine is unchanged.
//
// Vendoring keeps the proven atomic guarded-edit semantics intact. This
// wrapper adds the harness opt-in gate (`pi-harness.extensions.snapEdit`),
// defaulting off except in the `full` profile, then delegates to the upstream
// register function.
import snapEditRegister from "./extension.js";

export default function snapEditExtension(pi: ExtensionAPI): void {
  if (!readExtensionGate(undefined, "snapEdit", false)) {
    return;
  }
  snapEditRegister(pi);
}
