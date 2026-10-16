// Minimal CDP client. Node 22+ ships a global WebSocket, so no dependencies.
'use strict';

// Same port con-chrome.sh launched Chrome on: it honours PUERTO, so must we.
const BASE = 'http://127.0.0.1:' + (process.env.PUERTO || 9222);

async function json(path, method = 'GET') {
  const r = await fetch(BASE + path, { method });
  return r.json();
}

// /json/close and /json/activate answer in plain text ("Target is closing").
async function cmd(path) {
  const r = await fetch(BASE + path);
  return r.text();
}

function open(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}

// One socket, many commands:each command carries an id and resolves on its echo.
// Events (no id) go to whoever asked for them with send.on(method, fn) — the
// public bench listens to Network.requestWillBeSent to prove the page asks the
// network for nothing.
function talk(ws) {
  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method && listeners.has(m.method)) {
      listeners.get(m.method).forEach(fn => fn(m.params));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  send.on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return send;
}

// The first tab connected is the bench's main page. Every later one is a side
// session, and close() must give the main tab its place back: a new tab comes
// to the front, the main one goes to the background, and a background page
// gets its resize events late and no animation frames at all — the viewer
// stops drawing when hidden, on purpose. The 360px overflow check measured a
// canvas still 390px wide for exactly that reason.
let mainTab = null;

// The tab opens blank and only then navigates, so the emulation is in place
// before the page's first line runs. Headless Chrome prefers LIGHT, and since
// 2026-09-14 the viewer opens in the system's scheme; the bench keeps to dark,
// the baseline every measurement was taken in, unless a check asks for light.
async function connect(pageUrl, esquema = 'dark') {
  const tab = await json('/json/new?about:blank', 'PUT');
  const ws = await open(tab.webSocketDebuggerUrl);
  const send = talk(ws);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: esquema}]});
  await send('Page.navigate', {url: pageUrl});
  const isMain = mainTab === null;
  if (isMain) mainTab = tab.id;
  const close = async () => {
    ws.close();
    if (isMain) return;
    await cmd('/json/close/' + tab.id);
    await cmd('/json/activate/' + mainTab);
  };
  return { send, close, targetId: tab.id };
}

// Waits for the document to finish, then hands back an evaluator.
async function evaluate(send, expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

module.exports = { json, connect, evaluate };
