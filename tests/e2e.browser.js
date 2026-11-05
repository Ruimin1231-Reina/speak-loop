// 端到端测试：用本机 Chrome 打开口语工作台，走一遍「导入示例 → 筛选 → 复习 → 素材库 → 设置 → 刷新」，截图并检查报错。
// 不在 node --test 里自动运行。用法（puppeteer-core 装在临时目录，别装进 iCloud 文件夹）：
//   mkdir -p /tmp/sl-e2e && (cd /tmp/sl-e2e && npm init -y && npm i puppeteer-core@25.16.0)
//   python3 -m http.server 8765 --bind 127.0.0.1        # 在 speak-loop 目录另开一个终端
//   NODE_PATH=/tmp/sl-e2e/node_modules node tests/e2e.browser.js
// 可选环境变量：BASE（网址）、OUT（截图目录，默认 /tmp/speak-loop-shots）、CHROME（Chrome 路径）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || '/tmp/speak-loop-shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--lang=zh-CN', '--no-first-run']
  });
  const page = await browser.newPage();
  // 无头 Chrome 没有真正的英文声音：换成一个假的朗读引擎，每句 40ms 读完，并记下读过的句子
  await page.evaluateOnNewDocument(() => {
    const pending = new Set();
    window.__spoken = [];
    const fake = {
      speaking: false,
      getVoices: () => [],
      addEventListener: () => {},
      speak(u) {
        const t1 = setTimeout(() => {
          pending.delete(t1);
          window.__spoken.push(u.text);
          if (u.onstart) u.onstart();
          const t2 = setTimeout(() => { pending.delete(t2); if (u.onend) u.onend(); }, 40);
          pending.add(t2);
        }, 10);
        pending.add(t1);
      },
      cancel() { pending.forEach(clearTimeout); pending.clear(); }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const shot = async name => { await sleep(250); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  const clickText = async (selector, text) => {
    const ok = await page.evaluate((sel, t) => {
      const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(t) && !e.disabled);
      if (!el) return false;
      el.click();
      return true;
    }, selector, text);
    if (!ok) throw new Error('找不到按钮：' + text);
    await sleep(200);
  };
  const strays = [];
  const text = async () => {
    const r = await page.evaluate(() => ({
      main: document.querySelector('#main').innerText,
      body: document.body.innerText,
      navLinks: document.querySelectorAll('#nav a.nav-link').length,
      hash: location.hash
    }));
    if (/\bnull\b|undefined|\[object |127\.0\.0\.1/.test(r.body)) strays.push(r.hash + ': ' + (r.body.match(/.{0,30}(\bnull\b|undefined|\[object |127\.0\.0\.1).{0,30}/) || [''])[0]);
    if (r.navLinks !== 6) strays.push(r.hash + ': nav links = ' + r.navLinks);
    return r.main;
  };

  // 1. 空状态
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle0' });
  await sleep(400);
  check('今天页渲染', (await text()).includes('还没有素材'));
  await shot('01-today-empty');

  // 2. 导入：错误内容
  await page.goto(BASE + '#/import', { waitUntil: 'networkidle0' });
  await page.type('#pack-input', 'hello, this is not json');
  await clickText('button', '解析');
  check('错误内容给出提示', (await text()).includes('没找到 JSON'));
  await shot('02-import-error');

  // 3. 载入示例 → 预览
  await clickText('button', '载入示例 Pack');
  const t3 = await text();
  check('示例 Pack 进入确认页', t3.includes('确认导入') && t3.includes('unwind'));
  const candCount = await page.$$eval('.cand:not(.story-cand)', els => els.length);
  check('候选条目 12 条（含 2 条关键句、1 条说法升级）', candCount === 12, String(candCount));
  check('确认页有故事卡片', (await page.$$('.story-cand')).length === 1 && t3.includes('A low-key weekend'));
  // 把第一条改成「收藏」，最后一条改成「不要」
  await page.evaluate(() => {
    const cands = document.querySelectorAll('.cand:not(.story-cand)');
    cands[0].querySelector('[data-v="saved"]').click();
  });
  await sleep(150);
  await page.evaluate(() => {
    const cands = document.querySelectorAll('.cand:not(.story-cand)');
    cands[cands.length - 1].querySelector('[data-v="skip"]').click();
  });
  await sleep(150);
  const btnText = await page.$eval('#confirm-import', b => b.textContent);
  check('导入按钮计数更新', btnText.includes('10 条进复习') && btnText.includes('1 条收藏'), btnText);
  await shot('03-import-preview');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/v-03a-import-top.png` });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await sleep(150);
  await page.screenshot({ path: `${OUT}/v-03b-import-mid.png` });

  // 编辑弹窗
  await page.evaluate(() => document.querySelector('.cand [aria-label="编辑这一条"]').click());
  await sleep(250);
  const dlgOpen = await page.$eval('#dialog', d => d.open);
  check('编辑弹窗打开', dlgOpen);
  await page.evaluate(() => { const i = document.querySelector('#f-meaning_zh'); i.value = '放松（已编辑）'; });
  await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => b.textContent === '保存').click());
  await sleep(250);
  check('编辑后内容更新', (await text()).includes('放松（已编辑）'));
  await page.screenshot({ path: `${OUT}/03b-edit-done.png` });

  // 4. 确认导入 → 日报详情
  await page.click('#confirm-import');
  await sleep(400);
  const t4 = await text();
  check('导入后跳到日报详情', t4.includes('第 1 版') && t4.includes('说得好的句子'));
  await shot('04-pack-detail');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/v-04a-pack-top.png` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(150);
  await page.screenshot({ path: `${OUT}/v-04b-pack-bottom.png` });
  check('日报里有这天的日记', t4.includes('这天的日记') && t4.includes('A low-key weekend'));

  // 4b. 故事页：逐句播放、点句重听、高亮
  await clickText('a', '听和练');
  await sleep(300);
  const sents = await page.$$eval('.sent', els => els.length);
  check('故事页把完整版分成 8 句', sents === 8, String(sents));
  const marks = await page.$$eval('mark.kw', els => els.map(e => e.textContent));
  check('当天的表达在正文里高亮', marks.includes('low-key') && marks.includes('errands') && marks.includes('nothing fancy'), JSON.stringify(marks));
  await page.evaluate(() => document.querySelector('.player-bar [data-np="toggle"]').click());
  await sleep(500);
  const spoken1 = await page.evaluate(() => window.__spoken.slice());
  const nowSent = await page.$('.sent.now');
  check('点播放后一句接一句读，并高亮当前句', spoken1.length >= 2 && spoken1[0].startsWith('Last weekend') && !!nowSent, spoken1.length + ' 句');
  await page.screenshot({ path: `${OUT}/v-18-story-playing.png` });
  await page.evaluate(() => document.querySelectorAll('.sent')[4].click());
  await sleep(150);
  const lastSpoken = await page.evaluate(() => window.__spoken[window.__spoken.length - 1]);
  check('点某一句就从那句开始读', lastSpoken.startsWith('I have been meaning to'), lastSpoken);
  await page.evaluate(() => document.querySelector('.player-bar [data-np="toggle"]').click());
  await sleep(150);
  const toggleLabel = await page.$eval('.player-bar [data-np="toggle"]', b => b.textContent);
  check('可以暂停', toggleLabel.includes('播放'), toggleLabel);
  await clickText('button', '盲听');
  check('盲听模式隐藏正文', (await page.$$('.story-text.is-blind')).length === 1);
  await clickText('button', '连读');

  // 4c. 复述练习：第一次看提纲讲 1 分钟版，讲顺后 2 天后再讲
  await clickText('a', '讲一遍');
  await sleep(300);
  const tr = await text();
  check('复述页给提纲和要用上的表达', tr.includes('看提纲讲') && tr.includes('1 分钟版') && (await page.$$('ol.steps li')).length === 4, tr.split('\n').slice(0, 6).join(' | '));
  await page.screenshot({ path: `${OUT}/v-19-retell.png` });
  await page.evaluate(() => { const c = document.querySelector('#used-0'); if (c) c.click(); });
  await page.click('#retell-smooth');
  await sleep(400);
  check('讲顺后安排 2 天后再讲', (await text()).includes('复述：2天后讲'));

  // 4d. 听力页：连续循环播放 + 散步模式
  await page.goto(BASE + '#/listen', { waitUntil: 'networkidle0' });
  await sleep(300);
  check('听力页列出故事', (await text()).includes('A low-key weekend'));
  await page.click('#play-list');
  await sleep(3200);
  const listens = await page.evaluate(() => Object.values(window.__speakLoop.getState().stories)[0].listens);
  check('循环播放：听完一遍会记一次', listens >= 1, String(listens));
  await clickText('button', '散步模式');
  await sleep(200);
  check('散步模式全屏', !!(await page.$('.walk')));
  await page.screenshot({ path: `${OUT}/v-20-walk.png` });
  await page.evaluate(() => { const b = document.querySelector('.walk-main'); b.click(); b.click(); });
  await sleep(150);
  const walkLabel = await page.$eval('.walk-state', e => e.textContent);
  check('散步模式双击暂停', walkLabel.includes('播放'), walkLabel);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.walk-btn')].find(x => x.textContent.includes('退出')); b.click(); b.click(); });
  await sleep(200);
  check('双击退出散步模式', !(await page.$('.walk')));
  await page.screenshot({ path: `${OUT}/v-21-listen.png`, fullPage: true });

  // 5. 今天页
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle0' });
  await sleep(300);
  const t5 = await text();
  check('今天页显示待复习数量', /10 条等你说出来/.test(t5), t5.split('\n').slice(0, 8).join(' | '));
  check('今天页有「散步时听」', t5.includes('散步时听'));
  check('下次用上 3 条', (await page.$$eval('.target-list li', l => l.length)) === 3);
  await shot('05-today-filled');

  // 6. 复习
  await clickText('button', '开始复习');
  await sleep(300);
  check('复习卡片出现', !!(await page.$('#reveal-btn')));
  await shot('06-review-prompt');
  await clickText('button', '提示');
  await shot('07-review-hint');
  await page.click('#reveal-btn');
  await sleep(250);
  check('揭晓后出现 4 个评分按钮', (await page.$$('.rate')).length === 4);
  await shot('08-review-answer');
  // 第一张选「忘了」，它会回到队尾
  await page.click('#rate-1');
  await sleep(200);
  const prog = await page.$eval('.review-top .small', e => e.textContent);
  check('忘了之后总数 +1', prog.trim() === '1 / 11', prog);
  // 用键盘把剩下的做完：空格揭晓，3 打分
  let guard = 0;
  while ((await page.$('#reveal-btn')) && guard < 30) {
    const kind = await page.$eval('.recall .eyebrow', e => e.textContent);
    if (kind === '纠错重说' && !fs.existsSync(require('path').join(OUT, '09-review-fix.png'))) await shot('09-review-fix');
    if (kind === '关键句回忆' && !fs.existsSync(require('path').join(OUT, '09b-review-sentence.png'))) await shot('09b-review-sentence');
    await page.keyboard.press('Space');
    await sleep(120);
    await page.keyboard.press(guard % 4 === 0 ? '4' : '3');
    await sleep(150);
    guard++;
  }
  const t6 = await text();
  check('复习完成页', t6.includes('复习完成') && t6.includes('这一轮说了 11 次'), t6.split('\n').slice(0, 4).join(' | '));
  check('复习里出现过关键句卡片', fs.existsSync(require('path').join(OUT, '09b-review-sentence.png')));
  await shot('10-review-summary');

  // 7. 素材库
  await page.goto(BASE + '#/library', { waitUntil: 'networkidle0' });
  await clickText('button', '纠错');
  const t7 = await text();
  check('素材库纠错页有高频问题', t7.includes('高频问题'));
  await shot('11-library-fix');
  await page.type('#lib-search', 'weekend');
  await sleep(200);
  const found = await page.$eval('.item-list', e => e.querySelectorAll('.item-row').length);
  check('搜索能过滤', found === 1, String(found));
  await clickText('button', '单词');
  await shot('12-library-vocab');
  await page.evaluate(() => { const i = document.querySelector('#lib-search'); if (i) { i.value = ''; i.dispatchEvent(new Event('input')); } });
  await clickText('button', '故事');
  check('素材库有「故事」分类', (await page.$$('.story-row')).length === 1);

  // 8. 设置
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' });
  await sleep(300);
  check('设置页渲染', (await text()).includes('复制项目设置'));
  await page.type('#set-name', '小林');
  await page.keyboard.press('Tab');
  await sleep(200);
  await shot('13-settings');
  for (const [i, y] of [[1, 0], [2, 900], [3, 1800]]) {
    await page.evaluate(yy => window.scrollTo(0, yy), y);
    await sleep(120);
    await page.screenshot({ path: `${OUT}/v-13-settings-${i}.png` });
  }
  await page.goto(BASE + '#/library', { waitUntil: 'networkidle0' });
  await clickText('button', '纠错');
  await page.screenshot({ path: `${OUT}/v-11-library-fix.png` });
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' });

  // 9. 重新加载后数据仍在（IndexedDB）
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  const t9 = await text();
  check('刷新后数据还在，称呼生效', t9.includes('小林') && t9.includes('学习记录'), t9.split('\n').slice(0, 3).join(' | '));
  const st = await page.evaluate(() => {
    const s = window.__speakLoop.getState();
    const items = Object.values(s.items);
    return { items: items.length, reviewed: items.filter(i => i.srs.reps > 0).length, packs: Object.keys(s.packs).length };
  });
  check('数据：11 条素材、10 条已复习、1 份日报', st.items === 11 && st.reviewed === 10 && st.packs === 1, JSON.stringify(st));
  check('今天打卡', t9.includes('今天已打卡'));
  await shot('14-today-after');

  // 10. 加练
  await page.goto(BASE + '#/review', { waitUntil: 'networkidle0' });
  await sleep(200);
  const t10 = await text();
  check('复习页显示加练入口或剩余', t10.includes('加练') || t10.includes('全部'));
  await shot('15-review-home');

  // 11. 桌面和深色
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
  await page.goto(BASE + '#/today', { waitUntil: 'networkidle0' });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/16-desktop-today.png` });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(BASE + '#/library', { waitUntil: 'networkidle0' });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/17-desktop-dark-library.png` });

  // 12. Service worker 注册
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
  check('Service worker 已注册', sw);

  check('没有 JS 报错', errors.length === 0, errors.join(' || '));
  check('页面里没有 stray 文本', strays.length === 0, strays.join(' || '));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(2); });
