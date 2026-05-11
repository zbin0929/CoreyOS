/**
 * Helpers for the chat ArtifactBlock component.
 *
 * Lives in its own file (separate from `ArtifactBlock.tsx`) so the
 * component module exports only React components — that's what
 * `react-refresh/only-export-components` wants for fast-refresh to
 * survive code-mode edits in dev.
 */

export function shouldRenderAsArtifact(raw: string): boolean {
  const lines = raw.split('\n').length;
  return lines >= 30 || raw.length >= 2000;
}

/**
 * Detects `corey://artifact/<run_id>/<name>` URLs the agent emits
 * via the base-soul artifact-link convention. Returns the parsed
 * pair, or `null` if the href doesn't match. Lives here (not in
 * `ArtifactLinkCard.tsx`) so the Markdown renderer can import it
 * without dragging in the React component — keeps fast-refresh
 * happy via the only-export-components rule.
 *
 * We intentionally only accept names without slashes; the backend
 * sanitiser also refuses path separators, but failing fast here
 * means the chat doesn't render a card for an unopenable link.
 */
export function parseArtifactUrl(
  href: string | undefined,
): { runId: string; name: string } | null {
  if (typeof href !== 'string' || !href.startsWith('corey://artifact/')) return null;
  const rest = href.slice('corey://artifact/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const runId = decodeURIComponent(rest.slice(0, slash));
  const name = decodeURIComponent(rest.slice(slash + 1));
  if (!runId || !name || name.includes('/')) return null;
  return { runId, name };
}

export function formatArtifactBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
