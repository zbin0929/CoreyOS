/**
 * Channels with a shipping end-to-end smoke test.
 *
 * Each id here corresponds to a Playwright spec that walks the full
 * configure-and-save loop through the mocked Tauri IPC layer. The
 * Channels page surfaces a small "Verified" badge on these cards so
 * users can tell at a glance which integrations we've actually
 * exercised vs the ones whose schema came out of `hermes-reality-check-
 * 2026-04-23.md` but haven't been manually smoke-tested yet.
 *
 * Adding an entry here without also shipping the matching spec would
 * be a lie — keep this file and the `e2e/*-smoke.spec.ts` files in
 * sync at the same commit.
 *
 * Current coverage:
 *   - `telegram` (T6.7b) → `e2e/telegram-smoke.spec.ts`.
 *   - `discord`, `slack`, `feishu`, `weixin`, `wecom` (T6.7c) →
 *     `e2e/channels-smoke.spec.ts` (one parameterised test per id).
 *
 * WhatsApp intentionally excluded — the schema is still in flux per
 * T6.7a's changelog entry. Matrix has no smoke spec yet either;
 * it's a low-priority integration today.
 */
export const VERIFIED_CHANNELS: ReadonlySet<string> = new Set<string>([
  'telegram',
  'discord',
  'slack',
  'feishu',
  'weixin',
  'wecom',
]);

/** True when the channel has a shipping e2e smoke test. */
export function isVerifiedChannel(id: string): boolean {
  return VERIFIED_CHANNELS.has(id);
}
