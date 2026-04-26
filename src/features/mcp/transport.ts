/**
 * Transport classification for an MCP server config blob. Hermes
 * spawns stdio servers as subprocesses and connects to URL servers
 * over HTTP/SSE; the form picks the right field set based on this.
 */
export type Transport = 'stdio' | 'url';

export function detectTransport(config: Record<string, unknown>): Transport {
  if (typeof config.url === 'string') return 'url';
  return 'stdio';
}

/** Starter JSON for a fresh server. Kept intentionally skeletal so
 *  the user sees an obvious "fill me in" shape rather than a long
 *  commented template. Real examples live in the upstream Hermes MCP
 *  docs the subtitle links to. */
export function defaultConfig(transport: Transport): Record<string, unknown> {
  if (transport === 'url') {
    return {
      url: 'https://mcp.example.com',
      headers: {},
    };
  }
  return {
    command: 'npx',
    args: [],
  };
}
