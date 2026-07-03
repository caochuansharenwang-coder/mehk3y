(function () {
  'use strict';

  const siteCount = document.getElementById('siteCount');
  const siteCloud = document.getElementById('siteCloud');
  const csvPreview = document.getElementById('csvPreview');

  function csvRows(text, maxRows) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell);
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = '';
        if (rows.length >= maxRows) break;
      } else {
        cell += char;
      }
    }

    return rows;
  }

  function renderCsv(rows) {
    if (!rows.length) return;
    const headers = rows[0].slice(0, 8);
    const bodyRows = rows.slice(1, 7);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    bodyRows.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach((_, index) => {
        const td = document.createElement('td');
        td.textContent = row[index] || '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    csvPreview.replaceChildren(thead, tbody);
  }

  async function loadSites() {
    const response = await fetch('/data/aliens-eye/sites.json', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`sites.json ${response.status}`);
    const sites = await response.json();
    const names = Object.keys(sites).sort();
    siteCount.textContent = names.length.toLocaleString();

    siteCloud.replaceChildren(...names.slice(0, 24).map(name => {
      const pill = document.createElement('span');
      pill.className = 'site-pill';
      pill.textContent = name;
      return pill;
    }));
  }

  async function loadCsv() {
    const response = await fetch('/data/aliens-eye/fresh_dataset.csv', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`fresh_dataset.csv ${response.status}`);
    renderCsv(csvRows(await response.text(), 8));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const value = button.dataset.copy;
    navigator.clipboard.writeText(value).then(() => {
      button.textContent = '已复制';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = '复制';
        button.classList.remove('copied');
      }, 1200);
    }).catch(() => {
      button.textContent = '复制失败';
    });
  });

  Promise.allSettled([loadSites(), loadCsv()]).then(results => {
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      siteCount.textContent = '--';
      console.error(failed.reason);
    }
  });
}());
