/*
 * Speak Loop · player.js
 * 逐句朗读播放器：连读 / 盲听 / 跟读，多篇故事可以排成列表循环播放。
 * 用浏览器自带的 speechSynthesis。iPhone 锁屏或切到别的 App 时网页朗读会暂停，
 * 回到页面后从当前这句接着读；如果系统不让自动继续，界面会提示点一下继续。
 */
(function (root) {
  'use strict';

  const synth = root.speechSynthesis;
  function canSpeak() { return !!synth && typeof root.SpeechSynthesisUtterance === 'function'; }
  function words(text) { return (String(text).match(/[A-Za-z0-9'’-]+/g) || []).length; }

  // pieces: [{ id, title, sentences: ['...'], paraStarts: [0, 3, ...] }]
  function create(opts) {
    const o = opts || {};
    const st = {
      pieces: [], piece: 0, sent: 0,
      playing: false, waiting: false, stalled: false,
      mode: 'read', rate: o.rate || 0.95, loop: false
    };
    let token = 0;
    let timer = null;
    let watchdog = null;
    let resumeOnShow = false;
    const listeners = [];

    function snapshot() {
      const p = st.pieces[st.piece];
      return {
        piece: st.piece, sent: st.sent, pieces: st.pieces.length,
        pieceId: p ? p.id : null, title: p ? p.title : '', total: p ? p.sentences.length : 0,
        text: p ? p.sentences[st.sent] || '' : '',
        playing: st.playing, waiting: st.waiting, stalled: st.stalled,
        mode: st.mode, rate: st.rate, loop: st.loop
      };
    }
    function emit(type) {
      const snap = snapshot();
      listeners.slice().forEach(fn => { try { fn(type, snap); } catch (e) { console.warn(e); } });
    }
    function clearTimers() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    }
    function stopAudio() {
      token++;
      clearTimers();
      try { if (synth) synth.cancel(); } catch (e) { /* ignore */ }
    }
    function current() {
      const p = st.pieces[st.piece];
      return p ? p.sentences[st.sent] : null;
    }

    function speakCurrent() {
      const text = current();
      if (!text) { finish(); return; }
      stopAudio();
      const my = token;
      st.waiting = false;
      st.stalled = false;
      emit('sentence');
      let started = false;
      const u = new root.SpeechSynthesisUtterance(text.replace(/\.\.\.|…/g, ', '));
      const v = o.getVoice ? o.getVoice() : null;
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = st.rate;
      u.onstart = () => { started = true; };
      u.onend = () => { if (my === token) after(text, my); };
      u.onerror = e => {
        if (my !== token) return;
        if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
        after(text, my);
      };
      // 系统没让开始朗读（比如从后台回来后需要再点一下），就停下来提示
      watchdog = setTimeout(() => {
        // 有的浏览器不触发 onstart，只要正在出声就算开始了
        if (synth.speaking) started = true;
        if (my === token && !started && st.playing) {
          st.playing = false;
          st.stalled = true;
          stopAudio();
          emit('stalled');
        }
      }, 4000);
      synth.speak(u);
    }

    function after(text, my) {
      if (my !== token || !st.playing) return;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      const pause = st.mode === 'shadow' ? Math.round((words(text) * 0.42 / st.rate + 1.2) * 1000) : 250;
      st.waiting = st.mode === 'shadow';
      if (st.waiting) emit('shadow');
      timer = setTimeout(() => { if (my === token && st.playing) advance(); }, pause);
    }
    function gapThen(ms) {
      const my = token;
      st.waiting = true;
      emit('gap');
      timer = setTimeout(() => { if (my === token && st.playing) speakCurrent(); }, ms);
    }
    function advance() {
      const p = st.pieces[st.piece];
      if (p && st.sent + 1 < p.sentences.length) { st.sent++; speakCurrent(); return; }
      emit('pieceEnd');
      if (st.piece + 1 < st.pieces.length) { st.piece++; st.sent = 0; gapThen(1800); return; }
      if (st.loop && st.pieces.length) { st.piece = 0; st.sent = 0; gapThen(2500); return; }
      finish();
    }
    function finish() {
      st.playing = false;
      st.waiting = false;
      stopAudio();
      emit('end');
    }
    function clampPos(piece, sent) {
      const pi = Math.max(0, Math.min(st.pieces.length - 1, piece | 0));
      const p = st.pieces[pi];
      const si = p ? Math.max(0, Math.min(p.sentences.length - 1, sent | 0)) : 0;
      return [pi, si];
    }
    function move(delta) {
      let pi = st.piece;
      let si = st.sent + delta;
      while (st.pieces[pi] && si >= st.pieces[pi].sentences.length) {
        si -= st.pieces[pi].sentences.length;
        pi++;
        if (pi >= st.pieces.length) { if (!st.loop) return; pi = 0; }
      }
      while (si < 0) {
        pi--;
        if (pi < 0) { pi = 0; si = 0; break; }
        si += st.pieces[pi].sentences.length;
      }
      api.seek(pi, si);
    }

    const api = {
      load(pieces, startPiece, startSent) {
        stopAudio();
        st.pieces = (pieces || []).filter(p => p && p.sentences && p.sentences.length);
        st.playing = false;
        st.waiting = false;
        st.stalled = false;
        [st.piece, st.sent] = clampPos(startPiece || 0, startSent || 0);
        emit('load');
      },
      play() {
        if (!st.pieces.length || !canSpeak()) return false;
        st.playing = true;
        speakCurrent();
        return true;
      },
      pause() {
        st.playing = false;
        st.waiting = false;
        stopAudio();
        emit('pause');
      },
      toggle() { return st.playing ? (api.pause(), false) : api.play(); },
      seek(piece, sent) {
        [st.piece, st.sent] = clampPos(piece, sent);
        if (st.playing) speakCurrent();
        else emit('seek');
      },
      playFrom(piece, sent) {
        [st.piece, st.sent] = clampPos(piece, sent);
        return api.play();
      },
      next() { move(1); },
      prev() { move(-1); },
      nextPiece() { if (st.piece + 1 < st.pieces.length) api.seek(st.piece + 1, 0); else if (st.loop) api.seek(0, 0); },
      prevPiece() { api.seek(st.sent > 0 ? st.piece : Math.max(0, st.piece - 1), 0); },
      setRate(r) { st.rate = r; if (st.playing) speakCurrent(); else emit('rate'); },
      setMode(m) { st.mode = m; emit('mode'); },
      setLoop(b) { st.loop = !!b; emit('loop'); },
      state: snapshot,
      on(fn) {
        listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
      destroy() { stopAudio(); st.playing = false; listeners.length = 0; }
    };

    if (root.document) {
      root.document.addEventListener('visibilitychange', () => {
        if (root.document.hidden) {
          if (st.playing) { resumeOnShow = true; stopAudio(); }
        } else if (resumeOnShow) {
          resumeOnShow = false;
          if (st.playing) speakCurrent();
        }
      });
    }
    return api;
  }

  // 散步模式：保持亮屏（iPhone 需要 iOS 18.4 以上的主屏幕 Web App，或 Safari 16.4 以上）
  const wake = { lock: null, wanted: false };
  function wakeLockSupported() { return !!(root.navigator && root.navigator.wakeLock); }
  async function keepAwake(on) {
    wake.wanted = !!on;
    if (!wakeLockSupported()) return false;
    try {
      if (on && !wake.lock) {
        wake.lock = await root.navigator.wakeLock.request('screen');
        wake.lock.addEventListener('release', () => { wake.lock = null; });
      } else if (!on && wake.lock) {
        const l = wake.lock;
        wake.lock = null;
        await l.release();
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  if (root.document) {
    root.document.addEventListener('visibilitychange', () => {
      if (!root.document.hidden && wake.wanted && !wake.lock) keepAwake(true);
    });
  }

  root.SLPlayer = { create, canSpeak, keepAwake, wakeLockSupported, isAwake: () => !!wake.lock };
})(window);
