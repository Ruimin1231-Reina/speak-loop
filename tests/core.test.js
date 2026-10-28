// 运行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const NOW = new Date(2026, 9, 27, 20, 0, 0).getTime(); // 2026-10-27 20:00 本地时间

function samplePackJson() {
  return {
    schema: 'speak-loop/pack@1',
    date: '2026-10-27',
    revision: 1,
    title: 'Explaining my job',
    summary_zh: '能讲清楚工作内容；现在完成时要加强。',
    topics: ['work'],
    minutes: 16,
    scores: { fluency: 72, grammar: 64, vocabulary: 70, naturalness: 66 },
    vocabulary: [
      { term: 'plaintiff', pos: 'n.', meaning_en: 'the person who brings a case to court', meaning_zh: '原告', example: 'My client was the plaintiff.' },
      { term: 'reimburse', pos: 'v.', meaning_en: 'to pay back money someone spent', example: 'The firm will reimburse my travel costs.' }
    ],
    expressions: [
      { term: 'settle out of court', meaning_en: 'agree without a judge deciding', example: 'In the end, both sides settled out of court.' }
    ],
    feedback: [
      { original: 'I am lawyer for two years.', corrected: 'I have been a lawyer for two years.', natural: "I've been practising law for about two years.", why_zh: '现在完成时 + 冠词', type: 'tense', focus: "I've been a ... for ..." }
    ],
    went_well: [{ sentence: 'Let me give you an example.', why_zh: '主动举例' }],
    next_targets: ['settle out of court', "I've been a ... for ..."],
    next_steps_zh: ['先说结论']
  };
}

test('extractJson: 代码块、前后废话、尾逗号都能处理', () => {
  const text = '好的，这是今天的 Pack：\n```json\n{"date":"2026-10-27","vocabulary":[{"term":"a","meaning_en":"b"},],}\n```\n加油！';
  const r = C.extractJson(text);
  assert.ok(r.value, r.error);
  assert.equal(r.value.vocabulary[0].term, 'a');
});

test('extractJson: 没有 JSON 时给出中文错误', () => {
  assert.match(C.extractJson('hello').error, /没找到 JSON/);
  assert.match(C.extractJson('').error, /还没有内容/);
  assert.match(C.extractJson('{"a": }').error, /JSON 格式有误/);
});

test('normalizePack: 标准 Pack 全部识别', () => {
  const r = C.normalizePack(samplePackJson(), { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal(r.pack.date, '2026-10-27');
  assert.equal(r.items.length, 4);
  assert.equal(r.items.filter(i => i.kind === 'vocab').length, 2);
  const fix = r.items.find(i => i.kind === 'fix');
  assert.equal(fix.type, 'tense');
  assert.equal(fix.natural, "I've been practising law for about two years.");
  assert.equal(r.pack.scores.grammar, 64);
  assert.equal(r.pack.went_well[0].sentence, 'Let me give you an example.');
});

test('normalizePack: 字段别名、错误日期、缺字段', () => {
  const r = C.normalizePack({
    date: 'yesterday',
    words: [{ word: 'tedious', definition: 'long and boring' }, { pos: 'n.' }],
    phrases: ['take it one step at a time'],
    corrections: [{ you_said: 'She want it.', correct: 'She wants it.', category: 'Subject-verb agreement' }, { you_said: 'x' }]
  }, { now: NOW });
  assert.equal(r.pack.date, '2026-10-27');
  assert.ok(r.warnings.some(w => w.includes('日期')));
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].meaning_en, 'long and boring');
  assert.equal(r.items[1].term, 'take it one step at a time');
  assert.equal(r.items[2].type, 'agreement');
  assert.equal(r.warnings.filter(w => w.includes('已跳过')).length, 2);
});

test('normalizePack: 空内容报错', () => {
  const r = C.normalizePack({ date: '2026-10-27' }, { now: NOW });
  assert.equal(r.errors.length, 1);
});

test('normalizeType: 中英文类型都能映射', () => {
  assert.equal(C.normalizeType('Word choice'), 'word_choice');
  assert.equal(C.normalizeType('时态'), 'tense');
  assert.equal(C.normalizeType('单复数/主谓一致'), 'agreement');
  assert.equal(C.normalizeType('something weird'), 'other');
});

function importSample(state, decisions) {
  const r = C.normalizePack(samplePackJson(), { now: NOW });
  const dups = C.findDuplicates(state, r.items);
  const draft = {
    pack: r.pack,
    items: r.items.map((it, i) => Object.assign({}, it, { _decision: (decisions && decisions[i]) || (dups[i] ? 'skip' : 'active'), _dup: dups[i] }))
  };
  return C.applyImport(state, draft, { now: NOW, deviceId: 'devA' });
}

test('applyImport: 写入条目和日报，第二次导入同一天变成第 2 版并跳过重复', () => {
  const s = C.emptyState();
  const r1 = importSample(s, ['active', 'saved', 'active', 'skip']);
  assert.equal(r1.active, 2);
  assert.equal(r1.saved, 1);
  assert.equal(r1.skipped, 1);
  assert.equal(Object.keys(s.items).length, 3);
  assert.equal(s.packs[r1.packId].revision, 1);
  assert.equal(C.dayTotals(s, '2026-10-27').i, 1);

  const r2 = importSample(s);
  assert.equal(s.packs[r2.packId].revision, 2);
  assert.equal(r2.active, 1, '只有之前被跳过的纠错是新的');
  assert.equal(C.packsOnDate(s, '2026-10-27').length, 2);
});

test('applyImport: 新条目按类型轮流排列', () => {
  const s = C.emptyState();
  importSample(s);
  const order = Object.values(s.items).sort((a, b) => a.createdAt - b.createdAt).map(i => i.kind);
  assert.deepEqual(order, ['vocab', 'expr', 'fix', 'vocab']);
});

test('schedule: 新卡片四档评分的间隔', () => {
  const srs = C.newSrs();
  assert.equal(C.schedule(srs, 1, NOW).state, 'learning');
  assert.equal(C.schedule(srs, 1, NOW).due, NOW + 10 * C.MINUTE);
  assert.equal(C.schedule(srs, 2, NOW).interval, 1);
  assert.equal(C.schedule(srs, 3, NOW).interval, 2);
  assert.equal(C.schedule(srs, 4, NOW).interval, 4);
  const good = C.schedule(srs, 3, NOW);
  assert.equal(good.due, C.addDaysTs(C.startOfDay(NOW), 2));
  assert.equal(good.first, NOW);
});

test('schedule: 复习卡片按 ease 增长，忘记会记一次 lapse', () => {
  let s = C.schedule(C.newSrs(), 3, NOW); // 2 天
  s = C.schedule(s, 3, NOW + 2 * C.DAY); // 2 * 2.5 = 5
  assert.equal(s.interval, 5);
  const easy = C.schedule(s, 4, NOW + 7 * C.DAY);
  assert.ok(easy.interval > 5 * 2.5);
  const lapse = C.schedule(s, 1, NOW + 7 * C.DAY);
  assert.equal(lapse.lapses, 1);
  assert.equal(lapse.state, 'learning');
  const relearn = C.schedule(lapse, 3, NOW + 7 * C.DAY);
  assert.equal(relearn.interval, 1);
});

test('previewIntervals: 正常模式和加练模式', () => {
  const p = C.previewIntervals(C.newSrs(), NOW);
  assert.deepEqual(p, { 1: '10分钟', 2: '1天', 3: '2天', 4: '4天' });
  const reviewSrs = C.schedule(C.newSrs(), 3, NOW);
  assert.equal(C.previewIntervals(reviewSrs, NOW, true)[3], '不变');
});

test('buildQueue: 到期的先来，新条目受每日上限限制', () => {
  const s = C.emptyState();
  s.settings.newPerDay = 2;
  importSample(s);
  let q = C.buildQueue(s, { now: NOW });
  assert.equal(q.length, 2);
  C.applyRating(s, q[0], 3, { now: NOW, deviceId: 'devA' });
  q = C.buildQueue(s, { now: NOW });
  assert.equal(q.length, 1, '今天已经学了 1 条新的，只剩 1 个名额');
  const later = NOW + 3 * C.DAY;
  const q2 = C.buildQueue(s, { now: later });
  assert.ok(q2.length >= 1);
  assert.notEqual(s.items[q2[0]].srs.state, 'new', '到期复习排在新条目前面');
  const counts = C.countByTrack(s, NOW);
  assert.equal(counts.all.total, 1);
});

test('applyRating: 加练模式下只有「忘了」会改计划', () => {
  const s = C.emptyState();
  importSample(s);
  const id = C.buildQueue(s, { now: NOW })[0];
  C.applyRating(s, id, 3, { now: NOW });
  const before = JSON.stringify(s.items[id].srs);
  C.applyRating(s, id, 4, { now: NOW, extra: true });
  assert.equal(JSON.stringify(s.items[id].srs), before);
  C.applyRating(s, id, 1, { now: NOW, extra: true });
  assert.equal(s.items[id].srs.state, 'learning');
});

test('streak 和热力图', () => {
  const s = C.emptyState();
  C.recordActivity(s, 'a', '2026-10-25', 'r', 3);
  C.recordActivity(s, 'b', '2026-10-26', 'r', 1);
  assert.deepEqual(C.streak(s, NOW), { days: 2, today: false });
  C.recordActivity(s, 'a', '2026-10-27', 'i', 1);
  assert.deepEqual(C.streak(s, NOW), { days: 3, today: true });
  const hm = C.heatmapData(s, NOW, 4);
  assert.equal(hm.cells.length, 28);
  assert.equal(hm.activeDays, 3);
  const todayCell = hm.cells.find(c => c && c.day === '2026-10-27');
  assert.equal(todayCell.imports, 1);
  assert.equal(C.reviewsInLastDays(s, NOW, 7), 4);
});

test('pickTargets 和 buildOpener', () => {
  const s = C.emptyState();
  importSample(s);
  const t = C.pickTargets(s);
  assert.equal(t[0].text, 'settle out of court');
  assert.equal(t[1].text, "I've been a ... for ...");
  const opener = C.buildOpener(t);
  assert.match(opener, /1\. settle out of court/);
  assert.match(opener, /Start by asking me/);
});

test('hintPattern 和 blankExample', () => {
  assert.equal(C.hintPattern('go with the flow'), 'g_ w___ t__ f___');
  assert.equal(C.hintPattern("I've been a ... for ..."), "I'__ b___ a ... f__ ...");
  assert.equal(C.blankExample('The firm will reimburse my travel costs.', 'reimburse'), 'The firm will _____ my travel costs.');
  assert.equal(C.blankExample('They reimbursed me.', 'reimburse'), 'They _____ me.');
  assert.equal(C.blankExample('In the end, both sides settled out of court.', 'settle out of court'), '');
  assert.equal(C.blankExample('I ended up working as a lawyer.', 'I ended up ...'), '_____ working as a lawyer.');
  assert.equal(C.blankExample('Nothing here.', 'plaintiff'), '');
});

test('matchSpoken: 单词、表达、句子', () => {
  assert.equal(C.matchSpoken(['nuance'], ['nuanced']).level, 'exact');
  assert.equal(C.matchSpoken(['I just go with the flow'], ['go with the flow']).level, 'exact');
  assert.equal(C.matchSpoken(['go with a flow'], ['go with the flow']).level, 'close');
  assert.equal(C.matchSpoken(['banana'], ['plaintiff']).level, 'miss');
  const fix = C.matchSpoken(["I've been a lawyer for two years"], ['I have been a lawyer for two years.']);
  assert.equal(fix.level, 'exact');
  assert.equal(C.matchSpoken(['xyz', 'plaintiff'], ['plaintiff']).transcript, 'plaintiff');
});

test('mergeStates: 条目按 updatedAt 取新，活动计数按设备取最大值', () => {
  const a = C.emptyState();
  const b = C.emptyState();
  a.items.x = { id: 'x', kind: 'vocab', term: 'old', status: 'active', updatedAt: 1, srs: C.newSrs() };
  b.items.x = { id: 'x', kind: 'vocab', term: 'new', status: 'active', updatedAt: 2, srs: C.newSrs() };
  b.items.y = { id: 'y', kind: 'expr', term: 'only remote', status: 'removed', updatedAt: 5, srs: C.newSrs() };
  a.activity['2026-10-27'] = { devA: { r: 5, i: 1 } };
  b.activity['2026-10-27'] = { devA: { r: 3, i: 1 }, devB: { r: 7, i: 0 } };
  a.settings.updatedAt = 10;
  a.settings.newPerDay = 20;
  b.settings.updatedAt = 5;
  const m = C.mergeStates(a, b);
  assert.equal(m.items.x.term, 'new');
  assert.equal(m.items.y.status, 'removed');
  assert.deepEqual(m.activity['2026-10-27'], { devA: { i: 1, r: 5 }, devB: { i: 0, r: 7 } });
  assert.equal(C.dayTotals(m, '2026-10-27').r, 12);
  assert.equal(m.settings.newPerDay, 20);
  // 交换顺序结果一致（两台设备会收敛）
  assert.equal(C.stableStringify(C.mergeStates(b, a)), C.stableStringify(m));
  // 输入不被修改
  assert.equal(a.items.x.term, 'old');
});

test('migrateState: 清理坏数据并补默认值', () => {
  const m = C.migrateState({ items: { bad: null, k: { kind: 'nope' }, ok: { kind: 'fix', original: 'a', corrected: 'b' } }, settings: { newPerDay: 5 } });
  assert.deepEqual(Object.keys(m.items), ['ok']);
  assert.equal(m.items.ok.status, 'active');
  assert.equal(m.items.ok.srs.state, 'new');
  assert.equal(m.settings.newPerDay, 5);
  assert.equal(m.settings.reviewsPerDay, 100);
});


test('extractJson: 只移除结构性尾逗号，不改动引号内的逗号或括号', () => {
  const text = '{"summary_zh":"保留这个逗号, } 以及这个, ]","vocabulary":[{"term":"a","meaning_en":"has a comma, inside",},],}';
  const r = C.extractJson(text);
  assert.ok(r.value, r.error);
  assert.equal(r.value.summary_zh, '保留这个逗号, } 以及这个, ]');
  assert.equal(r.value.vocabulary[0].meaning_en, 'has a comma, inside');
});

test('normalizePack: null 时长和分数保持为空，不会变成零', () => {
  const r = C.normalizePack({
    schema: 'speak-loop/pack@1', date: '2026-10-27', minutes: null,
    scores: { overall: null, fluency: null, grammar: null, vocabulary: null, naturalness: null },
    vocabulary: [{ term: 'unwind', meaning_en: 'relax after being busy' }]
  }, { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal(r.pack.minutes, null);
  assert.equal(r.pack.scores, null);
});

test('normalizePack: 稀疏的真实 Pack 可以导入，没有复习素材则明确拒绝', () => {
  const sparse = C.normalizePack({
    date: '2026-10-27', title: 'short chat', summary_zh: '只留下一个有用表达。',
    expressions: [{ term: 'nothing fancy', meaning_en: 'simple and not special' }]
  }, { now: NOW });
  assert.deepEqual(sparse.errors, []);
  assert.equal(sparse.items.length, 1);

  const noItems = C.normalizePack({ date: '2026-10-27', summary_zh: '今天没有可靠的复习素材。', went_well: [{ sentence: 'Hello.' }] }, { now: NOW });
  assert.equal(noItems.items.length, 0);
  assert.match(noItems.errors[0], /没有可导入/);
});

test('extractJson: 只取第一个完整对象，后面的说明文字里有花括号也不影响', () => {
  const text = '{"date":"2026-10-28","title":"a } b","vocabulary":[{"term":"x"}]}\n\nRules:\n- shaped as {"term":""}';
  const r = C.extractJson(text);
  assert.ok(r.value, r.error);
  assert.equal(r.value.title, 'a } b');
  assert.equal(r.value.vocabulary[0].term, 'x');
});
