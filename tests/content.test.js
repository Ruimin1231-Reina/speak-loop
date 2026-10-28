// Check that the example Pack and every reusable prompt template stay import-compatible.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const P = require('../prompts.js');
const SAMPLE = require('../sample-pack.js');

test('示例 Pack 没有警告，稀疏内容和 null 指标可被导入', () => {
  const r = C.normalizePack(Object.assign({}, SAMPLE, { date: '2026-10-27' }), { now: Date.now() });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.items.filter(i => i.kind === 'vocab').length, 3);
  assert.equal(r.items.filter(i => i.kind === 'expr').length, 3);
  assert.equal(r.items.filter(i => i.kind === 'fix').length, 3);
  assert.equal(r.pack.minutes, null);
  assert.equal(r.pack.scores, null);
  assert.equal(r.pack.next_targets.length, 3);
  const s = C.emptyState();
  C.applyImport(s, { pack: r.pack, items: r.items.map(i => Object.assign({ _decision: 'active' }, i)) }, { now: Date.now() });
  const t = C.pickTargets(s);
  assert.equal(t.length, 3);
  assert.ok(t.every(x => x.itemId), JSON.stringify(t));
});

test('项目指令里的 JSON 模板本身是合法 JSON，字段名和导入器一致', () => {
  const text = P.projectInstructions('');
  const r = C.extractJson(text);
  assert.ok(r.value, r.error);
  for (const k of ['schema', 'date', 'revision', 'title', 'summary_zh', 'minutes', 'scores', 'vocabulary', 'expressions', 'feedback', 'went_well', 'next_targets']) {
    assert.ok(Object.hasOwn(r.value, k), '缺少 ' + k);
  }
  assert.equal(r.value.schema, 'speak-loop/pack@1');
  assert.equal(r.value.minutes, null);
  assert.deepEqual(r.value.scores, { overall: null, fluency: null, grammar: null, vocabulary: null, naturalness: null });
  assert.match(text, /# About me \(optional, unverified context\)\nI am a Chinese learner/);
  assert.match(P.projectInstructions('I am a learner.'), /# About me \(optional, unverified context\)\nI am a learner\./);
  assert.ok(text.length < 8000, '项目指令长度 ' + text.length);
});

test('独立 Pack 请求使用当天本地日期、完整模板且可被导入器读取', () => {
  const now = new Date(2026, 9, 28, 9, 30, 0);
  const text = P.standalonePackRequest(now);
  const extracted = C.extractJson(text);
  assert.ok(extracted.value, extracted.error);
  assert.equal(extracted.value.date, '2026-10-28');
  assert.equal(extracted.value.schema, P.SCHEMA);
  const r = C.normalizePack(Object.assign({}, extracted.value, {
    expressions: [{ term: 'go with the flow', meaning_en: 'be relaxed about plans' }]
  }), { now: now.getTime() });
  assert.deepEqual(r.errors, []);
  assert.equal(P.configuredPackCommand(), P.PACK_COMMAND);
  assert.match(P.repairPackRequest(now), /real conversation/);
});
