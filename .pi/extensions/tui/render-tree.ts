export interface Renderable {
  render(width: number): string[];
}

export interface RenderContainerMatch {
  container: Renderable & { children: unknown[] };
  index: number;
}

export function isRenderable(value: unknown): value is Renderable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { render?: unknown }).render === "function"
  );
}

export function findRenderableContainerWithChild(
  tui: unknown,
  child: unknown,
): RenderContainerMatch | null {
  const children = Array.isArray((tui as { children?: unknown })?.children)
    ? (tui as { children: unknown[] }).children
    : [];
  const index = children.findIndex((candidate) => {
    if (!isRenderable(candidate)) return false;
    const candidateChildren = (candidate as Renderable & { children?: unknown })
      .children;
    return Array.isArray(candidateChildren) && candidateChildren.includes(child);
  });
  if (index === -1) return null;

  return {
    container: children[index] as RenderContainerMatch["container"],
    index,
  };
}
