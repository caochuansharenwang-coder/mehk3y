'use strict';

(function () {
  /* ── Hama Midi bead palette ── */
  const RAW_PALETTE = [
    ['H01','白色',255,255,255], ['H02','奶白',245,240,218], ['H03','象牙',215,200,170],
    ['H04','浅黄',255,242,110], ['H05','黄色',255,220,0],   ['H06','琥珀黄',255,180,0],
    ['H07','橙色',255,115,0],  ['H08','深橙',255,65,0],     ['H09','红色',215,20,30],
    ['H10','暗红',170,15,25],  ['H11','粉红',255,140,175],  ['H12','浅粉',255,200,210],
    ['H13','玫红',225,30,95],  ['H14','品红',190,20,85],    ['H15','紫红',140,25,105],
    ['H16','深紫',80,20,140],  ['H17','薰衣草',200,170,230],['H18','紫色',150,50,180],
    ['H19','丁香紫',170,145,210],['H20','深蓝',20,50,145],  ['H21','蓝色',25,100,205],
    ['H22','天蓝',70,165,245], ['H23','浅蓝',185,220,250],  ['H24','青绿',0,185,215],
    ['H25','深青',0,95,105],   ['H26','青色',0,170,190],    ['H27','浅青',175,235,242],
    ['H28','薄荷绿',130,205,195],['H29','浅绿',160,215,165],['H30','草绿',65,165,70],
    ['H31','深绿',25,95,35],   ['H32','森林绿',45,125,50],  ['H33','橄榄绿',100,115,30],
    ['H34','黄绿',195,235,40], ['H35','嫩绿',160,240,80],   ['H36','焦糖',220,175,110],
    ['H37','棕色',150,100,60], ['H38','深棕',90,55,30],     ['H39','巧克力',65,38,22],
    ['H40','肤色',255,210,185],['H41','浅灰',220,220,220],  ['H42','灰色',155,155,155],
    ['H43','深灰',90,90,90],   ['H44','黑色',28,28,28],     ['H45','金色',215,175,55],
    ['H46','银色',185,195,200],['H47','荧光黄',240,250,0],  ['H48','荧光橙',255,90,10],
    ['H49','荧光粉',255,55,130],['H50','荧光绿',100,255,80],['H51','白烟',235,240,240],
  ];
  const PALETTE = RAW_PALETTE.map(([code, name, r, g, b]) => ({
    code, name, r, g, b,
    hex: '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join(''),
  }));

  /* ── Color matching ── */
  function colorDist(r1,g1,b1,r2,g2,b2) {
    const rm = (r1+r2)/2, dr=r1-r2, dg=g1-g2, db=b1-b2;
    return (2+rm/256)*dr*dr + 4*dg*dg + (2+(255-rm)/256)*db*db;
  }
  function nearestIdx(r,g,b) {
    let best=0, bd=Infinity;
    for (let i=0;i<PALETTE.length;i++){
      const p=PALETTE[i], d=colorDist(r,g,b,p.r,p.g,p.b);
      if(d<bd){bd=d;best=i;}
    }
    return best;
  }

  /* ── Image analysis (edge complexity → recommended grid size) ── */
  function analyzeImage(img) {
    const SZ = 96;
    const c = document.createElement('canvas'); c.width=c.height=SZ;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, SZ, SZ);
    const d = ctx.getImageData(0,0,SZ,SZ).data;

    const gray = (x,y) => {
      const i=(y*SZ+x)*4; return d[i]*.299+d[i+1]*.587+d[i+2]*.114;
    };
    let sum=0, n=0;
    for (let y=1;y<SZ-1;y++) for (let x=1;x<SZ-1;x++) {
      const gx = gray(x+1,y)-gray(x-1,y);
      const gy = gray(x,y+1)-gray(x,y-1);
      sum += Math.sqrt(gx*gx+gy*gy); n++;
    }
    const edgeMean = sum/n; // typically 0–60+
    // Map to recommended grid size
    if (edgeMean > 35) return 200;
    if (edgeMean > 22) return 128;
    if (edgeMean > 12) return 64;
    return 32;
  }

  /* ── Edge density at given resolution (for detail score) ── */
  function edgeDensity(img, w, h) {
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img,0,0,w,h);
    const d = ctx.getImageData(0,0,w,h).data;
    const gray = (x,y) => { const i=(y*w+x)*4; return d[i]*.299+d[i+1]*.587+d[i+2]*.114; };
    let sum=0, n=0;
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      const gx=gray(x+1,y)-gray(x-1,y), gy=gray(x,y+1)-gray(x,y-1);
      sum+=Math.sqrt(gx*gx+gy*gy); n++;
    }
    return n>0 ? sum/n : 0;
  }

  /* ── Grid dimension helpers ── */
  function gridDims(img, sliderVal) {
    const aspect = img.width / img.height;
    let gw, gh;
    if (aspect >= 1) { gw=sliderVal; gh=Math.max(1,Math.round(sliderVal/aspect)); }
    else             { gh=sliderVal; gw=Math.max(1,Math.round(sliderVal*aspect)); }
    return [gw, gh];
  }

  function gridFromBudget(img, targetBeads) {
    const aspect = img.width / img.height;
    const gw = Math.max(4, Math.min(400, Math.round(Math.sqrt(targetBeads * aspect))));
    const gh = Math.max(4, Math.min(400, Math.round(Math.sqrt(targetBeads / aspect))));
    return [gw, gh];
  }

  /* ── State ── */
  let loadedImg   = null;
  let resultData  = null;
  let recGridSize = 32;
  let refEdge     = 0;         // edge density at reference (high) resolution
  let renderTimer = null;
  let activeBudget = null;     // null = use slider; number = fixed grid from budget

  /* ── DOM ── */
  const uploadZone    = document.getElementById('upload-zone');
  const fileInput     = document.getElementById('file-input');
  const previewSec    = document.getElementById('preview-section');
  const originalImg   = document.getElementById('original-img');
  const canvas        = document.getElementById('bead-canvas');
  const ctx           = canvas.getContext('2d');
  const gridSlider    = document.getElementById('grid-slider');
  const sliderDimBadge= document.getElementById('slider-dim-badge');
  const chipDims      = document.getElementById('chip-dims');
  const chipPhys      = document.getElementById('chip-phys');
  const chipBeads     = document.getElementById('chip-beads');
  const chipColors    = document.getElementById('chip-colors');
  const smartRec      = document.getElementById('smart-rec');
  const recTitle      = document.getElementById('rec-title');
  const recSub        = document.getElementById('rec-sub');
  const upgradeHint   = document.getElementById('upgrade-hint');
  const budgetToggle  = document.getElementById('budget-toggle');
  const budgetBody    = document.getElementById('budget-body');
  const budgetOptions = document.querySelectorAll('.budget-option');
  const sliderMarks   = document.querySelectorAll('.slider-mark');
  const totalBeadsEl  = document.getElementById('total-beads');
  const totalColorsEl = document.getElementById('total-colors');
  const gridDimsEl    = document.getElementById('grid-dims');
  const tableBody     = document.getElementById('color-table-body');
  const dlBtn         = document.getElementById('dl-btn');
  const dlCsvBtn      = document.getElementById('dl-csv-btn');
  const changeBtn     = document.getElementById('change-btn');

  /* ── Upload ── */
  uploadZone.addEventListener('keydown', e => {
    if (e.key==='Enter'||e.key===' ') { e.preventDefault(); fileInput.click(); }
  });
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadFile(f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  changeBtn.addEventListener('click', () => fileInput.click());

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        loadedImg = img;
        originalImg.src = e.target.result;

        // Analyse complexity → smart recommendation
        recGridSize = analyzeImage(img);
        const refW = Math.min(128, img.width), refH = Math.min(128, img.height);
        refEdge = edgeDensity(img, refW, refH);

        showSmartRec();

        // Show preview section, hide upload zone
        uploadZone.style.display = 'none';
        previewSec.classList.add('visible');
        activeBudget = null;
        clearBudgetActive();

        processImage();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── Smart recommendation ── */
  function showSmartRec() {
    const curVal = parseInt(gridSlider.value, 10);
    const [curW, curH] = gridDims(loadedImg, curVal);
    const curEdge = edgeDensity(loadedImg, curW, curH);
    const retention = refEdge > 0 ? Math.min(100, Math.round(curEdge / refEdge * 100)) : 100;

    const PRESET_NAMES = {16:'极速（16×16）',32:'标准（32×32）',64:'高清（64×64）',96:'超清（96×96）',128:'专业（128×128）',160:'发烧（160×160）',200:'旗舰（200×200）',256:'极限（256×256）',320:'巨幅（320×320）',400:'打印级（400×400）'};

    if (retention >= 80 || curVal >= recGridSize) {
      smartRec.style.display = 'none';
    } else {
      smartRec.style.display = 'flex';
      smartRec.className = 'smart-rec' + (retention < 55 ? ' warn' : '');
      recTitle.textContent = `建议使用 ${PRESET_NAMES[recGridSize] || recGridSize+'×'+recGridSize}`;
      recSub.textContent   = `当前清晰度下细节丢失约 ${100-retention}%`;
    }
  }

  /* ── Slider ── */
  gridSlider.addEventListener('input', () => {
    activeBudget = null; clearBudgetActive();
    updateSliderUI();
    scheduleProcess();
  });

  function updateSliderUI() {
    if (!loadedImg) return;
    const val = parseInt(gridSlider.value, 10);
    const [gw, gh] = activeBudget ? gridFromBudget(loadedImg, activeBudget) : gridDims(loadedImg, val);
    const phys = Math.round(gw * 0.5);   // 5mm per bead → cm
    const estBeads = gw * gh;

    sliderDimBadge.textContent = `${gw} × ${gh}`;
    chipDims.textContent  = `${gw} × ${gh}`;
    chipPhys.textContent  = `约 ${phys} cm`;
    chipBeads.textContent = `约 ${estBeads.toLocaleString('zh-CN')}`;

    // Update slider mark highlights
    sliderMarks.forEach(m => {
      m.classList.toggle('active', parseInt(m.dataset.val,10) === val);
    });
  }

  /* Clicking a mark snaps to that value */
  sliderMarks.forEach(m => {
    m.addEventListener('click', () => {
      activeBudget = null; clearBudgetActive();
      gridSlider.value = m.dataset.val;
      updateSliderUI();
      processImage();
    });
  });

  /* ── Budget picker ── */
  budgetToggle.addEventListener('click', () => {
    const open = budgetBody.classList.toggle('open');
    budgetToggle.classList.toggle('open', open);
    budgetToggle.setAttribute('aria-expanded', open);
  });

  budgetOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const beads = parseInt(opt.dataset.beads, 10);
      activeBudget = beads;
      budgetOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      updateSliderUI();
      processImage();
    });
  });

  function clearBudgetActive() {
    budgetOptions.forEach(o => o.classList.remove('active'));
  }

  /* ── Debounced processing ── */
  function scheduleProcess(ms=120) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(processImage, ms);
  }

  /* ── Core processing ── */
  function processImage() {
    if (!loadedImg) return;
    let gw, gh;
    if (activeBudget) {
      [gw, gh] = gridFromBudget(loadedImg, activeBudget);
    } else {
      [gw, gh] = gridDims(loadedImg, parseInt(gridSlider.value, 10));
    }

    // Downsample with high-quality smoothing
    const sc = document.createElement('canvas'); sc.width=gw; sc.height=gh;
    const sctx = sc.getContext('2d');
    sctx.imageSmoothingEnabled=true; sctx.imageSmoothingQuality='high';
    sctx.drawImage(loadedImg, 0, 0, gw, gh);
    const imgData = sctx.getImageData(0,0,gw,gh).data;

    // Nearest-palette-color mapping — no sharpening, no dithering
    const total  = gw*gh;
    const grid   = new Uint8Array(total);
    const counts = new Map();
    for (let i=0; i<total; i++) {
      const idx = nearestIdx(imgData[i*4], imgData[i*4+1], imgData[i*4+2]);
      grid[i] = idx;
      counts.set(idx, (counts.get(idx)||0)+1);
    }

    resultData = {grid, gw, gh, counts, total};
    renderCanvas(gw, gh, grid);
    renderStats(gw, gh, counts, total);
    renderScores(gw, gh, counts, total);
    renderTable(counts, total);
    showSmartRec();
    updateSliderUI();
  }

  /* ── Canvas rendering — one canvas pixel per bead, CSS scales for display ── */
  function renderCanvas(gw, gh, grid) {
    canvas.width  = gw;
    canvas.height = gh;
    canvas.style.width  = '';
    canvas.style.height = '';

    const imgData = ctx.createImageData(gw, gh);
    const data    = imgData.data;
    for (let i = 0; i < gw * gh; i++) {
      const p = PALETTE[grid[i]];
      const j = i * 4;
      data[j]     = p.r;
      data[j + 1] = p.g;
      data[j + 2] = p.b;
      data[j + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /* ── Stats ── */
  function renderStats(gw, gh, counts, total) {
    totalBeadsEl.textContent  = total.toLocaleString('zh-CN');
    totalColorsEl.textContent = counts.size;
    gridDimsEl.textContent    = `${gw} × ${gh}`;
    chipColors.textContent    = counts.size;
  }

  /* ── Detail scores ── */
  function renderScores(gw, gh, counts, total) {
    // Edge retention vs reference resolution
    const curEdge = edgeDensity(loadedImg, gw, gh);
    const edgeRetention = refEdge > 0 ? Math.min(100, Math.round(curEdge/refEdge*100)) : 100;

    // Recognition: blended of edge retention + resolution adequacy
    const recog = Math.min(100, Math.round(edgeRetention * .7 + Math.min(30, gw/4)));

    // Color richness: how many palette colors actually used (more is richer)
    const colorRich = Math.min(100, Math.round(counts.size / 20 * 100));

    setScore('recog', recog);
    setScore('edge',  edgeRetention);
    setScore('color', colorRich);

    document.getElementById('hint-recog').textContent = recog>=85?'细节表现优秀':recog>=65?'可识别，细节有损失':'建议提高清晰度';
    document.getElementById('hint-edge').textContent  = edgeRetention>=80?'轮廓保留良好':edgeRetention>=55?'部分边缘模糊':'轮廓丢失明显';
    document.getElementById('hint-color').textContent = colorRich>=70?'色彩层次丰富':colorRich>=40?'色彩适中':'画面较为简洁';

    // Upgrade suggestion
    if (edgeRetention < 65 && recGridSize > parseInt(gridSlider.value,10)) {
      const loss = 100-edgeRetention;
      upgradeHint.textContent = `⚠️ 当前清晰度丢失约 ${loss}% 的边缘细节，升至「高清 64×64」或以上效果明显更好。`;
      upgradeHint.classList.add('visible');
    } else {
      upgradeHint.classList.remove('visible');
    }
  }

  function setScore(key, val) {
    const el = document.getElementById('score-'+key);
    const bar= document.getElementById('bar-'+key);
    el.textContent = val+'%';
    bar.style.width = val+'%';
    bar.className = 'score-bar-fill ' + (val>=75?'green':val>=50?'orange':'red');
  }

  /* ── Color table ── */
  function renderTable(counts, total) {
    const sorted = [...counts.entries()].sort((a,b)=>b[1]-a[1]);
    const maxC = sorted[0][1];
    tableBody.innerHTML = '';
    sorted.forEach(([idx, count]) => {
      const p=PALETTE[idx], pct=(count/total*100).toFixed(1);
      const bw=Math.round(count/maxC*100);
      const tr=document.createElement('tr');
      tr.innerHTML =
        `<td><span class="swatch" style="background:${p.hex}"></span></td>`+
        `<td class="code">${p.code}</td>`+
        `<td>${p.name}</td>`+
        `<td class="num right">${count.toLocaleString('zh-CN')}</td>`+
        `<td class="pct right">${pct}%</td>`+
        `<td class="bar-cell"><div class="pct-bar"><div class="pct-bar-fill" style="width:${bw}%"></div></div></td>`;
      tableBody.appendChild(tr);
    });
  }

  /* ── Downloads ── */
  dlBtn.addEventListener('click', () => {
    const a=document.createElement('a'); a.download='perler-pattern.png';
    a.href=canvas.toDataURL('image/png'); a.click();
  });
  dlCsvBtn.addEventListener('click', () => {
    if (!resultData) return;
    const {counts,total}=resultData;
    const rows=[['色号','颜色名','HEX','颗数','占比%']];
    [...counts.entries()].sort((a,b)=>b[1]-a[1]).forEach(([idx,count])=>{
      const p=PALETTE[idx];
      rows.push([p.code,p.name,p.hex,count,(count/total*100).toFixed(2)]);
    });
    rows.push(['合计','','',total,'100.00']);
    const csv=rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\r\n');
    const a=document.createElement('a'); a.download='perler-colors.csv';
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent('﻿'+csv); a.click();
  });

  /* ── Init slider marks ── */
  sliderMarks.forEach(m => {
    if (parseInt(m.dataset.val,10)===parseInt(gridSlider.value,10)) m.classList.add('active');
  });
})();
