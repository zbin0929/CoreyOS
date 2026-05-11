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
