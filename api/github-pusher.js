/* GitHub Contents API pusher — runs entirely in the browser (iPhone Safari friendly). */
(function (root) {
  'use strict';

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function gh(token, method, path, body) {
    const res = await fetch('https://api.github.com' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, json };
  }

  /** files: [{path, content: ArrayBuffer}] */
  async function pushFiles(opts, files, log) {
    const { user, repo, branch, token } = opts;
    if (!user || !repo || !token) throw new Error('Username, repository and token are required.');
    log = log || function () {};
    const repoInfo = await gh(token, 'GET', `/repos/${user}/${repo}`);
    if (!repoInfo.ok) throw new Error(`Cannot open ${user}/${repo} (HTTP ${repoInfo.status}). Create the repository first and check the token scope.`);
    let done = 0, failed = 0;
    for (const f of files) {
      const path = '/repos/' + user + '/' + repo + '/contents/' + f.path.split('/').map(encodeURIComponent).join('/');
      const existing = await gh(token, 'GET', path + '?ref=' + encodeURIComponent(branch));
      const body = { message: 'Add ' + f.path, content: toBase64(f.content), branch };
      if (existing.ok && existing.json && existing.json.sha) body.sha = existing.json.sha;
      const r = await gh(token, 'PUT', path, body);
      if (r.ok) { done++; log(`✓ ${f.path} (${done}/${files.length})`); }
      else { failed++; log(`✗ ${f.path} — HTTP ${r.status} ${(r.json && r.json.message) || ''}`); }
    }
    log(`Finished: ${done} uploaded, ${failed} failed.`);
    if (!failed) log(`Next: repo Settings → Pages → Branch ${branch} / root → Save.\nSite: https://${user}.github.io/${repo}/`);
    return { done, failed };
  }

  /** Reads the project's own files from the site it is served from, using the manifest list in APP_CONFIG. */
  async function pushSiteFiles(opts, log) {
    const list = (root.APP_CONFIG && root.APP_CONFIG.projectFiles) || [];
    const files = [];
    for (const p of list) {
      try {
        const r = await fetch(p, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        files.push({ path: p, content: await r.arrayBuffer() });
      } catch (e) { (log || function () {})('skip ' + p + ' (not reachable: ' + e.message + ')'); }
    }
    return pushFiles(opts, files, log);
  }

  root.GitHubPusher = { pushFiles, pushSiteFiles, toBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GitHubPusher;
})(typeof self !== 'undefined' ? self : this);
