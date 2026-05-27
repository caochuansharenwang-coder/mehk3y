const englishData = require('../../utils/english.js');

const TAGS = { op: '操作词', gt: '普通事物', pt: '可描绘', qg: '性质词', qo: '反义词' };
const CATEGORIES = [
  { cat: 'all', label: '全部', count: 850 },
  { cat: 'op',  label: '操作词', count: 100 },
  { cat: 'gt',  label: '普通事物', count: 400 },
  { cat: 'pt',  label: '可描绘', count: 200 },
  { cat: 'qg',  label: '性质词', count: 100 },
  { cat: 'qo',  label: '反义词', count: 50 }
];

// Pre-process: attach IPA + tag label
const ALL_WORDS = englishData.words.map((w) => ({
  ...w,
  ipa: w.ipa_us || w.ipa_uk || '',
  tagLabel: TAGS[w.c] || ''
}));

function buildSections(words) {
  const map = {};
  for (const c of Object.keys(TAGS)) map[c] = [];
  for (const w of words) {
    if (map[w.c]) map[w.c].push(w);
  }
  return Object.keys(TAGS).map((c) => ({
    cat: c,
    label: TAGS[c],
    words: map[c]
  }));
}

let audioCtx = null;
let lastPlayedText = '';

function playAudio(text) {
  if (!audioCtx) {
    audioCtx = wx.createInnerAudioContext();
  } else {
    audioCtx.stop();
  }
  const url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=2';
  audioCtx.src = url;
  audioCtx.play();
  lastPlayedText = text;
}

Page({
  data: {
    query: '',
    activeCat: 'all',
    categories: CATEGORIES,
    sections: buildSections(ALL_WORDS),
    empty: false
  },

  _filterTimer: null,

  onQueryInput(e) {
    const q = e.detail.value;
    this.setData({ query: q });
    this._scheduleFilter();
  },

  clearQuery() {
    this.setData({ query: '' });
    this._scheduleFilter();
  },

  onPillTap(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ activeCat: cat });
    this._scheduleFilter();
  },

  _scheduleFilter() {
    if (this._filterTimer) clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(() => this._doFilter(), 120);
  },

  _doFilter() {
    const q = (this.data.query || '').trim().toLowerCase();
    const cat = this.data.activeCat;
    const filtered = ALL_WORDS.filter((w) => {
      if (cat !== 'all' && w.c !== cat) return false;
      if (!q) return true;
      if (w.w.toLowerCase().includes(q)) return true;
      if (w.zh && w.zh.includes(q)) return true;
      if (w.en && w.en.toLowerCase().includes(q)) return true;
      if (w.ex && w.ex.toLowerCase().includes(q)) return true;
      if (w.exz && w.exz.includes(q)) return true;
      return false;
    });
    this.setData({
      sections: buildSections(filtered),
      empty: filtered.length === 0
    });
  },

  onSpeakTap(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    playAudio(text);
  },

  onUnload() {
    if (audioCtx) {
      audioCtx.destroy();
      audioCtx = null;
    }
  }
});
