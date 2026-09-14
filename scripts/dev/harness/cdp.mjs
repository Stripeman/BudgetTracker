// A small Chrome DevTools Protocol client over Node 22's built-in WebSocket (no dependencies).
// Every command has a timeout, so a browser that stops answering fails a check instead of hanging.
export function connect(url, { timeoutMs = 15000 } = {}) {
  const ws = new WebSocket(url);
  let id = 0;
  let closed = false;
  const pending = new Map();
  const listeners = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`CDP connection to ${url} failed`)), { once: true });
  });
  ready.catch(() => { /* reported to whoever sends */ });
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString("utf8"));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of listeners.get(msg.method) || []) fn(msg.params || {});
  });
  ws.addEventListener("close", () => {
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`${p.method}: the browser connection closed`)); }
    pending.clear();
  });
  return {
    ready,
    get closed() { return closed; },
    async send(method, params = {}, { timeout = timeoutMs } = {}) {
      await ready;
      if (closed) throw new Error(`${method}: the browser connection is closed`);
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(msgId); reject(new Error(`${method}: no answer within ${timeout} ms`)); }, timeout);
        pending.set(msgId, { resolve, reject, timer, method });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
      return () => listeners.set(method, (listeners.get(method) || []).filter((f) => f !== fn));
    },
    once(method, { timeout = timeoutMs } = {}) {
      return new Promise((resolve, reject) => {
        let off = null;
        const timer = setTimeout(() => { if (off) off(); reject(new Error(`${method}: not received within ${timeout} ms`)); }, timeout);
        off = this.on(method, (params) => { clearTimeout(timer); off(); resolve(params); });
      });
    },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
}
