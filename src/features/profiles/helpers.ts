/**
 * Encode an `ArrayBuffer` into base64 without blowing the call stack
 * on big buffers. `btoa(String.fromCharCode(...chunk))` blows up past
 * ~65 kB on most engines; chunking at 32 kB keeps us on the safe side
 * across WebKit/WebView2.
 */
export function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000; // 32 KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Render a byte count using human-friendly units. Returned as `'—'`
 * for non-finite or negative inputs so the UI can stay total without
 * a special-case branch.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
