/**
 * The integration doctor is the harness's claim to being a composition root:
 * the compatibility matrix plus a report that turns silent misconfiguration
 * into words. These tests pin the version matching and the report shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import integrationExtension, { COMPATIBILITY, integrationReport } from "./extension.js";

test("the matrix covers the required suite and optional peer advisor", () => {
  assert.deepEqual(Object.keys(COMPATIBILITY).sort(), [
    "@minhduydev/pi-core",
    "@minhduydev/pi-learning",
    "@minhduydev/pi-subagents",
    "@minhduydev/pi-todo",
    "pi-peer",
  ]);
});

test("the matrix matches the current suite generation", () => {
  assert.deepEqual(COMPATIBILITY, {
    "@minhduydev/pi-core": { range: ">=0.3.0 <0.4.0", protocol: 1 },
    "@minhduydev/pi-subagents": { range: ">=0.11.0 <0.13.0" },
    "@minhduydev/pi-learning": { range: ">=0.6.0 <0.7.0" },
    "@minhduydev/pi-todo": { range: ">=0.6.0 <0.7.0" },
    "pi-peer": { range: ">=1.2.0 <1.3.0", optional: true },
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
  const peer = statuses.find((status) => status.name === "pi-peer");
  assert.ok(peer);
  assert.equal(peer.installed, undefined);
  assert.equal(peer.ok, true);
  assert.match(peer.detail, /optional/i);
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

test("reports an installed optional peer outside the verified range", () => {
  const statuses = integrationReport(process.cwd(), (name: string) =>
    name === "pi-peer" ? "1.3.0" : undefined,
  );
  const peer = statuses.find((status) => status.name === "pi-peer");
  assert.ok(peer);
  assert.equal(peer.installed, "1.3.0");
  assert.equal(peer.ok, false);
  assert.match(peer.detail, /outside the verified range/i);
});
