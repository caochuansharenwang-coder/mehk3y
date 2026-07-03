(function () {
  const STORAGE_KEY = 'ggKeeperHistory';
  const button = document.getElementById('consumeButton');
  const status = document.getElementById('status');
  const historyList = document.getElementById('historyList');

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function formatDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function renderHistory() {
    const history = readHistory().slice(-5).reverse();

    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-item"><span>暂无记录</span><span class="history-size">--</span></div>';
      return;
    }

    historyList.replaceChildren(...history.map((item) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const date = document.createElement('span');
      date.textContent = item.date || '未知时间';

      const size = document.createElement('span');
      size.className = 'history-size';
      size.textContent = `${item.size || '--'} KB`;

      row.append(date, size);
      return row;
    }));
  }

  function saveHistory(size) {
    const history = readHistory();
    history.push({
      date: formatDate(new Date()),
      size,
      timestamp: Date.now()
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-20)));
    renderHistory();
  }

  function setStatus(type, title, detail) {
    status.className = `status ${type || ''}`.trim();
    status.replaceChildren();

    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    status.appendChild(titleNode);

    if (detail) {
      const detailNode = document.createElement('span');
      detailNode.textContent = detail;
      status.appendChild(detailNode);
    }
  }

  async function consumeData() {
    const startedAt = performance.now();
    const payloadUrl = `/gg-keeper/payload.txt?t=${Date.now()}&r=${Math.random().toString(36).slice(2)}`;

    button.disabled = true;
    setStatus('loading', '正在连接服务器', '请保持移动数据连接，不要切回 Wi-Fi。');

    try {
      const response = await fetch(payloadUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`请求失败：HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const sizeInKB = (blob.size / 1024).toFixed(2);
      const duration = ((performance.now() - startedAt) / 1000).toFixed(2);

      setStatus('success', '保号请求完成', `已下载 ${sizeInKB} KB，用时 ${duration} 秒。`);
      saveHistory(sizeInKB);
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>再次保号';
    } catch (error) {
      setStatus('error', '操作失败', error instanceof Error ? error.message : '网络请求没有完成。');
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', consumeData);
  renderHistory();
}());
