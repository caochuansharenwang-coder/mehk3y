(function () {
  'use strict';

  const DATA_URL = '/data/exercises.json';
  const PAGE_SIZE = 80;
  const LANGUAGES = [
    ['zh', '中文'],
    ['en', 'EN'],
    ['es', 'ES'],
    ['it', 'IT'],
    ['tr', 'TR'],
    ['ru', 'RU']
  ];

  const state = {
    exercises: [],
    filtered: [],
    shown: PAGE_SIZE,
    selectedId: null,
    language: 'zh',
    filters: {
      query: '',
      category: '',
      equipment: '',
      target: ''
    }
  };

  const els = {
    total: document.getElementById('statTotal'),
    categories: document.getElementById('statCategories'),
    equipment: document.getElementById('statEquipment'),
    search: document.getElementById('searchInput'),
    clearSearch: document.getElementById('clearSearch'),
    category: document.getElementById('categorySelect'),
    equipmentSelect: document.getElementById('equipmentSelect'),
    target: document.getElementById('targetSelect'),
    quick: document.getElementById('quickFilters'),
    count: document.getElementById('resultCount'),
    list: document.getElementById('exerciseList'),
    detail: document.getElementById('detailPanel')
  };

  const labels = {
    category: {
      back: '背部',
      cardio: '有氧',
      chest: '胸部',
      neck: '颈部',
      shoulders: '肩部',
      waist: '腰腹',
      'upper arms': '上臂',
      'lower arms': '前臂',
      'upper legs': '大腿',
      'lower legs': '小腿'
    },
    equipment: {
      'body weight': '自重',
      dumbbell: '哑铃',
      cable: '绳索',
      barbell: '杠铃',
      'leverage machine': '器械',
      band: '弹力带',
      'smith machine': '史密斯机',
      kettlebell: '壶铃',
      weighted: '负重',
      'stability ball': '瑜伽球',
      'ez barbell': 'EZ 杠',
      assisted: '辅助器械'
    },
    target: {
      abs: '腹肌',
      pectorals: '胸肌',
      biceps: '肱二头肌',
      triceps: '肱三头肌',
      glutes: '臀肌',
      delts: '三角肌',
      lats: '背阔肌',
      'upper back': '上背',
      calves: '小腿',
      quads: '股四头肌',
      forearms: '前臂',
      hamstrings: '腘绳肌',
      traps: '斜方肌'
    }
  };

  function display(value, type) {
    if (!value) return '未知';
    return labels[type] && labels[type][value] ? labels[type][value] : value;
  }

  function titleCase(value) {
    return String(value || '')
      .split(' ')
      .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ');
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function countBy(items, key) {
    return items.reduce((acc, item) => {
      const value = item[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  function option(label, value) {
    const node = document.createElement('option');
    node.value = value || '';
    node.textContent = label;
    return node;
  }

  function fillSelect(select, values, allLabel, type) {
    select.replaceChildren(option(allLabel, ''));
    values.forEach(value => {
      const text = `${display(value, type)} · ${titleCase(value)}`;
      select.appendChild(option(text, value));
    });
  }

  function prepareExercise(exercise) {
    const secondary = Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles.join(' ') : '';
    const instructions = exercise.instructions || {};
    const translated = Object.values(instructions).join(' ');
    exercise._search = [
      exercise.id,
      exercise.name,
      exercise.category,
      exercise.body_part,
      exercise.equipment,
      exercise.target,
      exercise.muscle_group,
      secondary,
      translated
    ].filter(Boolean).join(' ').toLowerCase();
    return exercise;
  }

  function buildStats() {
    els.total.textContent = state.exercises.length.toLocaleString();
    els.categories.textContent = unique(state.exercises.map(item => item.category)).length;
    els.equipment.textContent = unique(state.exercises.map(item => item.equipment)).length;
  }

  function buildFilters() {
    fillSelect(els.category, unique(state.exercises.map(item => item.category)), '全部部位', 'category');
    fillSelect(els.equipmentSelect, unique(state.exercises.map(item => item.equipment)), '全部器械', 'equipment');
    fillSelect(els.target, unique(state.exercises.map(item => item.target)), '全部目标', 'target');

    const topCategories = Object.entries(countBy(state.exercises, 'category'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const chips = topCategories.map(([value, count]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.value = value;
      chip.textContent = `${display(value, 'category')} ${count}`;
      return chip;
    });
    els.quick.replaceChildren(...chips);
  }

  function matchesFilters(exercise) {
    const query = state.filters.query.trim().toLowerCase();
    if (query && !exercise._search.includes(query)) return false;
    if (state.filters.category && exercise.category !== state.filters.category) return false;
    if (state.filters.equipment && exercise.equipment !== state.filters.equipment) return false;
    if (state.filters.target && exercise.target !== state.filters.target) return false;
    return true;
  }

  function applyFilters(keepSelection) {
    state.filtered = state.exercises.filter(matchesFilters);
    state.shown = PAGE_SIZE;

    if (!keepSelection || !state.filtered.some(item => item.id === state.selectedId)) {
      state.selectedId = state.filtered[0] ? state.filtered[0].id : null;
    }

    renderList();
    renderDetail();
    updateFilterUi();
  }

  function updateFilterUi() {
    els.clearSearch.classList.toggle('visible', Boolean(state.filters.query));
    els.quick.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.value === state.filters.category);
    });
  }

  function renderList() {
    const total = state.filtered.length;
    els.count.textContent = total === state.exercises.length
      ? `${total.toLocaleString()} 个动作`
      : `${total.toLocaleString()} / ${state.exercises.length.toLocaleString()} 个动作`;

    if (total === 0) {
      els.list.innerHTML = '<div class="empty">没有匹配的动作。换一个关键词，或清空部位/器械/目标筛选。</div>';
      return;
    }

    const visible = state.filtered.slice(0, state.shown);
    els.list.replaceChildren(...visible.map(renderCard));

    if (state.shown < total) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'exercise-card';
      more.innerHTML = '<span class="avatar">+</span><span><span class="card-title">加载更多</span><span class="card-meta"><span class="pill">继续显示下一批动作</span></span></span>';
      more.addEventListener('click', () => {
        state.shown += PAGE_SIZE;
        renderList();
      });
      els.list.appendChild(more);
    }
  }

  function renderCard(exercise) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `exercise-card${exercise.id === state.selectedId ? ' active' : ''}`;
    button.dataset.id = exercise.id;

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = exercise.name ? exercise.name.charAt(0) : '?';

    const body = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = exercise.name || `Exercise ${exercise.id}`;

    const meta = document.createElement('span');
    meta.className = 'card-meta';
    [
      display(exercise.category, 'category'),
      display(exercise.equipment, 'equipment'),
      display(exercise.target, 'target')
    ].forEach(text => {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = text;
      meta.appendChild(pill);
    });

    body.append(title, meta);
    button.append(avatar, body);
    button.addEventListener('click', () => {
      state.selectedId = exercise.id;
      renderList();
      renderDetail();
    });
    return button;
  }

  function selectedExercise() {
    return state.exercises.find(item => item.id === state.selectedId);
  }

  function instructionSteps(exercise) {
    const steps = exercise.instruction_steps && exercise.instruction_steps[state.language];
    if (Array.isArray(steps) && steps.length) return steps;
    const text = exercise.instructions && exercise.instructions[state.language];
    if (text) return text.split(/(?<=[。.!?])\s+/).filter(Boolean);
    return [];
  }

  function renderDetail() {
    const exercise = selectedExercise();
    if (!exercise) {
      els.detail.innerHTML = '<div class="detail-placeholder">没有可显示的动作。</div>';
      return;
    }

    els.detail.replaceChildren();

    const kicker = document.createElement('div');
    kicker.className = 'detail-kicker';
    kicker.textContent = `#${exercise.id} · ${display(exercise.category, 'category')}`;

    const title = document.createElement('h2');
    title.className = 'detail-title';
    title.textContent = exercise.name;

    const meta = document.createElement('div');
    meta.className = 'meta-grid';
    [
      ['身体部位', display(exercise.body_part || exercise.category, 'category')],
      ['器械', display(exercise.equipment, 'equipment')],
      ['目标', display(exercise.target, 'target')],
      ['协同肌群', exercise.muscle_group || '未知']
    ].forEach(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'meta-box';
      box.innerHTML = `<div class="meta-label">${label}</div><div class="meta-value"></div>`;
      box.querySelector('.meta-value').textContent = value;
      meta.appendChild(box);
    });

    const langTabs = document.createElement('div');
    langTabs.className = 'lang-tabs';
    LANGUAGES.forEach(([code, label]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `lang-tab${state.language === code ? ' active' : ''}`;
      tab.textContent = label;
      tab.addEventListener('click', () => {
        state.language = code;
        renderDetail();
      });
      langTabs.appendChild(tab);
    });

    const stepSection = document.createElement('section');
    stepSection.className = 'section';
    const steps = instructionSteps(exercise);
    const stepItems = steps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
    stepSection.innerHTML = `<h2>动作步骤</h2><ol class="steps">${stepItems || '<li>这个语言暂无说明。</li>'}</ol>`;

    const secondary = Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles : [];
    const muscleSection = document.createElement('section');
    muscleSection.className = 'section';
    muscleSection.innerHTML = '<h2>相关肌群</h2>';
    const muscles = document.createElement('div');
    muscles.className = 'muscles';
    [exercise.target, exercise.muscle_group, ...secondary].filter(Boolean).forEach(item => {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = display(item, 'target');
      muscles.appendChild(pill);
    });
    muscleSection.appendChild(muscles);

    const source = document.createElement('section');
    source.className = 'section source';
    source.innerHTML = '<h2>来源说明</h2><p>原数据保留 <code>media_id</code>，但图片和 GIF 未随仓库分发。此页只展示结构化文本数据。</p>';

    els.detail.append(kicker, title, meta, langTabs, stepSection, muscleSection, source);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function wireEvents() {
    let searchTimer = null;
    els.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.query = els.search.value;
        applyFilters(true);
      }, 120);
    });

    els.clearSearch.addEventListener('click', () => {
      els.search.value = '';
      state.filters.query = '';
      applyFilters(true);
      els.search.focus();
    });

    els.category.addEventListener('change', () => {
      state.filters.category = els.category.value;
      applyFilters(false);
    });

    els.equipmentSelect.addEventListener('change', () => {
      state.filters.equipment = els.equipmentSelect.value;
      applyFilters(false);
    });

    els.target.addEventListener('change', () => {
      state.filters.target = els.target.value;
      applyFilters(false);
    });

    els.quick.addEventListener('click', event => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      state.filters.category = state.filters.category === chip.dataset.value ? '' : chip.dataset.value;
      els.category.value = state.filters.category;
      applyFilters(false);
    });
  }

  async function boot() {
    wireEvents();
    try {
      const response = await fetch(DATA_URL, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.exercises = data.map(prepareExercise);
      buildStats();
      buildFilters();
      applyFilters(false);
    } catch (error) {
      els.count.textContent = '加载失败';
      els.list.innerHTML = '<div class="empty">动作数据没有加载成功。请刷新页面再试。</div>';
      els.detail.innerHTML = `<div class="detail-placeholder">错误：${escapeHtml(error.message || error)}</div>`;
    }
  }

  boot();
}());
