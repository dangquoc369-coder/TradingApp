/**
 * ui.js
 * Render sidebar (danh sách symbol + tìm kiếm) - DÙNG CHUNG cho cả 4 pane,
 * nhưng khi chọn 1 symbol thì áp dụng cho PANE ĐANG FOCUS (activePaneId).
 */

const UI = (function () {
  let searchDebounceTimer = null;

  function init() {
    renderPopularSymbols();
    renderAllPaneTimeframeButtons();
    renderLayoutButtons();
    bindSymbolSearch();
    bindPaneFocusClicks();
    bindPaneHeaderTexts();
    bindPriceUpdates();
    bindConnectionStatus();
    bindPaneFocusedEvent();
    bindLayoutChangedEvent();
    applyLayout(Store.getState().layout);
    highlightActivePaneBorder(Store.getState().activePaneId);
  }

  function renderPopularSymbols() {
    const state = Store.getState();
    const activeSymbol = Store.getActivePane().symbol;
    const listEl = document.getElementById('symbolList');
    listEl.innerHTML = '';

    state.popularSymbols.forEach((symbol) => {
      const li = document.createElement('li');
      li.dataset.symbol = symbol;
      li.className = symbol === activeSymbol ? 'active' : '';
      li.innerHTML = `
        <span class="sym-name">${symbol}</span>
        <span class="sym-price" data-symbol-price="${symbol}">--</span>
      `;
      li.addEventListener('click', () => selectSymbol(symbol));
      listEl.appendChild(li);
    });
  }

  function selectSymbol(symbol) {
    document.getElementById('symbolSearchResults').classList.add('hidden');
    document.getElementById('symbolSearchInput').value = '';
    const paneId = Store.getState().activePaneId;
    Store.setPaneSymbol(paneId, symbol);
  }

  function bindSymbolSearch() {
    const input = document.getElementById('symbolSearchInput');
    const resultsEl = document.getElementById('symbolSearchResults');

    input.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      const query = input.value.trim().toUpperCase();

      if (!query) {
        resultsEl.classList.add('hidden');
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        const matches = await searchSymbols(query);
        renderSearchResults(matches, resultsEl);
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.symbol-search')) {
        resultsEl.classList.add('hidden');
      }
    });
  }

  async function searchSymbols(query) {
    const state = Store.getState();
    if (state.allSymbols.length === 0) {
      try {
        const all = await fetchAllSymbols();
        Store.setAllSymbols(all);
      } catch (err) {
        console.error('Không tải được danh sách symbol:', err);
        return [];
      }
    }
    return Store.getState()
      .allSymbols.filter((s) => s.includes(query))
      .slice(0, 20);
  }

  function renderSearchResults(matches, resultsEl) {
    if (matches.length === 0) {
      resultsEl.innerHTML = '<div class="symbol-search-item">Không tìm thấy</div>';
    } else {
      resultsEl.innerHTML = matches
        .map((s) => `<div class="symbol-search-item" data-symbol="${s}">${s}</div>`)
        .join('');
      resultsEl.querySelectorAll('.symbol-search-item[data-symbol]').forEach((el) => {
        el.addEventListener('click', () => selectSymbol(el.dataset.symbol));
      });
    }
    resultsEl.classList.remove('hidden');
  }

  function renderAllPaneTimeframeButtons() {
    Store.getState().panes.forEach((pane) => renderPaneTimeframeButtons(pane.id));
  }

  function renderPaneTimeframeButtons(paneId) {
    const pane = Store.getPane(paneId);
    const groupEl = document.getElementById(`${paneId}-timeframes`);
    if (!groupEl) return;
    groupEl.innerHTML = '';

    TIMEFRAMES.forEach((tf) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (tf.value === pane.timeframe ? ' active' : '');
      btn.textContent = tf.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Store.setActivePane(paneId);
        Store.setPaneTimeframe(paneId, tf.value);
      });
      groupEl.appendChild(btn);
    });
  }

  function highlightPaneTimeframe(paneId, value) {
    const groupEl = document.getElementById(`${paneId}-timeframes`);
    if (!groupEl) return;
    groupEl.querySelectorAll('.timeframe-btn').forEach((btn, i) => {
      btn.classList.toggle('active', TIMEFRAMES[i].value === value);
    });
  }

  function renderLayoutButtons() {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.innerHTML = '';

    [1, 2, 4].forEach((n) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (n === Store.getState().layout ? ' active' : '');
      btn.dataset.layout = n;
      btn.textContent = n === 1 ? '1 ô' : n === 2 ? '2 ô' : '4 ô';
      btn.addEventListener('click', () => Store.setLayout(n));
      groupEl.appendChild(btn);
    });
  }

  function highlightActiveLayoutButton(layout) {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.layout) === layout);
    });
  }

  function applyLayout(layout) {
    const chartArea = document.getElementById('chartArea');
    chartArea.className = 'layout-' + layout;
    const visible = Store.getVisiblePaneIds();
    Store.getState().panes.forEach((pane) => {
      const el = document.getElementById(pane.id);
      if (el) el.classList.toggle('hidden', !visible.includes(pane.id));
    });
    highlightActiveLayoutButton(layout);
  }

  function bindLayoutChangedEvent() {
    EventBus.on('layout:changed', ({ layout }) => applyLayout(layout));
  }

  function bindPaneFocusClicks() {
    Store.getState().panes.forEach((pane) => {
      const el = document.getElementById(pane.id);
      if (!el) return;
      el.addEventListener('click', () => Store.setActivePane(pane.id));
    });
  }

  function highlightActivePaneBorder(activePaneId) {
    Store.getState().panes.forEach((pane) => {
      const el = document.getElementById(pane.id);
      if (el) el.classList.toggle('pane-focused', pane.id === activePaneId);
    });
  }

  function bindPaneFocusedEvent() {
    EventBus.on('pane:focused', ({ paneId }) => {
      highlightActivePaneBorder(paneId);
      renderPopularSymbols();
    });
  }

  function bindPaneHeaderTexts() {
    Store.getState().panes.forEach((pane) => updatePaneSymbolText(pane.id, pane.symbol));

    EventBus.on('pane:symbolChanged', ({ paneId, symbol }) => {
      updatePaneSymbolText(paneId, symbol);
      if (paneId === Store.getState().activePaneId) renderPopularSymbols();
    });

    EventBus.on('pane:timeframeChanged', ({ paneId, timeframe }) => {
      highlightPaneTimeframe(paneId, timeframe);
    });
  }

  function updatePaneSymbolText(paneId, symbol) {
    const el = document.getElementById(`${paneId}-symbol`);
    if (el) el.textContent = symbol;
  }

  function bindPriceUpdates() {
    EventBus.on('pane:priceChanged', ({ paneId, price, changePercent }) => {
      updatePanePriceUI(paneId, price, changePercent);
    });
  }

  function updatePanePriceUI(paneId, price, changePercent) {
    const pane = Store.getPane(paneId);
    if (!pane) return;

    const priceEl = document.getElementById(`${paneId}-price`);
    const changeEl = document.getElementById(`${paneId}-change`);
    if (priceEl) priceEl.textContent = formatPrice(price);

    if (changeEl && changePercent !== undefined && changePercent !== null) {
      changeEl.textContent = formatPercent(changePercent);
      changeEl.className = 'change ' + (changePercent >= 0 ? 'up' : 'down');
    }

    const sidebarPriceEl = document.querySelector(`[data-symbol-price="${pane.symbol}"]`);
    if (sidebarPriceEl) {
      sidebarPriceEl.textContent = formatPrice(price);
      sidebarPriceEl.className = 'sym-price ' + (changePercent >= 0 ? 'up' : changePercent < 0 ? 'down' : '');
    }
  }

  function bindConnectionStatus() {
    EventBus.on('ws:status', ({ paneId, status }) => {
      const el = document.getElementById(`${paneId}-status`);
      if (!el) return;
      el.className = 'connection-status ' + status;
      el.textContent =
        status === 'connected' ? 'Đã kết nối' : status === 'disconnected' ? 'Mất kết nối...' : 'Đang kết nối...';
    });
  }

  return { init };
})();
