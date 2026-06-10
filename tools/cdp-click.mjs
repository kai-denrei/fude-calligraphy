// cdp-click.mjs <url> <outfile> — load, click the canvas centre, verify the terminal
// popover appears, click its 右払い button, screenshot. Validates click-to-select UX.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [url, out] = process.argv.slice(2);
const PORT = 9550 + Math.floor(Math.random() * 200);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=/tmp/cdpc-${PORT}`, '--enable-unsafe-swiftshader',
  '--window-size=1500,950', `--remote-debugging-port=${PORT}`, url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(250); } }
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const m = ++id; pending.set(m, res); ws.send(JSON.stringify({ id: m, method, params })); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };

  await send('Page.enable'); await send('Runtime.enable');
  await sleep(4000);                                  // let it draw

  // canvas centre in CSS px
  const rect = (await send('Runtime.evaluate', { expression: `(()=>{const r=document.getElementById('gl').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`, returnByValue: true })).result.value;
  const { x, y } = JSON.parse(rect);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(400);
  const pop = (await send('Runtime.evaluate', { expression: `(()=>{const p=document.querySelector('.term-popover');return p?p.querySelector('.tp-head').textContent+' | btns:'+p.querySelectorAll('.tp-btn').length:'NO POPOVER'})()`, returnByValue: true })).result.value;
  console.log('popover:', pop);
  // click the 右払い (index 3) button, then screenshot the result
  await send('Runtime.evaluate', { expression: `document.querySelectorAll('.term-popover .tp-btn')[3]?.click()` });
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('captured', out);
  ws.close();
} catch (e) { console.error('CDP error:', e.message); } finally { chrome.kill('SIGKILL'); }
