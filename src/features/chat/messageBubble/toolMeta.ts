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
    default:
      return { name: tool, fallbackEmoji: '🛠' };
  }
}
