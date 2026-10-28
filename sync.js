/*
 * Speak Loop · sync.js
 * 可选的跨设备同步：把全部学习数据存成 GitHub 私有仓库里的一个 JSON 文件。
 * 每次同步 = 拉取 → 合并（按 updatedAt）→ 有变化才推送。每次推送都是一次 Git 提交，可以回滚。
 * Token 只保存在本机，不会被同步。
 */
(function (root) {
  'use strict';

  const API = 'https://api.github.com';

  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function isConfigured(cfg) {
    return !!(cfg && cfg.owner && cfg.repo && cfg.token);
  }

  function contentUrl(cfg) {
    const path = String(cfg.path || 'speak-loop-data.json').replace(/^\/+/, '');
    return API + '/repos/' + encodeURIComponent(cfg.owner.trim()) + '/' + encodeURIComponent(cfg.repo.trim()) +
      '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }

  function headers(cfg, raw) {
    return {
      Authorization: 'Bearer ' + cfg.token.trim(),
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  const STATUS_TEXT = {
    401: 'GitHub 不认这个 Token：确认粘贴的是以 github_pat_ 开头的那串长字符；如果已在 GitHub 删除或重新生成过，请换成新的',
    403: '没有权限：检查 Token 是否给了 Contents「读和写」权限，或者稍后再试',
    404: '找不到仓库：检查用户名、仓库名，以及 Token 是否授权了这个仓库',
    409: '云端数据刚被另一台设备更新，请再同步一次',
    422: '云端拒绝了这次写入，请再同步一次'
  };

  async function apiError(res) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.message ? j.message : ''; } catch (e) { /* ignore */ }
    const err = new Error((STATUS_TEXT[res.status] || ('GitHub 返回 ' + res.status)) + (detail ? '（' + detail + '）' : ''));
    err.status = res.status;
    return err;
  }

  async function pull(cfg, fetchImpl) {
    const f = fetchImpl || root.fetch.bind(root);
    const url = contentUrl(cfg) + '?ref=' + encodeURIComponent(cfg.branch || 'main');
    let res;
    try {
      res = await f(url, { headers: headers(cfg), cache: 'no-store' });
    } catch (e) {
      throw new Error('连不上 GitHub，检查网络后再试');
    }
    if (res.status === 404) return { state: null, sha: null };
    if (!res.ok) throw await apiError(res);
    const meta = await res.json();
    let text;
    if (meta.content && meta.encoding === 'base64') {
      text = b64ToUtf8(meta.content);
    } else {
      const raw = await f(url, { headers: headers(cfg, true), cache: 'no-store' });
      if (!raw.ok) throw await apiError(raw);
      text = await raw.text();
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('云端文件不是有效的 JSON，请检查仓库里的数据文件'); }
    return { state: parsed && parsed.state ? parsed.state : parsed, sha: meta.sha };
  }

  async function push(cfg, state, sha, fetchImpl) {
    const f = fetchImpl || root.fetch.bind(root);
    const body = {
      message: 'Speak Loop sync ' + new Date().toISOString(),
      content: utf8ToB64(JSON.stringify({ app: 'speak-loop', savedAt: Date.now(), state })),
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;
    let res;
    try {
      res = await f(contentUrl(cfg), {
        method: 'PUT',
        headers: Object.assign(headers(cfg), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        cache: 'no-store'
      });
    } catch (e) {
      throw new Error('连不上 GitHub，检查网络后再试');
    }
    if (res.status === 409 || (res.status === 422 && sha)) {
      const err = await apiError(res);
      err.conflict = true;
      throw err;
    }
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    return data && data.content ? data.content.sha : null;
  }

  // merge(local, remote) 必须是纯函数；stringify 用来判断是否需要推送
  async function sync(cfg, local, merge, stringify, fetchImpl) {
    if (!isConfigured(cfg)) throw new Error('请先填写 GitHub 用户名、仓库名和 Token');
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await pull(cfg, fetchImpl);
      const merged = merge(local, remote.state);
      if (remote.state && stringify(merged) === stringify(merge(remote.state, null))) {
        return { merged, pushed: false };
      }
      try {
        await push(cfg, merged, remote.sha, fetchImpl);
        return { merged, pushed: true };
      } catch (e) {
        lastErr = e;
        if (!e.conflict) throw e;
      }
    }
    throw lastErr || new Error('同步失败');
  }

  const api = { utf8ToB64, b64ToUtf8, isConfigured, contentUrl, pull, push, sync };
  root.SLSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
