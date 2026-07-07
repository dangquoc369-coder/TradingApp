/**
 * storage.js
 * State trung tâm (single source of truth) cho toàn bộ app.
 *
 * `state.panes` - mảng tối đa 4 pane, MỖI pane có symbol/timeframe/candles
 * ĐỘC LẬP hoàn toàn với nhau. Pane id CỐ ĐỊNH là 'pane-1'..'pane-4' (khớp với
 * 4 container cố định trong index.html). Việc "đổi layout 1/2/4" KHÔNG
 * tạo/hủy pane mà chỉ ẩn/hiện bằng CSS - pane bị ẩn vẫn chạy nền (giữ nguyên
 * socket + dữ liệu) để khi hiện lại không phải load lại từ đầu.
 */

const Store = (function () {
  const DEFAULT_PANE_CONFIG = [
    { id: 'pane-1', symbol: 'BTCUSDT', timeframe: '15m' },
    { id: 'pane-2', symbol: 'ETHUSDT', timeframe: '1h' },
    { id: 'pane-3', symbol: 'BNBUSDT', timeframe: '4h' },
    { id: 'pane-4', symbol: 'SOLUSDT', timeframe: '1d' },
  ];

  function makePane(cfg) {
    return {
      id: cfg.id,
      symbol: cfg.symbol,
      timeframe: cfg.timeframe,
      candles: [],
      lastPrice: null,
      priceChangePercent: null,
    };
  }

  const state = {
    panes: DEFAULT_PANE_CONFIG.map(makePane),
    activePaneId: 'pane-1',
    layout: 1,
    popularSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
    allSymbols: [],
  };

  function getState() {
    return state;
  }

  function getPane(paneId) {
    return state.panes.find((p) => p.id === paneId) || null;
  }

  function getActivePane() {
    return getPane(state.activePaneId);
  }

  function getVisiblePaneIds() {
    if (state.layout === 1) return [state.activePaneId];
    if (state.layout === 2) return ['pane-1', 'pane-2'];
    return state.panes.map((p) => p.id);
  }

  function setActivePane(paneId) {
    if (!getPane(paneId) || state.activePaneId === paneId) return;
    state.activePaneId = paneId;
    EventBus.emit('pane:focused', { paneId });
  }

  function setLayout(layout) {
    if (![1, 2, 4].includes(layout) || state.layout === layout) return;
    state.layout = layout;
    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
      EventBus.emit('pane:focused', { paneId: state.activePaneId });
      visible = getVisiblePaneIds();
    }
    EventBus.emit('layout:changed', { layout, visiblePaneIds: visible });
  }

  function setPaneSymbol(paneId, symbol) {
    const pane = getPane(paneId);
    if (!pane || pane.symbol === symbol) return;
    pane.symbol = symbol;
    pane.candles = [];
    pane.lastPrice = null;
    pane.priceChangePercent = null;
    EventBus.emit('pane:symbolChanged', { paneId, symbol });
  }

  function setPaneTimeframe(paneId, timeframe) {
    const pane = getPane(paneId);
    if (!pane || pane.timeframe === timeframe) return;
    pane.timeframe = timeframe;
    pane.candles = [];
    EventBus.emit('pane:timeframeChanged', { paneId, timeframe });
  }

  function setPaneCandles(paneId, candles) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.candles = candles;
    EventBus.emit('pane:candlesLoaded', { paneId, candles });
  }

  function upsertPaneCandle(paneId, candle) {
    const pane = getPane(paneId);
    if (!pane) return;
    const candles = pane.candles;
    const last = candles[candles.length - 1];
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      candles.push(candle);
    }
  }

  function setPaneLastPrice(paneId, price, changePercent) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.lastPrice = price;
    if (changePercent !== undefined) pane.priceChangePercent = changePercent;
    EventBus.emit('pane:priceChanged', { paneId, price, changePercent: pane.priceChangePercent });
  }

  function setAllSymbols(list) {
    state.allSymbols = list;
  }

  return {
    getState,
    getPane,
    getActivePane,
    getVisiblePaneIds,
    setActivePane,
    setLayout,
    setPaneSymbol,
    setPaneTimeframe,
    setPaneCandles,
    upsertPaneCandle,
    setPaneLastPrice,
    setAllSymbols,
  };
})();
