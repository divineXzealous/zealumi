// fetch wrapper with timeout. Errors carry .status ('timeout' for timeouts).
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, as = 'json' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = res.headers.get('retry-after');
      // Keep the provider's own explanation (e.g. "model not found") for the logs.
      try { err.body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300); } catch (_) { /* ignore */ }
      throw err;
    }
    if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
    return as === 'text' ? res.text() : res.json();
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('timeout'); t.status = 'timeout'; throw t; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { request };
