/* Load before app.js. The integration stays dormant until the server returns
 * portalSession after a verified daily login. No browser flag grants access. */
(() => {
  'use strict';
  const ORIGIN = 'https://okegawa-improvement.pages.dev';
  const KEY = 'arena_improvement_session';
  let endpoint = '', cleanup = () => {};
  const bridge = {
    configure(url) { endpoint = url; },
    authenticated(token) {
      sessionStorage.removeItem(KEY);
      if (typeof token === 'string' && token.length === 72) sessionStorage.setItem(KEY, token);
    },
    logout() {
      const token = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY); cleanup();
      if (token && endpoint) void fetch(endpoint, {method:'POST', credentials:'omit', keepalive:true,
        body:new URLSearchParams({action:'improvementLogout',portalSession:token})}).catch(() => {});
    },
    open() {
      const token = sessionStorage.getItem(KEY);
      if (!token || !endpoint) { alert('初回の連携には日報へログインし直してください。連携設定が未完了の場合は管理者へご連絡ください。'); return; }
      cleanup();
      // Open synchronously during the tap, so mobile popup blockers allow it.
      const child = window.open(ORIGIN + '/?entry=portal', '_blank');
      if (!child) { alert('ブラウザのポップアップを許可して、もう一度お試しください。'); return; }
      let sent = false;
      const abort = new AbortController();
      const listener = async (event) => {
        if (sent || event.origin !== ORIGIN || event.source !== child ||
            event.data?.type !== 'improvement-ready' ||
            typeof event.data.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(event.data.nonce)) return;
        sent = true;
        try {
          const response = await fetch(endpoint, {method:'POST', credentials:'omit', cache:'no-store', signal:abort.signal,
            body:new URLSearchParams({action:'improvementTicket',portalSession:token})});
          const result = await response.json();
          if (!response.ok || !result.success || typeof result.payload !== 'string' ||
              typeof result.signature !== 'string') throw Error('handoff failed');
          child.postMessage({type:'improvement-ticket',nonce:event.data.nonce,payload:result.payload,signature:result.signature}, ORIGIN);
          cleanup();
        } catch (_) {
          if (!abort.signal.aborted) { cleanup(); alert('日報との連携ができませんでした。日報にログインし直してからお試しください。'); }
        }
      };
      const timer = setTimeout(() => { cleanup(); }, 45000);
      cleanup = () => { clearTimeout(timer); abort.abort(); window.removeEventListener('message', listener); cleanup = () => {}; };
      window.addEventListener('message', listener);
    },
  };
  window.improvementPortal = bridge;
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-improvement')?.addEventListener('click', () => bridge.open());
  });
})();

