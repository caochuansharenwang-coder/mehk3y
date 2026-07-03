'use strict';

(function () {
  const DEFAULT_CHINESE_FONTS = [
    'DengXian',
    'FangSong',
    '方正小标宋简体',
    '小标宋体',
    '仿宋_GB2312',
    'HarmonyOS Sans',
    'Alibaba PuHuiTi',
    'Smiley Sans',
  ];

  const PROBE_GLOBAL = ['https://www.baidu.com/favicon.ico'];
  const PROBE_NOCHINA = [
    'https://www.gstatic.com/images/branding/searchlogo/ico/favicon.ico',
    'https://chatgpt.com/favicon.ico',
  ];

  const state = {
    mainland: false,
    strict: false,
    network: null,
    networkRunning: false,
  };

  const el = {
    resultTitle: document.getElementById('result-title'),
    resultSub: document.getElementById('result-sub'),
    scoreRing: document.getElementById('score-ring'),
    scoreValue: document.getElementById('score-value'),
    scoreLabel: document.getElementById('score-label'),
    networkSummary: document.getElementById('network-summary'),
    networkNote: document.getElementById('network-note'),
    signals: document.getElementById('signals'),
    mainlandToggle: document.getElementById('mainland-toggle'),
    strictToggle: document.getElementById('strict-toggle'),
    mainlandLabel: document.getElementById('mainland-label'),
    strictLabel: document.getElementById('strict-label'),
    networkBtn: document.getElementById('network-btn'),
  };

  function isChinaByLanguage(options) {
    if (typeof navigator === 'undefined') return false;
    const navigatorLanguage = navigator.language || navigator.userLanguage || 'en';
    const languages = navigator.languages || [navigatorLanguage];
    const isChinese = (lang) => {
      if (options && options.mainland) return /^zh(-Hans)?(-CN)?$/i.test(lang);
      return /^zh/i.test(lang);
    };
    if (options && options.strict) return isChinese(languages[0] || '');
    return Array.prototype.some.call(languages, isChinese);
  }

  function isChinaByTimeZone(options) {
    const mainland = Boolean(options && options.mainland);
    if (typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function') {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timeZone) {
        const mainlandTimeZones = [
          'Asia/Shanghai',
          'Asia/Chongqing',
          'Asia/Harbin',
          'Asia/Urumqi',
          'Asia/Kashgar',
          'Asia/Beijing',
          'PRC',
        ];
        const greaterChinaTimeZones = mainlandTimeZones.concat([
          'Asia/Hong_Kong',
          'Asia/Macau',
          'Asia/Taipei',
          'Hongkong',
          'ROC',
        ]);
        return (mainland ? mainlandTimeZones : greaterChinaTimeZones).includes(timeZone);
      }
    }
    if (options && options.strict) return false;
    return new Date().getTimezoneOffset() === -480;
  }

  function isChinaByFont(options) {
    if (typeof document === 'undefined') return false;
    const chineseFonts = options && options.fontList ? options.fontList : DEFAULT_CHINESE_FONTS;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const result = chineseFonts.some((font) => isFontAvailable(ctx, font));
    canvas.remove();
    return result;
  }

  function isFontAvailable(ctx, font) {
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const sample = 'mmmmmmmmmmlli中文测试';
    return baseFonts.some((baseFont) => {
      ctx.font = '72px ' + baseFont;
      const baseWidth = ctx.measureText(sample).width;
      ctx.font = '72px "' + font + '", ' + baseFont;
      const fontWidth = ctx.measureText(sample).width;
      return fontWidth !== baseWidth;
    });
  }

  function isChinaByEmoji() {
    if (typeof document === 'undefined') return null;
    if (isWindows()) return null;
    try {
      const control = getCharColors('😀');
      if (control.opaquePixelCount === 0 || control.isMono) return null;
      const flag = getCharColors('🇹🇼');
      if (flag.opaquePixelCount === 0) return true;
      return flag.isMono;
    } catch {
      return null;
    }
  }

  function getCharColors(char) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 100;
    if (!ctx) throw new Error('Canvas context not supported');
    canvas.width = fontSize;
    canvas.height = fontSize;
    ctx.font = fontSize + 'px sans-serif';
    ctx.fillStyle = 'black';
    ctx.textBaseline = 'top';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillText(char, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let isMono = true;
    let opaquePixelCount = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const a = imageData.data[i + 3];
      if (a > 0) {
        opaquePixelCount++;
        if (isMono && !(r === g && g === b)) isMono = false;
      }
    }
    canvas.remove();
    return { isMono, opaquePixelCount };
  }

  function isWindows() {
    if (navigator.platform && navigator.platform.startsWith('Win')) return true;
    return /Windows/i.test(navigator.userAgent || '');
  }

  function withCacheBuster(url) {
    return url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  }

  function probeImage(url, timeout) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (reachable) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(reachable);
      };
      const timer = setTimeout(() => finish(false), timeout);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = withCacheBuster(url);
    });
  }

  async function isChinaByNetwork(options) {
    if (typeof Image !== 'function') return null;
    const timeout = options && options.timeout ? options.timeout : 3000;
    const noChinaProbes = options && options.probes && options.probes.noChina ? options.probes.noChina : PROBE_NOCHINA;
    const globalProbes = options && options.probes && options.probes.global ? options.probes.global : PROBE_GLOBAL;

    const noChinaResults = await Promise.all(noChinaProbes.map(async (url) => ({
      type: 'noChina',
      url,
      reachable: await probeImage(url, timeout),
    })));
    const globalResults = await Promise.all(globalProbes.map(async (url) => ({
      type: 'global',
      url,
      reachable: await probeImage(url, timeout),
    })));
    const blockedSiteReachable = noChinaResults.some((item) => item.reachable);
    const controlSiteReachable = globalResults.some((item) => item.reachable);
    const result = blockedSiteReachable ? false : controlSiteReachable ? true : null;
    return { result, probes: noChinaResults.concat(globalResults) };
  }

  function getSignals() {
    const options = { mainland: state.mainland, strict: state.strict };
    const languages = navigator.languages || [navigator.language || navigator.userLanguage || 'en'];
    const timeZone = typeof Intl === 'object' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : '';
    const offset = new Date().getTimezoneOffset();
    const fontHit = isChinaByFont();
    const emojiHit = isChinaByEmoji();
    return [
      {
        id: 'language',
        title: '语言',
        value: isChinaByLanguage(options),
        detail: 'navigator.languages: ' + Array.from(languages).join(', '),
      },
      {
        id: 'timezone',
        title: '时区',
        value: isChinaByTimeZone(options),
        detail: timeZone ? 'Intl 时区: ' + timeZone : 'UTC 偏移: ' + offset + ' 分钟',
      },
      {
        id: 'emoji',
        title: 'Emoji 设备特征',
        value: emojiHit,
        detail: emojiHit === null ? '当前环境无法可靠判断，常见于 Windows、无彩色 Emoji 或 canvas 被限制。' : '通过普通 Emoji 与旗帜 Emoji 的 canvas 渲染差异判断。',
      },
      {
        id: 'font',
        title: '中文字体',
        value: fontHit,
        detail: '检测字体: ' + DEFAULT_CHINESE_FONTS.join(', '),
      },
    ];
  }

  function formatPill(value) {
    if (value === true) return '<span class="pill yes">命中</span>';
    if (value === false) return '<span class="pill no">未命中</span>';
    return '<span class="pill unknown">未知</span>';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderNetworkCard() {
    const network = state.network;
    let body = '未运行。点击上方按钮后，会并行探测大陆可达对照站和大陆通常不可达站点。';
    let value = null;
    let probeHtml = '';
    if (state.networkRunning) {
      body = '正在加载远程图片探针，通常 3 秒内返回。';
    } else if (network) {
      value = network.result;
      if (network.result === true) body = 'gstatic / ChatGPT 探针不可达，但百度对照可达，更像中国大陆网络出口。';
      if (network.result === false) body = '至少一个 gstatic / ChatGPT 探针可达，更像非大陆网络出口或正在走代理。';
      if (network.result === null) body = '探针和对照都不可达，可能离线、被扩展拦截或网络策略限制。';
      probeHtml = '<div class="probe-list">' + network.probes.map((probe) => (
        '<div class="probe-item"><span>' + escapeHtml(probe.type) + ' · ' + escapeHtml(new URL(probe.url).hostname) + '</span><b>' + (probe.reachable ? '可达' : '不可达') + '</b></div>'
      )).join('') + '</div>';
    }
    return '<article class="card signal-card">' +
      '<div class="signal-head"><h2 class="signal-title">网络出口</h2>' + formatPill(value) + '</div>' +
      '<div class="signal-detail">' + escapeHtml(body) + probeHtml + '</div>' +
      '</article>';
  }

  function render() {
    const signals = getSignals();
    const hitCount = signals.filter((signal) => signal.value === true).length;
    const isChinaUser = hitCount > 0;
    el.resultTitle.textContent = isChinaUser ? '更像中国用户' : '不像中国用户';
    el.resultTitle.className = 'result-main ' + (isChinaUser ? 'is-yes' : 'is-no');
    el.resultSub.textContent = isChinaUser
      ? '同步判断中至少一个设备侧信号命中。这个结果不包含 IP，也不等同于身份或法律意义上的地区归类。'
      : '同步判断未命中语言、时区、Emoji、字体信号。可以再手动运行网络出口检测。';
    el.scoreValue.textContent = hitCount + '/4';
    el.scoreLabel.textContent = state.mainland ? '大陆模式' : '大中华模式';
    el.mainlandToggle.setAttribute('aria-pressed', String(state.mainland));
    el.strictToggle.setAttribute('aria-pressed', String(state.strict));
    el.mainlandLabel.textContent = state.mainland ? '仅大陆：开' : '仅大陆：关';
    el.strictLabel.textContent = state.strict ? '严格：开' : '严格：关';
    el.networkBtn.disabled = state.networkRunning;
    el.networkBtn.textContent = state.networkRunning ? '检测中...' : state.network ? '重新检测网络出口' : '检测网络出口';
    renderNetworkSummary();
    el.signals.innerHTML = signals.map((signal) => (
      '<article class="card signal-card">' +
      '<div class="signal-head"><h2 class="signal-title">' + escapeHtml(signal.title) + '</h2>' + formatPill(signal.value) + '</div>' +
      '<div class="signal-detail">' + escapeHtml(signal.detail) + '</div>' +
      '</article>'
    )).join('') + renderNetworkCard();
  }

  function renderNetworkSummary() {
    let text = '未检测';
    let note = '不参与同步判断';
    let stateClass = 'is-pending';
    if (state.networkRunning) {
      text = '检测中';
      note = '正在加载图片探针';
    } else if (state.network) {
      if (state.network.result === true) {
        text = '大陆出口';
        note = '对照可达，境外探针不可达';
        stateClass = 'is-mainland';
      } else if (state.network.result === false) {
        text = '非大陆/代理';
        note = '境外探针可达';
        stateClass = 'is-global';
      } else {
        text = '无法判断';
        note = '探针和对照都不可达';
        stateClass = 'is-unknown';
      }
    }
    el.networkSummary.textContent = text;
    el.networkSummary.className = 'strip-val ' + stateClass;
    el.networkNote.textContent = note;
  }

  function bind() {
    el.mainlandToggle.addEventListener('click', () => {
      state.mainland = !state.mainland;
      render();
    });
    el.strictToggle.addEventListener('click', () => {
      state.strict = !state.strict;
      render();
    });
    el.networkBtn.addEventListener('click', async () => {
      state.networkRunning = true;
      state.network = null;
      render();
      try {
        state.network = await isChinaByNetwork({ timeout: 3000 });
      } catch {
        state.network = { result: null, probes: [] };
      } finally {
        state.networkRunning = false;
        render();
      }
    });
  }

  bind();
  render();
})();
