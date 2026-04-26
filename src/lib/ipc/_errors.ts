// ───────────────────────── Error envelope ─────────────────────────

export type IpcErrorKind =
  | 'not_configured'
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream'
  | 'protocol'
  | 'unsupported'
  | 'internal'
  | 'sandbox_denied'
  | 'sandbox_consent_required';

export interface IpcError {
  kind: IpcErrorKind;
  [k: string]: unknown;
}

/** Coerce whatever invoke() rejected with into a human message. */
export function ipcErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'kind' in e) {
    const err = e as IpcError;
    switch (err.kind) {
      case 'unreachable':
        return `Gateway unreachable at ${err.endpoint}: ${err.message}`;
      case 'unauthorized':
        return `Unauthorized: ${err.detail}`;
      case 'rate_limited':
        return `Rate limited${err.retry_after_s ? `, retry in ${err.retry_after_s}s` : ''}`;
      case 'upstream':
        return `Upstream error ${err.status}: ${String(err.body).slice(0, 200)}`;
      case 'protocol':
        return `Protocol error: ${err.detail}`;
      case 'unsupported':
        return `Unsupported capability: ${err.capability}`;
      case 'not_configured':
        return `Not configured: ${err.hint}`;
      case 'internal':
        return `Internal error: ${err.message}`;
      case 'sandbox_denied':
        return `Sandbox denied ${err.path} (${err.reason})`;
      case 'sandbox_consent_required':
        return `Sandbox requires consent for ${err.path}`;
      default:
        return JSON.stringify(err);
    }
  }
  return typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
}

