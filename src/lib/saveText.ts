/** Save text to disk. Inside Tauri the WebView's `<a download>` shortcut
 *  silently no-ops, so we open the native save sheet and stream the
 *  bytes through the `save_text_file` IPC. Outside Tauri (Storybook,
 *  Playwright, plain browser) we fall back to the blob trick.
 *
 *  Returns `true` if the file was written, `false` if the user
 *  cancelled the save dialog. */
export async function saveText(
  data: string,
  filename: string,
  mime: string,
): Promise<boolean> {
  const isTauri =
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
  if (isTauri) {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ]);
    const ext = filename.split('.').pop() ?? '';
    const picked = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (typeof picked !== 'string' || !picked) return false;
    await invoke('save_text_file', { path: picked, contents: data });
    return true;
  }
  const blob = new Blob([data], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
