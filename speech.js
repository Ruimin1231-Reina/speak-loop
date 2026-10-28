/*
 * Speak Loop · speech.js
 * 发音（speechSynthesis）和可选的语音识别（SpeechRecognition）。
 * 都是浏览器自带能力，不需要任何 API Key。
 */
(function (root) {
  'use strict';

  const synth = root.speechSynthesis;
  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const LANG_ORDER = ['en-us', 'en-gb', 'en-au', 'en-nz', 'en-ca', 'en-ie', 'en-za', 'en-in'];
  const PREFERRED = /samantha|ava|allison|susan|karen|daniel|serena|moira|tessa|google us english|google uk english/i;
  let voices = [];
  const listeners = [];

  function langKey(lang) { return String(lang || '').replace('_', '-').toLowerCase(); }

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices() || [];
    listeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
  }

  function init(onChange) {
    if (onChange) listeners.push(onChange);
    if (!synth) return;
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  function englishVoices() {
    return voices
      .filter(v => /^en([-_]|$)/i.test(v.lang))
      .slice()
      .sort((a, b) => {
        const la = LANG_ORDER.indexOf(langKey(a.lang));
        const lb = LANG_ORDER.indexOf(langKey(b.lang));
        if (la !== lb) return (la === -1 ? 99 : la) - (lb === -1 ? 99 : lb);
        if (a.localService !== b.localService) return a.localService ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  function bestVoice(uri) {
    const list = englishVoices();
    return list.find(v => v.voiceURI === uri) || list.find(v => PREFERRED.test(v.name)) || list[0] || null;
  }

  function canSpeak() { return !!synth && typeof root.SpeechSynthesisUtterance === 'function'; }

  function speak(text, opts) {
    if (!canSpeak() || !text) return false;
    const o = opts || {};
    synth.cancel();
    const u = new root.SpeechSynthesisUtterance(String(text).replace(/\.\.\.|…/g, ', '));
    const v = bestVoice(o.voiceURI);
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
    u.rate = o.rate || 0.95;
    synth.speak(u);
    return true;
  }

  function canListen() { return typeof Recognition === 'function'; }

  const ERRORS = {
    'not-allowed': '没有麦克风权限。请在浏览器设置里允许本网站使用麦克风。',
    'service-not-allowed': '这个浏览器不允许语音识别（主屏幕模式下可能不支持，可以在 Safari 里打开试试）。',
    'no-speech': '没听到声音，再试一次。',
    'audio-capture': '找不到麦克风。',
    'network': '语音识别需要联网。',
    'aborted': '已停止。'
  };

  // 返回一个 stop() 函数
  function listen(opts) {
    const o = opts || {};
    if (!canListen()) {
      if (o.onError) o.onError('这个浏览器不支持语音识别，直接点「显示答案」就好。');
      return function () {};
    }
    let rec;
    try { rec = new Recognition(); } catch (e) {
      if (o.onError) o.onError('语音识别无法启动。');
      return function () {};
    }
    rec.lang = o.lang || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    let got = false;
    rec.onresult = e => {
      const res = e.results[e.results.length - 1];
      const alts = [];
      for (let i = 0; i < res.length; i++) alts.push(res[i].transcript);
      got = true;
      if (o.onResult) o.onResult(alts);
    };
    rec.onerror = e => { if (o.onError) o.onError(ERRORS[e.error] || ('语音识别出错：' + e.error)); };
    rec.onend = () => { if (o.onEnd) o.onEnd(got); };
    try { rec.start(); } catch (e) {
      if (o.onError) o.onError('语音识别无法启动。');
    }
    return function () { try { rec.stop(); } catch (e) { /* ignore */ } };
  }

  root.SLSpeech = { init, englishVoices, bestVoice, canSpeak, speak, canListen, listen };
})(window);
