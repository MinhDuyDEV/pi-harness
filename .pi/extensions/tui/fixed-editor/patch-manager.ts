/**
 * patch-manager.ts — Lifecycle management for renderable patches.
 *
 * pi-tui renders components by calling `render(width)` on a tree.
 * The compositor hides certain components (so they don't render into the
 * scrollable area) but still calls `render()` on them to get their content
 * for the fixed cluster area.
 *
 * A "patch" is a (target, originalRender) pair. The PatchManager handles
 * installation, retention (keeping a patched component), rendering hidden
 * components, and final restoration.
 *
 * This module is a bounded lifecycle concern independent of scroll/selection state.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PatchedTarget {
  render(width: number): string[];
}

interface Patch {
  target: PatchedTarget;
  originalRender: (width: number) => string[];
  disposed: boolean;
}

// ── PatchManager ──────────────────────────────────────────────────────────────

export class PatchManager {
  private patches: Patch[] = [];

  /**
   * Hide a renderable by replacing its `render` method.
   * Returns a cleanup function that removes just this patch.
   */
  hide(target: PatchedTarget): () => void {
    const originalRender = target.render.bind(target);
    target.render = () => [];
    const patch: Patch = { target, originalRender, disposed: false };
    this.patches.push(patch);
    return () => {
      if (patch.disposed) return;
      patch.disposed = true;
      target.render = originalRender;
      const idx = this.patches.indexOf(patch);
      if (idx !== -1) this.patches.splice(idx, 1);
    };
  }

  /**
   * Retain only the given targets — dispose patches for targets not in the list.
   * This handles stale patches when the component tree changes.
   */
  retain(targets: Array<PatchedTarget | null | undefined>): void {
    const keep = new Set(targets.filter(Boolean) as PatchedTarget[]);
    for (const patch of this.patches) {
      if (!patch.disposed && !keep.has(patch.target)) {
        patch.disposed = true;
        patch.target.render = patch.originalRender;
      }
    }
    this.patches = this.patches.filter((p) => !p.disposed);
  }

  /**
   * Call the original `render` on a patched target without side effects.
   * This allows the compositor to get the content for the fixed cluster.
   */
  renderHidden(target: PatchedTarget, width: number): string[] {
    const patch = this.patches.find((p) => p.target === target);
    if (!patch || patch.disposed) return target.render(width);
    return patch.originalRender(width);
  }

  /** Number of active patches — useful for diagnostics. */
  get patchCount(): number {
    return this.patches.length;
  }

  /** Restore ALL patches in reverse order. Guarantees clean state. */
  dispose(): void {
    // Restore in reverse — more likely that nested patches were applied
    // after outer ones, so reverse avoids orphan chains.
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      if (!patch.disposed) {
        patch.disposed = true;
        patch.target.render = patch.originalRender;
      }
    }
    this.patches = [];
  }
}
