/* english.js — Loads /data/english.json and renders the Basic English study page.
 * Optimisations over the inline-data version:
 *  - HTML is ~25KB instead of 370KB → first byte arrives faster, parser unblocked.
 *  - Data fetched in parallel with stylesheet, cached via HTTP + sessionStorage.
 *  - Cards rendered after fetch; while pending, a skeleton placeholder is shown.
 *  - Filter / search uses requestIdleCallback to keep the input responsive when
 *    typing across 850 cards.
 */
'use strict';

(function () {
  const TAGS = { op: '操作词', gt: '普通事物', pt: '可描绘', qg: '性质词', qo: '反义词' };
  const SPEAKER_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // —— Load data —— //
  const SESSION_KEY = 'english_data_v3';
  async function loadData() {
    try {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    const res = await fetch('/data/english.json?v=2', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (_) {}
    return data;
  }

  // —— Render —— //
  function buildCard(w, syns) {
    const synsHtml = (w.s || [])
      .map((s) => {
        const info = (syns[w.w] && syns[w.w][s]) || null;
        const zh = info && info.def ? `<span class="syn-zh">${esc(info.def)}</span>` : '';
        return `<button class="syn" data-syn="${esc(s)}" data-main="${esc(w.w)}"><span class="syn-word">${esc(s)}</span>${zh}</button>`;
      })
      .join('');
    const ipaUs = w.ipa_us ? esc(w.ipa_us) : (w.ipa_uk ? esc(w.ipa_uk) : '');
    const ipaHtml = ipaUs ? `<span class="ipa">${ipaUs}</span>` : '';
    return `<article class="card" data-cat="${w.c}" data-w="${esc(w.w)}">
      <div class="card-head">
        <div class="word-row">
          <div class="word">${esc(w.w)}</div>
          ${ipaHtml}
          <button class="speak" data-text="${esc(w.w)}" data-rate="0.85" aria-label="读单词" style="margin-left:auto">${SPEAKER_SVG}</button>
        </div>
        <span class="tag">${TAGS[w.c]}</span>
      </div>
      <div class="def-zh">${esc(w.zh)}</div>
      <div class="def-en">${esc(w.en)}</div>
      <div class="example">
        <button class="speak" data-text="${esc(w.ex)}" data-rate="1.0" aria-label="读例句">${SPEAKER_SVG}</button>
        <div class="en">${esc(w.ex)}</div>
        <div class="zh">${esc(w.exz)}</div>
      </div>
      <div class="syns">${synsHtml}</div>
      <div class="syn-panel" hidden></div>
    </article>`;
  }

  function render(data) {
    const grids = { op: [], gt: [], pt: [], qg: [], qo: [] };
    for (const w of data.words) {
      if (grids[w.c]) grids[w.c].push(buildCard(w, data.syns));
    }
    for (const k of Object.keys(grids)) {
      const el = document.getElementById('grid-' + k);
      if (el) el.innerHTML = grids[k].join('');
    }
    document.body.classList.remove('is-loading');
  }

  // —— Filter (debounced) —— //
  let filterRaf = 0;
  function filter() {
    if (filterRaf) cancelAnimationFrame(filterRaf);
    filterRaf = requestAnimationFrame(_doFilter);
  }
  function _doFilter() {
    filterRaf = 0;
    const q = document.getElementById('q').value.trim().toLowerCase();
    const activeCat = document.querySelector('.pill.active').dataset.cat;
    let visible = 0;
    document.querySelectorAll('.card').forEach((c) => {
      const w = c.dataset.w.toLowerCase();
      const text = c.textContent.toLowerCase();
      const matchQ = !q || w.includes(q) || text.includes(q);
      const matchCat = activeCat === 'all' || c.dataset.cat === activeCat;
      const show = matchQ && matchCat;
      c.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    document.querySelectorAll('.section').forEach((s) => {
      const cat = s.dataset.cat;
      const showSec =
        (activeCat === 'all' || activeCat === cat) &&
        s.querySelectorAll('.card:not([style*="display: none"])').length > 0;
      s.style.display = showSec ? '' : 'none';
    });
    document.getElementById('empty').classList.toggle('show', visible === 0);
  }

  // —— TTS —— //
  let audioSource = 'youdao-us';
  let chosenVoice = null;
  let currentAudio = null;
  let currentBtn = null;

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const preferred = ['Ava (Premium)', 'Ava (Enhanced)', 'Ava', 'Samantha', 'Allison', 'Karen', 'Daniel (Enhanced)', 'Daniel', 'Alex', 'Google US English'];
    for (const name of preferred) {
      const v = voices.find((x) => x.name === name);
      if (v) return v;
    }
    return (
      voices.find((v) => v.lang && v.lang.startsWith('en-US')) ||
      voices.find((v) => v.lang && v.lang.startsWith('en')) ||
      voices[0]
    );
  }
  if ('speechSynthesis' in window) {
    chosenVoice = pickVoice();
    speechSynthesis.onvoiceschanged = () => { chosenVoice = pickVoice(); };
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (currentBtn) { currentBtn.classList.remove('playing'); currentBtn = null; }
  }

  function speak(text, rate, btn) {
    stopSpeaking();
    if (btn) { btn.classList.add('playing'); currentBtn = btn; }
    const clear = () => {
      if (btn) btn.classList.remove('playing');
      if (currentBtn === btn) currentBtn = null;
    };
    const isSentence = text.trim().includes(' ');
    if (!isSentence && (audioSource === 'youdao-uk' || audioSource === 'youdao-us')) {
      const type = audioSource === 'youdao-us' ? 2 : 1;
      const url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=' + type;
      currentAudio = new Audio(url);
      currentAudio.onended = clear;
      currentAudio.onerror = () => { clear(); fallbackToLocal(text, rate, btn); };
      currentAudio.play().catch(() => { clear(); fallbackToLocal(text, rate, btn); });
    } else {
      speakLocal(text, rate, btn, clear);
    }
  }
  function speakLocal(text, rate, btn, clear) {
    if (!('speechSynthesis' in window)) { clear(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate || 1.0;
    if (chosenVoice) u.voice = chosenVoice;
    u.onend = clear;
    u.onerror = clear;
    speechSynthesis.speak(u);
  }
  function fallbackToLocal(text, rate, btn) {
    if (btn) btn.classList.add('playing');
    speakLocal(text, rate, btn, () => { if (btn) btn.classList.remove('playing'); });
  }

  function renderSynPanel(syn, main, info) {
    if (!info) {
      return `<div class="syn-panel-head"><span class="sp-word">${esc(syn)}</span><span class="sp-vs">和 ${esc(main)} 的区别</span></div>
        <div class="sp-empty">细节正在补充中…点击仍可发音</div>`;
    }
    return `<div class="syn-panel-head"><span class="sp-word">${esc(syn)}</span><span class="sp-vs">和 ${esc(main)} 的区别</span></div>
      <div class="sp-row"><span class="sp-label">释义</span><span class="sp-val">${esc(info.def || '')}</span></div>
      <div class="sp-row"><span class="sp-label">区别</span><span class="sp-val">${esc(info.vs || '')}</span></div>
      <div class="sp-row"><span class="sp-label">场景</span><span class="sp-val">${esc(info.use || '')}</span></div>`;
  }

  // —— Wire everything up after data loads —— //
  function wireEvents(syns) {
    document.getElementById('q').addEventListener('input', filter);
    document.querySelectorAll('.pill').forEach((p) => {
      p.addEventListener('click', () => {
        document.querySelectorAll('.pill').forEach((x) => x.classList.remove('active'));
        p.classList.add('active');
        filter();
        // Smooth-scroll up to first visible section
        const first = document.querySelector('.section:not([style*="display: none"])');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('q').focus();
      }
      if (e.key === 'Escape') {
        document.getElementById('q').value = '';
        filter();
        document.getElementById('q').blur();
      }
    });
    document.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('.speak');
      if (speakBtn) {
        e.stopPropagation();
        const text = speakBtn.dataset.text;
        const rate = parseFloat(speakBtn.dataset.rate) || 1.0;
        if (speakBtn.classList.contains('playing')) { stopSpeaking(); return; }
        speak(text, rate, speakBtn);
        return;
      }
      const synBtn = e.target.closest('.syn');
      if (synBtn) {
        e.stopPropagation();
        const syn = synBtn.dataset.syn;
        const main = synBtn.dataset.main;
        const card = synBtn.closest('.card');
        const panel = card.querySelector('.syn-panel');
        const wasActive = synBtn.classList.contains('active');
        card.querySelectorAll('.syn.active').forEach((s) => s.classList.remove('active'));
        if (wasActive) {
          panel.hidden = true;
          panel.innerHTML = '';
        } else {
          synBtn.classList.add('active');
          const info = (syns[main] && syns[main][syn]) || null;
          panel.hidden = false;
          panel.innerHTML = renderSynPanel(syn, main, info);
        }
        speak(syn, 0.85, null);
      }
    });
  }

  // —— Boot —— //
  document.body.classList.add('is-loading');
  loadData()
    .then((data) => {
      render(data);
      wireEvents(data.syns);
    })
    .catch((err) => {
      console.error('Failed to load English data:', err);
      const empty = document.getElementById('empty');
      if (empty) {
        empty.textContent = '数据加载失败,请刷新页面重试。';
        empty.classList.add('show');
      }
      document.body.classList.remove('is-loading');
    });
})();
