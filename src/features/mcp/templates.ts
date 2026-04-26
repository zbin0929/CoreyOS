import type { McpServer } from '@/lib/ipc';

import type { Transport } from './transport';

/**
 * Ready-to-tweak templates for common MCP servers. Picking one fills
 * transport + config + (if the id field is empty) suggests an id;
 * the user still has to fill in tokens / paths before saving.
 * Sources are the ones documented at
 * hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes.
 */
export interface Template {
  key: string;
  label: string;
  transport: Transport;
  suggestedId: string;
  config: Record<string, unknown>;
  /** Optional one-liner shown under the picker when this template
   *  is selected. Used to explain vendor-specific quirks (API key
   *  quota, setup steps) without bloating the main copy. */
  description?: string;
  /** Vendor console / docs URL. Rendered as a small "↗ docs" link
   *  next to the description so users can land on the API-key page
   *  in one click. */
  setupUrl?: string;
  /** Hermes v0.10.0+ bundles web search (Firecrawl), image gen, TTS,
   *  and browser automation for Nous Portal subscribers. When set, the
   *  picker shows a small "you may not need this" hint so paying users
   *  don't double-configure. */
  nousBundledHint?: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    key: 'filesystem',
    label: 'Filesystem (project-local)',
    transport: 'stdio',
    suggestedId: 'project_fs',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/project'],
    },
  },
  {
    key: 'github',
    label: 'GitHub',
    transport: 'stdio',
    suggestedId: 'github',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_…' },
      tools: { include: ['list_issues', 'create_issue', 'search_code'] },
    },
  },
  {
    key: 'stripe',
    label: 'Stripe (URL + read-only)',
    transport: 'url',
    suggestedId: 'stripe',
    config: {
      url: 'https://mcp.stripe.com',
      headers: { Authorization: 'Bearer sk_…' },
      tools: { exclude: ['delete_customer', 'refund_payment'] },
    },
  },
  {
    key: 'puppeteer',
    label: 'Puppeteer (headless browser)',
    transport: 'stdio',
    suggestedId: 'browser',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  // ─────────── Web search providers (T9 one-click) ───────────
  //
  // Give the agent the ability to search the live web. All five
  // below are first-party or well-maintained community MCP servers
  // exposing one or two tools that return structured search results
  // (title + url + snippet), which Hermes calls transparently when
  // the LLM decides a query needs web context.
  //
  // Cost / free-tier shape is mentioned in the description so users
  // don't sign up blind. Setup URLs point straight at the console's
  // API-key page — no hunting through marketing copy.
  {
    key: 'brave-search',
    label: 'Brave Search (web_search)',
    transport: 'stdio',
    suggestedId: 'brave_search',
    description:
      'Web + local search via Brave. Free tier: 2000 queries/month; API key at brave.com/search/api.',
    setupUrl: 'https://brave.com/search/api/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: 'BSA…' },
    },
  },
  {
    key: 'tavily-search',
    label: 'Tavily Search (AI-native)',
    transport: 'stdio',
    suggestedId: 'tavily',
    description:
      'AI-optimised search with citations. Free tier: 1000 queries/month; key at app.tavily.com.',
    setupUrl: 'https://app.tavily.com/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', 'tavily-mcp'],
      env: { TAVILY_API_KEY: 'tvly-…' },
    },
  },
  {
    key: 'duckduckgo-search',
    label: 'DuckDuckGo Search (no key)',
    transport: 'stdio',
    suggestedId: 'ddg',
    description:
      'Free unlimited search via DuckDuckGo — no API key required, but rate-limited on their side.',
    setupUrl: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    nousBundledHint: true,
    config: {
      command: 'uvx',
      args: ['duckduckgo-mcp-server'],
    },
  },
  {
    key: 'perplexity-search',
    label: 'Perplexity Sonar (search + answer)',
    transport: 'stdio',
    suggestedId: 'perplexity',
    description:
      'Ask-and-answer combo — searches and summarises in one call. Paid only; key at perplexity.ai/settings/api.',
    setupUrl: 'https://www.perplexity.ai/settings/api',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', '@chatmcp/server-perplexity-ask'],
      env: { PERPLEXITY_API_KEY: 'pplx-…' },
    },
  },
  {
    key: 'serper-search',
    label: 'Serper (Google results)',
    transport: 'stdio',
    suggestedId: 'serper',
    description:
      'Google search results via Serper. Free tier: 2500 queries trial; key at serper.dev.',
    setupUrl: 'https://serper.dev/',
    nousBundledHint: true,
    config: {
      command: 'npx',
      args: ['-y', 'serper-search-scrape-mcp-server'],
      env: { SERPER_API_KEY: '' },
    },
  },
  // ─────────── Other high-value community MCP servers ───────────
  {
    key: 'fetch',
    label: 'Fetch (URL → text)',
    transport: 'stdio',
    suggestedId: 'fetch',
    description:
      'Download a URL and convert to Markdown. Useful alongside a search server — the agent searches, then fetches the top link.',
    config: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
  },
  {
    key: 'memory',
    label: 'Memory (knowledge graph)',
    transport: 'stdio',
    suggestedId: 'memory',
    description:
      'Persistent knowledge graph the agent can write to and query across sessions — complements Hermes\u2019 MEMORY.md for structured facts.',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
];

/** One-click "common server" buttons rendered below the list when no
 *  edit form is open. Subset of TEMPLATES with simpler defaults that
 *  don't require any setup tokens. */
export const RECOMMENDED_MCPS: { id: string; label: string; config: McpServer }[] = [
  {
    id: 'fetch',
    label: 'Fetch',
    config: {
      id: 'fetch',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
    },
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    config: {
      id: 'filesystem',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
      },
    },
  },
  {
    id: 'memory',
    label: 'Memory',
    config: {
      id: 'memory',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    },
  },
  {
    id: 'ddg',
    label: 'DuckDuckGo',
    config: {
      id: 'ddg',
      config: { command: 'uvx', args: ['duckduckgo-mcp-server'] },
    },
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    config: {
      id: 'sqlite',
      config: { command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '~/.hermes/state.db'] },
    },
  },
];
