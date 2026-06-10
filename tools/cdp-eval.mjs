// cdp-eval.mjs <url> <expr> [waitMs] — load a page, run a JS expression, print the result.
import { spawn } from 'node:child_process';
const [url, expr, waitMs = '4000'] = process.argv.slice(2);
const PORT = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--no-first-run', `--user-data-dir=/tmp/cde-${PORT}`, '--enable-unsafe-swiftshader',
    '--window-size=1500,950', `--remote-debugging-port=${PORT}`, url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(250); } }
  const page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  const send = (m, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params })); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d.result); p.delete(d.id); } };
  await send('Runtime.enable'); await sleep(parseInt(waitMs, 10));
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails?.text ?? r.result));
  ws.close();
} catch (e) { console.error('CDP error:', e.message); } finally { chrome.kill('SIGKILL'); }
