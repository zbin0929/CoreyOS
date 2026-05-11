# Upstream proposal — finer-grained pre-tool hook events for Hermes Agent

**Status**: Draft · **Target repo**: hermes-agent · **Priority**: Medium
**Filed by**: Corey team · **Date**: 2026-05-11 (post-incident draft)

---

## Motivation

Hermes Agent currently exposes a single `pre_tool_call` hook event that
fires before *every* tool invocation, regardless of tool class. This
is sufficient for observation / logging but makes **selective hard
gates** awkward to build.

Concrete incident (Corey, 2026-05-11):

1. User asks agent to delete `~/Desktop/test.md`.
2. Agent calls `terminal` tool with `rm ~/Desktop/test.md`.
3. Hermes `DANGEROUS_PATTERNS` regex blocks the shell call ✅
4. **Agent reasons**: "shell is blocked, I'll use `code_execution`
   with `os.remove(...)` instead."
5. No hook fires on the code-exec path until our single `pre_tool_call`
   hook sees `{tool_name: "code_execution", tool_input: {code: "..."}}`
   — requiring every downstream guard to duplicate the "is this tool
   a shell / code_exec / file_ops?" dispatch logic.

The existing `matcher:` field on a hook entry helps (regex on
`tool_name`), but it means **one guard script per class** — or a
single script with `STRUCTURED_TOOLS` / `SHELL_TOOLS` / `CODE_TOOLS`
sets hard-coded inside (which is what Corey ended up doing). That
dispatch logic belongs in Hermes, not in every third-party guard.

## Proposal

Add four narrower hook events alongside the existing
`pre_tool_call` / `post_tool_call`:

| Event | Fires before | Typical payload |
|-------|--------------|-----------------|
| `pre_file_ops` | structured file tools (delete/move/write/edit) | `{path, operation}` |
| `pre_shell` | shell/terminal tools | `{command, cwd, env}` |
| `pre_code_execution` | Python / JS in-process code execution | `{language, code}` |
| `pre_browser_write` | destructive browser clicks (matching HARDLINE patterns) | `{url, ref, action_verb}` |

The existing `pre_tool_call` event stays — narrower events fire in
*addition*, not instead. This preserves backward compatibility for
observability hooks.

Each narrower event emits a semantically meaningful payload
(`path` / `command` / `code` / `url`) rather than the generic
`tool_input` blob, so guards don't need to know the schema of each
tool's input dict. Example:

```python
# pre_file_ops payload
{
  "path": "/Users/alice/Desktop/important.md",  # already expanded
  "operation": "delete",                         # delete | move | write | edit
  "original_path": "~/Desktop/important.md",    # pre-expansion
  "session_id": "sess_abc",
  "cwd": "/Users/alice/projects"
}

# pre_code_execution payload
{
  "language": "python",   # python | javascript | ...
  "code": "import os; os.remove('/tmp/x')",
  "session_id": "sess_abc",
  "cwd": "/Users/alice/projects"
}
```

## Why this helps

1. **Guards compose**: one guard per concern (path guard, command
   guard, code guard) rather than one mega-guard with internal
   tool-name dispatch.
2. **No silent gaps**: if Hermes adds a new file tool in v0.13,
   existing `pre_file_ops` hooks automatically cover it. Today the
   `STRUCTURED_TOOLS` set in every third-party guard has to be
   updated by hand.
3. **Semantic payloads**: guards can reason about `{path, operation}`
   without re-implementing path extraction for each tool's unique
   input key (`path` vs `file_path` vs `target` vs ...).
4. **Finer matchers**: a path-based guard can register only for
   `pre_file_ops` + `pre_shell`, skipping the LLM-heavy
   `pre_tool_call` path entirely for better performance on chatty
   sessions.

## Backward compatibility

- `pre_tool_call` / `post_tool_call` remain unchanged.
- `matcher:` field remains; works against `tool_name` in the
  narrower events' payload too.
- Existing guards continue to fire on every tool call. Operators
  migrate at their own pace by registering additional narrower
  hooks.

## Implementation sketch

In `agent/shell_hooks.py::invoke_hook` (the central dispatcher),
after the existing `pre_tool_call` invocation:

```python
narrower = _classify_tool(tool_name)   # 'file_ops' | 'shell' | 'code_exec' | 'browser' | None
if narrower:
    event = f"pre_{narrower}"
    narrower_payload = _build_narrower_payload(narrower, tool_input)
    invoke_hook(event, **narrower_payload, session_id=sid, ...)
```

`_classify_tool` is the set-based dispatch that currently lives in
every third-party guard — centralise it here.

## Alternative considered

Shipping a library function `hermes.guard.is_destructive_file_op(tool_name, tool_input)`
so guards call *into* Hermes to get the classification. Rejected
because:

1. It's a slower solution (extra import per hook invocation).
2. Guards written in bash / Python 2 / Ruby can't use it.
3. Doesn't solve the "one guard per concern" composability goal.

## Open questions

- Should `post_file_ops` / `post_shell` / etc. also exist? Useful for
  rollback / audit but increases hook-fire noise. **Preference**:
  add them only if a concrete user asks.
- `pre_browser_write` — scope question. The HARDLINE browser
  actions (click on "Delete" button etc.) are currently handled
  inside `agent/browser_tools.py::check_hardline`. Moving that gate
  to a hook event is a bigger refactor. Suggest deferring to a
  follow-up PR.

## References

- Corey's current workaround: `src-tauri/assets/corey-guards/file-ops-guard.py`
  (STRUCTURED_TOOLS / SHELL_TOOLS / CODE_TOOLS dispatch sets)
- Incident write-up: internal Corey session 2026-05-11
