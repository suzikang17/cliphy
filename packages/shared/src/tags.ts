// Tag hierarchy convention: a ":" in a tag denotes parent:child nesting, e.g.
// "design:typography" or "work:clients:acme". No schema change — hierarchy lives
// in the tag string. These helpers parse and group flat tag lists into a tree.

export const TAG_SEPARATOR = ":";

/** "design:typography:serif" → ["design","typography","serif"] */
export function tagPath(tag: string): string[] {
  return tag
    .split(TAG_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The immediate parent path, or null for a top-level tag. "a:b:c" → "a:b" */
export function tagParent(tag: string): string | null {
  const parts = tagPath(tag);
  return parts.length > 1 ? parts.slice(0, -1).join(TAG_SEPARATOR) : null;
}

/** The last segment (display label). "a:b:c" → "c" */
export function tagLeaf(tag: string): string {
  const parts = tagPath(tag);
  return parts[parts.length - 1] ?? tag;
}

export interface TagNode {
  /** Full path to this node, e.g. "design:typography". */
  path: string;
  /** Last segment, for display. */
  label: string;
  /** How many actual tags fall under this node (including descendants). */
  count: number;
  children: TagNode[];
}

/**
 * Build a nested tree from a flat list of (possibly hierarchical) tags.
 * Intermediate nodes are created even if only a deeper tag exists — e.g.
 * ["design:typography"] yields design → typography. `count` on a node is the
 * number of input tags at or below it. Children are sorted alphabetically.
 */
export function buildTagTree(tags: string[]): TagNode[] {
  const roots: TagNode[] = [];
  const byPath = new Map<string, TagNode>();

  const ensure = (path: string, label: string, parent: TagNode | null): TagNode => {
    let node = byPath.get(path);
    if (!node) {
      node = { path, label, count: 0, children: [] };
      byPath.set(path, node);
      (parent ? parent.children : roots).push(node);
    }
    return node;
  };

  for (const tag of tags) {
    const parts = tagPath(tag);
    if (!parts.length) continue;
    let parent: TagNode | null = null;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}${TAG_SEPARATOR}${part}` : part;
      const node = ensure(acc, part, parent);
      node.count += 1;
      parent = node;
    }
  }

  const sortRec = (nodes: TagNode[]): TagNode[] => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const n of nodes) sortRec(n.children);
    return nodes;
  };
  return sortRec(roots);
}
