import { invoke } from '@tauri-apps/api/core';

/**
 * AI Browser (CDP) IPC bindings — see `src-tauri/src/ipc/browser_cdp.rs`.
 *
 * These power the Settings → AI Browser panel that lets non-technical
 * users give the agent a real, login-persisting browser without ever
 * touching a terminal. The wire format mirrors `BrowserCdpStatus` /
 * `BrowserCdpLaunchResult` on the Rust side; field renames must move
 * both sides in the same commit (AC-3).
 */

export interface BrowserCdpStatus {
  /** Is something listening on the CDP port? */
  running: boolean;
  /** Always 9222 today — exposed so the UI can render "localhost:9222". */
  port: number;
  /** `~/.hermes/chrome-debug` (resolved server-side). */
  profile_dir: string;
  /** Detected Chrome executable, or `null` if none installed. */
  chrome_path: string | null;
  /** True when `BROWSER_CDP_URL` is set in `~/.hermes/.env`. */
  env_configured: boolean;
  /** Domains the dedicated profile has cookies for — i.e. sites the
   *  agent is "logged into". Empty while Chrome is running (sqlite
   *  is locked) or before any browsing has happened. */
  logged_in_domains: string[];
}

export interface BrowserCdpLaunchResult {
  status: BrowserCdpStatus;
  /** Human-readable summary of what happened (Chrome started, env
   *  written, gateway restarted). UI surfaces this in a toast. */
  message: string;
}

export function browserCdpStatus(): Promise<BrowserCdpStatus> {
  return invoke<BrowserCdpStatus>('browser_cdp_status');
}

export function browserCdpLaunch(): Promise<BrowserCdpLaunchResult> {
  return invoke<BrowserCdpLaunchResult>('browser_cdp_launch');
}

export function browserCdpStop(): Promise<BrowserCdpStatus> {
  return invoke<BrowserCdpStatus>('browser_cdp_stop');
}

export function browserCdpClearCookies(): Promise<BrowserCdpStatus> {
  return invoke<BrowserCdpStatus>('browser_cdp_clear_cookies');
}

/** Clear sign-in cookies for a single domain. Refuses if Chrome
 *  is running (sqlite is locked exclusively). */
export function browserCdpClearDomain(domain: string): Promise<BrowserCdpStatus> {
  return invoke<BrowserCdpStatus>('browser_cdp_clear_domain', { domain });
}

// ─── Site aliases ─────────────────────────────────────────────────
// "I'll say '打开店铺', you open https://sellercentral.amazon.com".
// Persisted via `browser_aliases.rs`; the same MCP tools let the agent
// read / mutate the table from chat.

export interface BrowserAlias {
  alias: string;
  url: string;
  /** Unix epoch seconds since the alias was last upserted. */
  updated_at: number;
}

export function browserAliasesList(): Promise<BrowserAlias[]> {
  return invoke<BrowserAlias[]>('browser_aliases_list');
}

export function browserAliasesUpsert(alias: string, url: string): Promise<BrowserAlias> {
  return invoke<BrowserAlias>('browser_aliases_upsert', { args: { alias, url } });
}

export function browserAliasesRemove(alias: string): Promise<boolean> {
  return invoke<boolean>('browser_aliases_remove', { args: { alias } });
}
