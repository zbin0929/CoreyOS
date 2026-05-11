#!/usr/bin/env node
// 一键下载 UPS 全美 1000 个 ZIP 前缀的分区表 .xls 文件
// 用法：node scripts/ups-zone-downloader.mjs
//
// 原理：连到正在跑的 AI Browser（CDP :9222）→ 注入 JS 触发 1000 个原生 anchor 下载
//   - Chrome 用真实 TLS 指纹，Akamai 不拦
//   - Browser.setDownloadBehavior 已经配好，文件自动落到 ~/.hermes/downloads/
//   - 节流 250ms，避免触发 Akamai 速率限制
//
// 完成后用 ls ~/.hermes/downloads/ups_zone_*.xls | wc -l 验证

import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';

const CDP_HTTP = 'http://localhost:9222';
const DOWNLOAD_DIR = join(homedir(), '.hermes', 'downloads');
const TOTAL = 1000;
const THROTTLE_MS = 250;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  // 1. 拿到 browser-level WS URL
  const verResp = await fetch(`${CDP_HTTP}/json/version`);
  if (!verResp.ok) {
    console.error('AI Browser 不在 9222 上跑。请确认 Corey 已启动且 BROWSER_CDP_URL 已配置。');
    process.exit(1);
  }
  const ver = await verResp.json();
  const browserWs = ver.webSocketDebuggerUrl;
  log(`Connected: ${ver.Browser}`);

  // 2. 拿一个 page target
  const targetsResp = await fetch(`${CDP_HTTP}/json`);
  const targets = await targetsResp.json();
  let target = targets.find((t) => t.type === 'page');
  if (!target) {
    log('No existing page target — creating one');
    const createResp = await fetch(`${CDP_HTTP}/json/new?https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/daily-rates`, {
      method: 'PUT',
    });
    target = await createResp.json();
  }
  const pageWs = target.webSocketDebuggerUrl;
  log(`Page target: ${target.url || target.title}`);

  // 3. 连 page-level WS
  const ws = new WebSocket(pageWs);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  log('Page WS connected');

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  };

  function send(method, params = {}) {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30000);
    });
  }

  // 4. 启用 Page domain，导航到 UPS 触发 Akamai cookie 颁发
  await send('Page.enable');
  log('Navigating to UPS to bootstrap Akamai cookies…');
  await send('Page.navigate', {
    url: 'https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/daily-rates',
  });
  // 等 Akamai 挑战 + cookie 设置完成
  await new Promise((r) => setTimeout(r, 8000));
  log('Akamai bootstrap done');

  // 5. 在 page context 跑一个会自己 loop 的 JS — 比从 Node 单步驱动快得多
  //    每次 anchor.click() 让 Chrome 用原生 download manager 下载，
  //    经过 Browser.setDownloadBehavior 路由到 ~/.hermes/downloads/
  log(`Starting download loop: ${TOTAL} prefixes, ~${(TOTAL * THROTTLE_MS) / 1000 / 60}min`);
  const startCount = countXls();

  const expression = `
    (async () => {
      const total = ${TOTAL};
      const throttle = ${THROTTLE_MS};
      let ok = 0, err = 0;
      window.__upsDownloadProgress = { ok: 0, err: 0, done: false };
      for (let i = 0; i < total; i++) {
        const prefix = String(i).padStart(3, '0');
        try {
          const a = document.createElement('a');
          a.href = '/media/us/currentrates/zone-csv/' + prefix + '.xls';
          a.download = 'ups_zone_' + prefix + '.xls';
          document.body.appendChild(a);
          a.click();
          a.remove();
          ok++;
        } catch (e) { err++; }
        window.__upsDownloadProgress = { ok, err, done: false, current: prefix };
        await new Promise(r => setTimeout(r, throttle));
      }
      window.__upsDownloadProgress = { ok, err, done: true };
      return { ok, err };
    })()
  `;

  // 异步发起，不等返回（loop 4 分钟，CDP timeout 顶不住）
  send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }).catch(() => {});

  // 6. 主线程 poll 进度
  let lastReport = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__upsDownloadProgress || {})',
      returnByValue: true,
    });
    const p = JSON.parse(r.result.value || '{}');
    const onDisk = countXls() - startCount;
    log(`progress: triggered=${p.ok || 0}/${TOTAL}  errors=${p.err || 0}  on_disk=${onDisk}  current=${p.current || '-'}`);
    if (p.done) {
      log('Download loop finished. Waiting 10s for last files to flush…');
      await new Promise((r) => setTimeout(r, 10000));
      const final = countXls() - startCount;
      log(`FINAL: ${final} new .xls files in ${DOWNLOAD_DIR}`);
      ws.close();
      process.exit(0);
    }
    lastReport = p.ok || lastReport;
  }
}

function countXls() {
  try {
    return readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith('ups_zone_') && f.endsWith('.xls')).length;
  } catch {
    return 0;
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
