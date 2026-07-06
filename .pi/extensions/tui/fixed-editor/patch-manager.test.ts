import { describe, it, expect, beforeEach } from "bun:test";
import { PatchManager } from "./patch-manager.ts";

function makeTarget(id: string) {
  return {
    id,
    render(width: number): string[] {
      return [`[${id} rendered at ${width}]`];
    },
  };
}

describe("PatchManager", () => {
  let pm: PatchManager;

  beforeEach(() => {
    pm = new PatchManager();
  });

  describe("hide / renderHidden", () => {
    it("replaces render with a no-op", () => {
      const target = makeTarget("foo");
      const original = target.render;
      pm.hide(target);
      expect(target.render(80)).toEqual([]);
      expect(target.render).not.toBe(original);
    });

    it("renderHidden calls the original render", () => {
      const target = makeTarget("bar");
      pm.hide(target);
      const result = pm.renderHidden(target, 80);
      expect(result).toEqual(["[bar rendered at 80]"]);
    });

    it("renderHidden returns default render if not patched", () => {
      const target = makeTarget("baz");
      const result = pm.renderHidden(target, 120);
      expect(result).toEqual(["[baz rendered at 120]"]);
    });
  });

  describe("retain", () => {
    it("removes patches for targets not in the retain list", () => {
      const a = makeTarget("a");
      const b = makeTarget("b");
      pm.hide(a);
      pm.hide(b);
      expect(pm.patchCount).toBe(2);

      pm.retain([a]);
      expect(pm.patchCount).toBe(1);

      // b should be restored
      expect(b.render(80)).toEqual(["[b rendered at 80]"]);
    });

    it("keeps patches for targets still in the list", () => {
      const a = makeTarget("a");
      pm.hide(a);
      pm.retain([a]);
      expect(pm.patchCount).toBe(1);
      expect(a.render(80)).toEqual([]); // still patched
    });

    it("handles null/undefined in retain list", () => {
      const a = makeTarget("a");
      pm.hide(a);
      pm.retain([null, undefined]);
      expect(pm.patchCount).toBe(0);
    });
  });

  describe("dispose", () => {
    it("restores all targets", () => {
      const a = makeTarget("a");
      const b = makeTarget("b");
      pm.hide(a);
      pm.hide(b);
      pm.dispose();

      expect(a.render(80)).toEqual(["[a rendered at 80]"]);
      expect(b.render(80)).toEqual(["[b rendered at 80]"]);
      expect(pm.patchCount).toBe(0);
    });

    it("is idempotent", () => {
      const a = makeTarget("a");
      pm.hide(a);
      pm.dispose();
      pm.dispose();
      expect(a.render(80)).toEqual(["[a rendered at 80]"]);
    });

    it("handles empty manager", () => {
      pm.dispose();
      expect(pm.patchCount).toBe(0);
    });
  });

  describe("hide cleanup function", () => {
    it("removes a single patch and restores target", () => {
      const a = makeTarget("a");
      const cleanup = pm.hide(a);
      expect(a.render(80)).toEqual([]);
      cleanup();
      expect(a.render(80)).toEqual(["[a rendered at 80]"]);
      expect(pm.patchCount).toBe(0);
    });

    it("is idempotent", () => {
      const a = makeTarget("a");
      const cleanup = pm.hide(a);
      cleanup();
      cleanup();
      expect(a.render(80)).toEqual(["[a rendered at 80]"]);
    });
  });
});
