/*
 * Speak Loop · ui.js
 * 通用界面工具：安全地创建元素（只用 textContent，不拼 HTML）、图标、提示条、剪贴板、表单弹窗。
 */
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // h('button', { class: 'btn', onclick: fn, fk: 'key' }, '文字', childEl)
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') value = v;
        else if (k === 'fk') el.dataset.fk = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    append(el, kids);
    if (value !== undefined) el.value = value;
    return el;
  }

  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false || k === '') continue;
      el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    }
    return el;
  }

  // 线条图标（24×24，描边）
  const ICONS = {
    home: [['path', 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z']],
    review: [['path', 'M21 12a9 9 0 1 1-2.64-6.36'], ['path', 'M21 4v5h-5']],
    packs: [['rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }], ['path', 'M16 2v4M8 2v4M3 10h18']],
    library: [['path', 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z'], ['path', 'M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z']],
    settings: [['path', 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6']],
    speaker: [['path', 'M11 5 6 9H2v6h4l5 4z'], ['path', 'M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14']],
    mic: [['rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }], ['path', 'M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8']],
    plus: [['path', 'M12 5v14M5 12h14']],
    copy: [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }], ['path', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']],
    edit: [['path', 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z']],
    trash: [['path', 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6']],
    right: [['path', 'M5 12h14M13 6l6 6-6 6']],
    left: [['path', 'M19 12H5M11 18l-6-6 6-6']],
    check: [['path', 'M20 6 9 17l-5-5']],
    x: [['path', 'M18 6 6 18M6 6l12 12']],
    cloud: [['path', 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z']],
    bulb: [['path', 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z']],
    eye: [['path', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z'], ['circle', { cx: 12, cy: 12, r: 3 }]],
    clipboard: [['path', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'], ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1 }]],
    chat: [['path', 'M21 12a8.5 8.5 0 0 1-12.6 7.44L3 21l1.56-5.4A8.5 8.5 0 1 1 21 12z']],
    download: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3']],
    upload: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12']],
    star: [['path', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z']],
    target: [['circle', { cx: 12, cy: 12, r: 10 }], ['circle', { cx: 12, cy: 12, r: 6 }], ['circle', { cx: 12, cy: 12, r: 2 }]],
    sync: [['path', 'M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2'], ['path', 'M18.5 2v4h-4M5.5 22v-4h4']],
    book: [['path', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z'], ['path', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5']]
  };

  function icon(name, size) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const s = String(size || 20);
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('icon');
    for (const [tag, attrs] of ICONS[name] || []) {
      const node = document.createElementNS(SVG_NS, tag);
      if (typeof attrs === 'string') node.setAttribute('d', attrs);
      else for (const a of Object.keys(attrs)) node.setAttribute(a, String(attrs[a]));
      svg.appendChild(node);
    }
    return svg;
  }

  function toast(msg, type) {
    const wrap = document.getElementById('toast');
    if (!wrap) return;
    const el = h('div', { class: 'toast' + (type ? ' toast-' + type : ''), role: type === 'error' ? 'alert' : 'status', text: msg });
    wrap.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), type === 'error' ? 5200 : 2800);
    setTimeout(() => el.remove(), type === 'error' ? 5600 : 3200);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || '已复制');
      return true;
    } catch (e) {
      const ta = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', top: '0', left: '0', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      toast(ok ? (okMsg || '已复制') : '复制失败，请长按文字手动复制', ok ? '' : 'error');
      return ok;
    }
  }

  async function readClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('这个浏览器不支持读取剪贴板，请长按输入框选择「粘贴」');
    return navigator.clipboard.readText();
  }

  // 表单弹窗。fields: [{ key, label, type: 'text'|'textarea'|'select', options: [[value,label]], required, value, hint }]
  function formDialog(opts) {
    const dlg = document.getElementById('dialog');
    return new Promise(resolve => {
      const form = h('form', { method: 'dialog', class: 'dialog-form' });
      form.appendChild(h('h2', { class: 'dialog-title', id: 'dialog-title', text: opts.title || '编辑' }));
      for (const f of opts.fields) {
        const id = 'f-' + f.key;
        let control;
        if (f.type === 'textarea') {
          control = h('textarea', { id, name: f.key, rows: f.rows || 2, class: 'input', required: !!f.required, value: f.value || '' });
        } else if (f.type === 'select') {
          control = h('select', { id, name: f.key, class: 'input', value: f.value || '' },
            f.options.map(([v, label]) => h('option', { value: v, text: label })));
        } else {
          control = h('input', { id, name: f.key, type: 'text', class: 'input', required: !!f.required, value: f.value || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
        }
        form.appendChild(h('div', { class: 'field' },
          h('label', { for: id, text: f.label }),
          control,
          f.hint ? h('p', { class: 'field-hint', text: f.hint }) : null));
      }
      form.appendChild(h('div', { class: 'row row-end' },
        h('button', { class: 'btn btn-ghost', value: 'cancel', type: 'submit', formnovalidate: true, text: '取消' }),
        h('button', { class: 'btn btn-primary', value: 'ok', type: 'submit', text: opts.okText || '保存' })));
      dlg.replaceChildren(form);
      dlg.setAttribute('aria-labelledby', 'dialog-title');
      dlg.returnValue = '';
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        if (dlg.returnValue !== 'ok') { resolve(null); return; }
        const data = {};
        for (const f of opts.fields) data[f.key] = String(form.elements[f.key].value || '').trim();
        resolve(data);
      };
      dlg.addEventListener('close', onClose);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
      const first = form.querySelector('input, textarea, select');
      if (first) setTimeout(() => first.focus(), 30);
    });
  }

  root.SLUI = { h, append, icon, toast, copyText, readClipboard, formDialog };
})(window);
