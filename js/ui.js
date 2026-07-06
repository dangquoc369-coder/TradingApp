/**
 * ui.js
 * Render sidebar (danh sách symbol + tìm kiếm), toolbar timeframe,
 * hiển thị giá/live price, và phát ra sự kiện khi người dùng tương tác.
 *
 * ui.js KHÔNG tự gọi API hay WebSocket - nó chỉ đổi Store, còn việc
 * reload dữ liệu + reconnect socket do app.js điều phối (lắng nghe
 * 'symbol:changed' / 'timeframe:changed' từ Store).
 */

const UI = (function () {
  let searchDebounceTimer = null;

  function init() {
    renderPopularSymbols();
    renderTimeframeButtons();
    bindSymbolSearch();
    bindPriceUpdates();
    bindConnectionStatus();
  }

  /* ===================== SYMBOL LIST ===================== */

  function renderPopularSymbols() {
    const state = Store.getState();
    const listEl = document.getElementById('symbolList');
    listEl.innerHTML = '';

    state.popularSymbols.forEach((symbol) => {
      const li = document.createElement('li');
      li.dataset.symbol = symbol;
      li.className = symbol === state.symbol ? 'active' : '';
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
    Store.setSymbol(symbol);
    highlightActiveSymbol(symbol);
  }

  function highlightActiveSymbol(symbol) {
    document.querySelectorAll('#symbolList li').forEach((li) => {
      li.classList.toggle('active', li.dataset.symbol === symbol);
    });
    document.getElementById('currentSymbol').textContent = symbol;
  }

  /* ===================== SYMBOL SEARCH ===================== */

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

    // Ẩn kết quả khi click ra ngoài
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

  /* ===================== TIMEFRAME ===================== */

  function renderTimeframeButtons() {
    const state = Store.getState();
    const groupEl = document.getElementById('timeframeGroup');
    groupEl.innerHTML = '';

    TIMEFRAMES.forEach((tf) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (tf.value === state.timeframe ? ' active' : '');
      btn.textContent = tf.label;
      btn.addEventListener('click', () => {
        Store.setTimeframe(tf.value);
        highlightActiveTimeframe(tf.value);
      });
      groupEl.appendChild(btn);
    });
  }

  function highlightActiveTimeframe(value) {
    document.querySelectorAll('.timeframe-btn').forEach((btn, i) => {
      btn.classList.toggle('active', TIMEFRAMES[i].value === value);
    });
  }

  /* ===================== PRICE DISPLAY ===================== */

  function bindPriceUpdates() {
    EventBus.on('price:update', ({ price, changePercent }) => {
      Store.setLastPrice(price, changePercent);
      updatePriceUI(price, changePercent);
    });
  }

  function updatePriceUI(price, changePercent) {
    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('currentChange');
    const state = Store.getState();

    priceEl.textContent = formatPrice(price);

    if (changePercent !== undefined && changePercent !== null) {
      changeEl.textContent = formatPercent(changePercent);
      changeEl.className = 'change ' + (changePercent >= 0 ? 'up' : 'down');
    }

    // Cập nhật luôn giá trong sidebar nếu symbol đang hiển thị trùng
    const sidebarPriceEl = document.querySelector(`[data-symbol-price="${state.symbol}"]`);
    if (sidebarPriceEl) {
      sidebarPriceEl.textContent = formatPrice(price);
      sidebarPriceEl.className =
        'sym-price ' + (changePercent >= 0 ? 'up' : changePercent < 0 ? 'down' : '');
    }
  }

  /* ===================== CONNECTION STATUS ===================== */

  function bindConnectionStatus() {
    EventBus.on('ws:status', (status) => {
      const el = document.getElementById('connectionStatus');
      el.className = 'connection-status ' + status;
      el.textContent =
        status === 'connected'
          ? 'Đã kết nối realtime'
          : status === 'disconnected'
          ? 'Mất kết nối - đang thử lại...'
          : 'Đang kết nối...';
    });
  }

  return { init, highlightActiveSymbol, highlightActiveTimeframe };
})();
