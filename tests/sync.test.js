// 用一个假的 GitHub Contents API 测试同步流程（不会真的联网）
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const S = require('../sync.js');

function fakeGitHub() {
  const files = new Map(); // path -> { sha, content(base64) }
  let n = 0;
  const calls = [];
  let forceConflictOnce = false;
  async function fetchImpl(url, init) {
    const method = (init && init.method) || 'GET';
    calls.push(method);
    const auth = init.headers.Authorization;
    if (auth !== 'Bearer good-token') return resp(401, { message: 'Bad credentials' });
    const path = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
    if (method === 'GET') {
      const f = files.get(path);
      if (!f) return resp(404, { message: 'Not Found' });
      return resp(200, { sha: f.sha, encoding: 'base64', content: f.content.replace(/(.{60})/g, '$1\n') });
    }
    const body = JSON.parse(init.body);
    const cur = files.get(path);
    if (forceConflictOnce) { forceConflictOnce = false; return resp(409, { message: 'conflict' }); }
    if (cur && body.sha !== cur.sha) return resp(409, { message: 'sha mismatch' });
    if (!cur && body.sha) return resp(422, { message: 'sha given for new file' });
    const sha = 'sha' + (++n);
    files.set(path, { sha, content: body.content });
    return resp(cur ? 200 : 201, { content: { sha } });
  }
  return { files, calls, fetchImpl, conflictNext() { forceConflictOnce = true; } };
}
function resp(status, json) {
  return { status, ok: status >= 200 && status < 300, json: async () => json, text: async () => JSON.stringify(json) };
}

const cfg = { owner: 'me', repo: 'speak-loop-data', branch: 'main', path: 'speak-loop-data.json', token: 'good-token' };
const merge = C.mergeStates;
const str = C.stableStringify;

function stateWith(id, term, updatedAt) {
  const s = C.emptyState();
  s.items[id] = { id, kind: 'vocab', term, status: 'active', updatedAt, createdAt: updatedAt, srs: C.newSrs() };
  return s;
}

test('base64 往返保留中文和 emoji', () => {
  const text = '复盘：先说结论 ✅ "quotes" ’';
  assert.equal(S.b64ToUtf8(S.utf8ToB64(text)), text);
});

test('第一次同步创建文件，第二台设备合并后再推送', async () => {
  const gh = fakeGitHub();
  const a = stateWith('x', '原告 plaintiff', 1);
  const r1 = await S.sync(cfg, a, merge, str, gh.fetchImpl);
  assert.equal(r1.pushed, true);
  assert.equal(gh.files.size, 1);

  const b = stateWith('y', 'reimburse', 2);
  const r2 = await S.sync(cfg, b, merge, str, gh.fetchImpl);
  assert.equal(r2.pushed, true);
  assert.deepEqual(Object.keys(r2.merged.items).sort(), ['x', 'y']);
  assert.equal(r2.merged.items.x.term, '原告 plaintiff');

  // 设备 A 再同步：拿到 y；云端已经包含 A 的全部内容，所以不用推送
  const r3 = await S.sync(cfg, a, merge, str, gh.fetchImpl);
  assert.equal(r3.pushed, false);
  assert.ok(r3.merged.items.y);
});

test('遇到冲突会重新拉取再试', async () => {
  const gh = fakeGitHub();
  await S.sync(cfg, stateWith('x', 'a', 1), merge, str, gh.fetchImpl);
  gh.conflictNext();
  const r = await S.sync(cfg, stateWith('z', 'b', 3), merge, str, gh.fetchImpl);
  assert.equal(r.pushed, true);
  const saved = JSON.parse(S.b64ToUtf8(gh.files.get('speak-loop-data.json').content));
  assert.deepEqual(Object.keys(saved.state.items).sort(), ['x', 'z']);
});

test('Token 错误时给出中文提示', async () => {
  const gh = fakeGitHub();
  await assert.rejects(
    S.sync(Object.assign({}, cfg, { token: 'bad' }), C.emptyState(), merge, str, gh.fetchImpl),
    /GitHub 不认这个 Token/
  );
});

test('没填配置时直接报错', async () => {
  await assert.rejects(S.sync({ owner: '', repo: '', token: '' }, C.emptyState(), merge, str), /请先填写/);
});
