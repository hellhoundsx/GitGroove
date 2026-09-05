// Minimal Chrome DevTools Protocol client for GitKraken recon.
// usage:
//   node cdp.mjs targets
//   node cdp.mjs <idx|titleSubstr> eval <file.js>   -> prints result (string or JSON)
//   node cdp.mjs <idx|titleSubstr> shot <out.png>
//   node cdp.mjs <idx|titleSubstr> css               -> dumps all stylesheet text via CSS domain
import { readFileSync, writeFileSync } from 'node:fs';

const [, , targetSel, cmd, arg] = process.argv;
const targets = await (await fetch(`http://localhost:${process.env.CDP_PORT || 9222}/json`)).json();
if (targetSel === 'targets') {
  console.log(JSON.stringify(targets.map((x, i) => ({ i, type: x.type, title: x.title, url: x.url })), null, 1));
  process.exit(0);
}
const t = /^\d+$/.test(targetSel)
  ? targets[+targetSel]
  : targets.find((x) => (x.title + ' ' + x.url).toLowerCase().includes(targetSel.toLowerCase()));
if (!t) { console.error('no target matching', targetSel); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method) events.push(m);
});
await new Promise((r) => ws.addEventListener('open', r));

try {
  if (cmd === 'eval') {
    const expression = readFileSync(arg, 'utf8');
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) { console.error(JSON.stringify(r.exceptionDetails, null, 1)); process.exit(2); }
    const v = r.result.value;
    process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  } else if (cmd === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('wrote', arg);
  } else if (cmd === 'css') {
    await send('DOM.enable'); await send('CSS.enable');
    await new Promise((r) => setTimeout(r, 1500));
    const sheets = events.filter((e) => e.method === 'CSS.styleSheetAdded').map((e) => e.params.header);
    let out = '';
    for (const h of sheets) {
      const { text } = await send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId });
      out += `\n/* ===== sheet ${h.styleSheetId} origin=${h.origin} url=${h.sourceURL || '(inline)'} len=${text.length} ===== */\n${text}\n`;
    }
    process.stdout.write(out);
  } else if (cmd === 'win') {
    const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId: t.id });
    console.log('before', JSON.stringify(bounds));
    const [w, h] = (arg || '1920x1080').split('x').map(Number);
    await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: w, height: h } });
    await new Promise(r => setTimeout(r, 800));
    console.log('after', JSON.stringify((await send('Browser.getWindowForTarget', { targetId: t.id })).bounds));
  } else if (cmd === 'click') {
    const [x, y] = arg.split(',').map(Number);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    console.log('clicked', x, y);
  } else if (cmd === 'type') {
    await send('Input.insertText', { text: arg });
    console.log('typed', JSON.stringify(arg));
  } else if (cmd === 'key') {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: arg, code: arg, windowsVirtualKeyCode: arg === 'Escape' ? 27 : arg === 'Enter' ? 13 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: arg, code: arg });
    console.log('key', arg);
  } else if (cmd === "clicksel" || cmd === "hoversel") {
    const [sel, button = "left", idx = "0"] = arg.split("||");
    const r = await send("Runtime.evaluate", { expression: `(() => { const els = document.querySelectorAll(${JSON.stringify(sel)}); const el = els[${idx}]; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, n: els.length }; })()`, returnByValue: true });
    const p = r.result.value; if (!p) { console.error("no element for", sel); process.exit(3); }
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    if (cmd === "clicksel") {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, clickCount: 1 });
    }
    await new Promise(r => setTimeout(r, 700));
    console.log(cmd, sel, "at", Math.round(p.x), Math.round(p.y), "matches", p.n);
  } else if (cmd === "unknown-placeholder") {
  } else {
    console.error('unknown cmd'); process.exit(1);
  }
} finally { ws.close(); }
