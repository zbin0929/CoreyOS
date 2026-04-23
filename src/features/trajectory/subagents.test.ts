import { describe, expect, it } from 'vitest';
import {
  DELEGATE_TASK_TOOL,
  groupToolCallsBySubagent,
  hasDelegation,
  type ToolCallLike,
} from './subagents';

function call(id: string, tool: string, at = 0): ToolCallLike {
  return { id, tool, emoji: null, label: null, at };
}

describe('groupToolCallsBySubagent', () => {
  it('returns [] on empty / nullish input', () => {
    expect(groupToolCallsBySubagent([])).toEqual([]);
    expect(groupToolCallsBySubagent(null)).toEqual([]);
    expect(groupToolCallsBySubagent(undefined)).toEqual([]);
  });

  it('keeps a flat list when no delegation is present', () => {
    const calls = [call('a', 'terminal'), call('b', 'file_read'), call('c', 'web_search')];
    const tree = groupToolCallsBySubagent(calls);
    expect(tree).toHaveLength(3);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
    expect(tree.map((n) => n.call.id)).toEqual(['a', 'b', 'c']);
  });

  it('groups subsequent calls under a delegate_task parent', () => {
    const tree = groupToolCallsBySubagent([
      call('a', 'terminal'),
      call('p1', DELEGATE_TASK_TOOL),
      call('c1', 'terminal'),
      call('c2', 'file_read'),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.call.id).toBe('a');
    expect(tree[0]!.children).toHaveLength(0);

    expect(tree[1]!.call.id).toBe('p1');
    expect(tree[1]!.children.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('starts a new group when a second delegate_task fires', () => {
    const tree = groupToolCallsBySubagent([
      call('p1', DELEGATE_TASK_TOOL),
      call('c1', 'terminal'),
      call('p2', DELEGATE_TASK_TOOL),
      call('c2', 'file_read'),
      call('c3', 'web_search'),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.call.id).toBe('p1');
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['c1']);
    expect(tree[1]!.call.id).toBe('p2');
    expect(tree[1]!.children.map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  it('handles a delegation that has zero children (empty subagent)', () => {
    const tree = groupToolCallsBySubagent([
      call('a', 'terminal'),
      call('p', DELEGATE_TASK_TOOL),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[1]!.children).toEqual([]);
  });

  it('preserves input ordering within each bucket', () => {
    const tree = groupToolCallsBySubagent([
      call('a', 'terminal', 100),
      call('b', 'file_read', 200),
      call('p', DELEGATE_TASK_TOOL, 300),
      call('c2', 'web_search', 400),
      call('c1', 'terminal', 500),
    ]);
    expect(tree.map((n) => n.call.id)).toEqual(['a', 'b', 'p']);
    expect(tree[2]!.children.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('total node count equals input length', () => {
    const input = [
      call('a', 'terminal'),
      call('p', DELEGATE_TASK_TOOL),
      call('c1', 'terminal'),
      call('c2', 'web_search'),
    ];
    const tree = groupToolCallsBySubagent(input);
    const total =
      tree.length + tree.reduce((acc, n) => acc + n.children.length, 0);
    expect(total).toBe(input.length);
  });
});

describe('hasDelegation', () => {
  it('returns false for no delegate_task', () => {
    expect(hasDelegation([call('a', 'terminal')])).toBe(false);
    expect(hasDelegation([])).toBe(false);
    expect(hasDelegation(null)).toBe(false);
  });
  it('returns true when any call is delegate_task', () => {
    expect(
      hasDelegation([call('a', 'terminal'), call('p', DELEGATE_TASK_TOOL)]),
    ).toBe(true);
  });
});
