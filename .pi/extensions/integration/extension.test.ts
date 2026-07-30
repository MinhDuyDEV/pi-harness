/**
 * The integration doctor is the harness's claim to being a composition root:
 * the compatibility matrix plus a report that turns silent misconfiguration
 * into words. These tests pin the version matching and the report shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import integrationExtension, { COMPATIBILITY, integrationReport } from "./extension.js";

test("the matrix covers exactly the four suite packages", () => {
  assert.deepEqual(Object.keys(COMPATIBILITY).sort(), [
    "@minhduydev/pi-core",
    "@minhduydev/pi-learning",
    "@minhduydev/pi-subagents",
    "@minhduydev/pi-todo",
  ]);
});

test("the matrix matches the current suite generation", () => {
  assert.deepEqual(COMPATIBILITY, {
    "@minhduydev/pi-core": { range: ">=0.3.0 <0.4.0", protocol: 1 },
    "@minhduydev/pi-subagents": { range: ">=0.11.0 <0.12.0" },
    "@minhduydev/pi-learning": { range: ">=0.5.0 <0.6.0" },
    "@minhduydev/pi-todo": { range: ">=0.5.0 <0.6.0" },
  });
});

test("a dev checkout reports its own installed siblings as compatible", () => {
  // This repo has pi-core installed (a devDependency); the report must find
  // it through the module graph and judge it against the matrix.
  const statuses = integrationReport(process.cwd());
  const core = statuses.find((status) => status.name === "@minhduydev/pi-core");
  assert.ok(core);
  assert.ok(core.installed, "pi-core must be resolvable from the harness checkout");
  assert.equal(core.ok, true, `pi-core ${core.installed} should satisfy ${core.wanted}`);
});

test("/integration renders every package with a verdict", async () => {
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }
  >();
  const fakePi = {
    registerCommand(name: string, options: never) {
      commands.set(name, options);
    },
    on() {},
  } as unknown as ExtensionAPI;
  integrationExtension(fakePi);

  let output = "";
  await commands.get("integration")?.handler("", {
    ui: {
      notify(message: string) {
        output = message;
      },
    },
  } as unknown as ExtensionCommandContext);

  for (const name of Object.keys(COMPATIBILITY)) {
    assert.match(output, new RegExp(name.replace(/[/@]/g, "\\$&")), `${name} in report`);
  }
  assert.match(output, /pi-core protocol: 1/);
});
