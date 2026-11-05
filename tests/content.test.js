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
  assert.equal(r.items.filter(i => i.kind === 'expr' && i.form !== 'sentence').length, 3);
  assert.equal(r.items.filter(i => i.kind === 'fix' && i.form !== 'upgrade').length, 3);
  assert.equal(r.items.filter(i => i.form === 'sentence').length, 2);
  assert.equal(r.items.filter(i => i.form === 'upgrade').length, 1);
  assert.equal(r.story.full.length, 4);
  // 关键句必须是正文里的原句，复述时才能对上
  const fullText = r.story.full.join(' ');
  for (const s of r.items.filter(i => i.form === 'sentence')) assert.ok(fullText.includes(s.term), s.term);
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

test('模板包含故事和说法升级；转换请求和复述任务可用；指令长度在项目指令限制内', () => {
  const tpl = P.packTemplate('2026-10-28');
  assert.ok(Object.hasOwn(tpl, 'upgrades'));
  assert.deepEqual(Object.keys(tpl.story).sort(), ['full', 'key_sentences', 'kind', 'outline', 'short', 'title', 'topics']);
  const instructions = P.projectInstructions('');
  assert.match(instructions, /story: a polished first-person retelling/);
  assert.match(instructions, /never add new details/);
  assert.ok(instructions.length < 8000, '项目指令长度 ' + instructions.length);

  const now = new Date(2026, 9, 28, 9, 0, 0);
  const conv = P.convertRecapRequest(now);
  const extracted = C.extractJson(conv);
  assert.ok(extracted.value, extracted.error);
  assert.equal(extracted.value.date, '2026-10-28');
  assert.match(conv, /up to 15 for this conversion/);
  // ChatGPT 按模板填好的样子能被导入器读出故事
  const filled = Object.assign({}, extracted.value, {
    story: Object.assign({}, extracted.value.story, { title: 'A walk', full: ['I went for a walk.'] })
  });
  assert.equal(C.normalizePack(filled, { now: now.getTime() }).story.title, 'A walk');

  const task = P.retellTask({ title: 'A walk', outline: ['left home', 'saw a friend'] }, ['bump into', 'catch up'], 1);
  assert.match(task, /"A walk"/);
  assert.match(task, /left home \/ saw a friend/);
  assert.match(task, /bump into; catch up/);
  assert.match(task, /colleague/);
});
