/**
 * Friendly display metadata for Hermes tool slugs.
 *
 * Hermes' SSE event names tools with their internal Python identifier
 * (`delegate_task`, `browser_navigate`, etc.). Showing those raw to the
 * user looks like a debugging panel — `prettifyTool` maps them to short
 * Chinese labels and a fallback emoji. Hermes USUALLY ships its own
 * emoji on the SSE event; the fallback only kicks in for unknown or
 * future tool slugs.
 *
 * Adding a new tool: just add a `case` here. Anything not listed falls
 * through to the slug + 🛠 fallback, which is ugly but never wrong.
 */
export interface ToolMeta {
  name: string;
  fallbackEmoji: string;
}

export function prettifyTool(tool: string): ToolMeta {
  switch (tool) {
    case 'delegate_task':
      return { name: '任务委派', fallbackEmoji: '🔀' };
    case 'browser_navigate':
      return { name: '浏览网页', fallbackEmoji: '🌐' };
    case 'web_search':
      return { name: '网页搜索', fallbackEmoji: '🔍' };
    case 'web_fetch':
      return { name: '抓取网页', fallbackEmoji: '🌐' };
    case 'terminal':
    case 'shell':
      return { name: '执行命令', fallbackEmoji: '💻' };
    case 'file_read':
      return { name: '读取文件', fallbackEmoji: '📄' };
    case 'file_write':
      return { name: '写入文件', fallbackEmoji: '✏️' };
    case 'file_search':
      return { name: '搜索文件', fallbackEmoji: '🔎' };
    case 'code_execution':
      return { name: '执行代码', fallbackEmoji: '⚡' };
    case 'image_gen':
      return { name: '生成图像', fallbackEmoji: '🎨' };
    case 'tts':
      return { name: '语音合成', fallbackEmoji: '🔊' };
    case 'cronjob':
    case 'cronjob_create':
      return { name: '定时任务', fallbackEmoji: '⏰' };
    case 'memory':
    case 'memory_write':
      return { name: '记录记忆', fallbackEmoji: '💾' };
    case 'todo':
    case 'todo_write':
      return { name: '任务规划', fallbackEmoji: '📋' };
    case 'send_message':
      return { name: '发送消息', fallbackEmoji: '📨' };
    // ── corey-native MCP tools (exposed via the Tauri-side MCP bridge,
    // see `src-tauri/src/mcp_server/`). Hermes wraps remote MCP tools
    // with `mcp_<server>_<tool>`, so what arrives here is the namespaced
    // form (e.g. `mcp_corey_native_notify`). We special-case each so
    // the timeline reads naturally instead of dumping the raw slug.
    case 'mcp_corey_native_notify':
      return { name: '桌面通知', fallbackEmoji: '🔔' };
    case 'mcp_corey_native_pick_file':
      return { name: '选择文件', fallbackEmoji: '📂' };
    case 'mcp_corey_native_pick_folder':
      return { name: '选择文件夹', fallbackEmoji: '📁' };
    case 'mcp_corey_native_open_settings':
      return { name: '跳转设置', fallbackEmoji: '⚙️' };
    default:
      // Generic MCP tools we haven't pretty-named yet still get a
      // sensible label by stripping the `mcp_<server>_` prefix.
      if (isMcpTool(tool)) {
        return { name: humanizeMcpTool(tool), fallbackEmoji: '🔌' };
      }
      return { name: tool, fallbackEmoji: '🛠' };
  }
}

/** True when the slug starts with `mcp_<something>_`. */
function isMcpTool(tool: string): boolean {
  return /^mcp_[^_]+_/.test(tool);
}

/** Strip the `mcp_<server>_` prefix and replace underscores with spaces
 * so an unknown MCP tool reads as `notify` rather than
 * `mcp_corey_native_notify`. Cheap; the regex is anchored. */
function humanizeMcpTool(tool: string): string {
  return tool.replace(/^mcp_[^_]+_/, '').replace(/_/g, ' ');
}
