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

export function formatArtifactBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
