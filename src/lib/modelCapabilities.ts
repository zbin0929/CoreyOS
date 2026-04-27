/**
 * T1.5c — client-side heuristic for "does this model accept images?".
 *
 * We don't trust the gateway's `/v1/models` capabilities payload because
 * the Hermes adapter currently stubs `ModelCapabilities::default()` (all
 * false) rather than populating from provider-specific metadata. Once
 * that gets filled in, this file stays as a safety-net fallback for
 * unknown/third-party models.
 *
 * The tri-state return is deliberate:
 *   - `'yes'` — we confidently know this model understands images.
 *     Paperclip button shows normally.
 *   - `'no'` — we confidently know it doesn't (e.g. deepseek-reasoner,
 *     gpt-3.5-turbo). Paperclip is disabled with an explanatory tooltip.
 *   - `'unknown'` — neither the allow-list nor the deny-list matched.
 *     We keep the button enabled but the tooltip warns the user. Better
 *     to let them try than to block someone on a brand-new model we
 *     haven't heard of yet.
 */
export type VisionSupport = 'yes' | 'no' | 'unknown';

// Deny-list has priority because several explicit text-only models have
// names that loosely pattern-match an allow entry (e.g. `deepseek-chat`
// contains no "vl" but we still want to treat it as text-only).
const DENY_LIST: RegExp[] = [
  /^deepseek-(reasoner|chat|coder|v4-pro|v4-flash)/i,
  /^gpt-3\.5/i,
  /^text-/i, // text-embedding-* etc.
  /-instruct$/i,
  /-text(?:-|$)/i,
];

// Allow-list — any one match → vision-capable.
const ALLOW_LIST: RegExp[] = [
  // OpenAI
  /^gpt-4o/i,
  /^gpt-4\.?1/i,
  /^gpt-5/i,
  /-vision/i,
  // Anthropic
  /^claude-3/i,
  /^claude-4/i,
  /^claude-sonnet/i,
  /^claude-opus/i,
  // Google
  /^gemini-/i,
  // Qwen / DeepSeek / general "VL" / "V" family
  /(^|-)vl(-|$)/i,
  /-vl-/i,
  /-v\d+(\.\d+)?(-|$)/i, // e.g. "qwen2-v5"; false positives acceptable
  // Open-source multimodal
  /^llava/i,
  /^minicpm-v/i,
  /^internvl/i,
  /^idefics/i,
  /^pixtral/i,
];

/**
 * Return whether `modelId` is known to support image inputs.
 * Case-insensitive; whitespace- and null-safe.
 */
export function visionSupport(modelId: string | null | undefined): VisionSupport {
  if (!modelId) return 'unknown';
  const id = modelId.trim();
  if (!id) return 'unknown';
  if (DENY_LIST.some((r) => r.test(id))) return 'no';
  if (ALLOW_LIST.some((r) => r.test(id))) return 'yes';
  return 'unknown';
}
