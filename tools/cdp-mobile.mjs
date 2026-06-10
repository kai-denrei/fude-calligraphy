// cdp-mobile.mjs <url> <selector> <out> — load at phone size, click selector, screenshot.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [url, sel, out] = process.argv.slice(2);
const PORT = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--hide-scrollbars', '--no-first-run', `--user-data-dir=/tmp/cdm-${PORT}`,
   '--enable-unsafe-swiftshader', '--force-prefers-reduced-motion', '--window-size=390,844',
   `--remote-debugging-port=${PORT}`, url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(250); } }
  const page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d.result); p.delete(d.id); } };
  await send('Runtime.enable'); await sleep(3500);
  if (sel) { await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})?.click()` }); await sleep(600); }
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('captured', out);
  ws.close();
} catch (e) { console.error('CDP error:', e.message); } finally { chrome.kill('SIGKILL'); }
