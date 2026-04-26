/** Unique runbook id. Random suffix avoids collisions when the user
 *  imports two archives within the same millisecond. */
export function newRunbookId(): string {
  return `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
