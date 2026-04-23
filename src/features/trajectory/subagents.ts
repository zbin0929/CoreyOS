import type { DbToolCallRow } from '@/lib/ipc';

/**
 * T6.3 — subagent tree grouping.
 *
 * Today Hermes emits a FLAT stream of `hermes.tool.progress` events:
 * each has `tool` + `emoji` + `label`, with no explicit parent linkage
 * (see `HermesToolProgress` in `src-tauri/src/adapters/hermes/gateway.rs`).
 * When the agent uses the native `delegate_task` tool, the subagent's
 * own tool calls arrive as subsequent events in the SAME stream — the
 * UI has no structural signal telling it "this terminal call belongs
 * to the delegated subagent, not the main agent".
 *
 * Per the 2026-04-23 product audit, we don't build a parallel protocol
 * (no meta-adapter, no sidecar JSON-lines). Instead we INFER the tree
 * from event ordering: a `delegate_task` parent adopts every
 * subsequent tool call in its message's list until the next
 * `delegate_task` (or until the list ends). That covers the dominant
 * shape — a single delegated sub-task emitting a handful of nested
 * tool calls — and degrades to a flat list when there's no delegation.
 *
 * If upstream Hermes later adds explicit `parent_tool_call_id` or
 * `agent_id` fields, this helper is the single place to consume them:
 * extend the `ToolCallLike` shape with the new fields and swap the
 * heuristic for a proper parent lookup. Callers stay the same.
 */

/**
 * Subset of `DbToolCallRow` we actually need. Decoupled from the DB
 * row so the helper stays useful against the live zustand
 * `UiToolCall` shape too (both carry `tool` + `label` + `at` +
 * stable id).
 */
export interface ToolCallLike {
  id: string;
  tool: string;
  emoji: string | null;
  label: string | null;
  at: number;
}

/**
 * One node in the inferred tree. A top-level call with `children = []`
 * is indistinguishable from a leaf; the rendering layer can rely on
 * `children.length` to decide whether to show a disclosure chevron.
 */
export interface SubagentNode {
  call: ToolCallLike;
  /** Non-empty only for `delegate_task` parents. */
  children: ToolCallLike[];
}

/** Exported for tests + renderer — a single source of truth for the
 *  "is this the delegation kickoff?" check so renaming Hermes's tool
 *  (unlikely but possible) is a one-line change. */
export const DELEGATE_TASK_TOOL = 'delegate_task';

/**
 * Group a flat list into the inferred subagent tree. Stable ordering
 * preserved: top-level nodes appear in the same order as their
 * underlying calls; children inside a parent keep the order they
 * arrived in. Total output node count equals the input length (no
 * duplication, no drops) so callers can still report "X tool calls"
 * totals unchanged.
 */
export function groupToolCallsBySubagent(
  calls: ToolCallLike[] | null | undefined,
): SubagentNode[] {
  if (!calls || calls.length === 0) return [];
  const out: SubagentNode[] = [];
  let currentParent: SubagentNode | null = null;

  for (const c of calls) {
    if (c.tool === DELEGATE_TASK_TOOL) {
      currentParent = { call: c, children: [] };
      out.push(currentParent);
    } else if (currentParent) {
      currentParent.children.push(c);
    } else {
      out.push({ call: c, children: [] });
    }
  }
  return out;
}

/** True iff the list contains at least one `delegate_task` call. Used
 *  by the Trajectory renderer to decide whether to show the tree
 *  view at all — messages without delegation don't need the extra
 *  disclosure UI. */
export function hasDelegation(calls: ToolCallLike[] | null | undefined): boolean {
  if (!calls) return false;
  return calls.some((c) => c.tool === DELEGATE_TASK_TOOL);
}

/** Convenience alias so the Trajectory file can import the DB row
 *  shape without needing to know about `ToolCallLike`. The shapes
 *  intentionally overlap. */
export function groupDbToolCalls(calls: DbToolCallRow[]): SubagentNode[] {
  return groupToolCallsBySubagent(calls);
}
