/**
 * storage.js
 * State trung tâm (single source of truth) cho toàn bộ app.
 *
 * `state.panes` - mảng tối đa 4 pane, MỖI pane có symbol/timeframe/candles
 * ĐỘC LẬP hoàn toàn với nhau. Pane id CỐ ĐỊNH là 'pane-1'..'pane-4' (khớp với
 * 4 container cố định trong index.html). Việc "đổi layout 1/2/3/4" KHÔNG
 * tạo/hủy pane mà chỉ đổi vị trí trong CSS Grid (xem layout.js) - pane bị ẩn
 * vẫn chạy nền (giữ nguyên socket + dữ liệu) để MỌI pane luôn cập nhật giá
 * realtime, bất kể đang hiển thị hay không.
 *
 * CẬP NHẬT (đợt fix này):
 * - layout giờ là chuỗi '1' | '2' | '3' | '4' thay vì số cố định 1/2/4.
 * - Thêm `orientation` ('portrait' | 'landscape') do layout.js tự phát hiện:
 *   dọc tối đa 3 ô, ngang tối đa 4 ô.
 * - Thêm `layoutRatios`: lưu tỉ lệ chia ô mà người dùng tự kéo giãn, theo
 *   từng cặp (layout, orientation) riêng biệt, để khi đổi qua lại không mất
 *   tỉ lệ đã chỉnh.
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

  // Danh sách pane hiển thị theo từng layout id.
  const LAYOUT_PANES = {
    '1': (activeId) => [activeId],
    '2': () => ['pane-1', 'pane-2'],
    '3': () => ['pane-1', 'pane-2', 'pane-3'],
    '4': () => ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
  };

  const state = {
    panes: DEFAULT_PANE_CONFIG.map(makePane),
    activePaneId: 'pane-1',
    layout: '1',
    orientation: 'landscape',
    // key: `${layout}-${orientation}` -> object tỉ lệ (0..1), xem layout.js
    layoutRatios: {},
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
    const fn = LAYOUT_PANES[state.layout] || LAYOUT_PANES['1'];
    return fn(state.activePaneId);
  }

  /** Số ô tối đa cho phép theo hướng màn hình: dọc tối đa 3, ngang tối đa 4. */
  function maxPanesForOrientation(orientation) {
    return orientation === 'portrait' ? 3 : 4;
  }

  function setActivePane(paneId) {
    if (!getPane(paneId) || state.activePaneId === paneId) return;
    state.activePaneId = paneId;
    EventBus.emit('pane:focused', { paneId });
    // Layout '1' chỉ hiện đúng 1 pane - đổi pane active nghĩa là đổi luôn pane
    // đang hiển thị, nên cần bắn thêm layout:changed để layout.js vẽ lại.
    if (state.layout === '1') {
      EventBus.emit('layout:changed', {
        layout: state.layout,
        visiblePaneIds: getVisiblePaneIds(),
        orientation: state.orientation,
      });
    }
  }

  function setLayout(layout) {
    layout = String(layout);
    if (!LAYOUT_PANES[layout]) return;
    const max = maxPanesForOrientation(state.orientation);
    if (Number(layout) > max) layout = String(max);
    if (state.layout === layout) return;
    state.layout = layout;
    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
      EventBus.emit('pane:focused', { paneId: state.activePaneId });
      visible = getVisiblePaneIds();
    }
    EventBus.emit('layout:changed', { layout, visiblePaneIds: visible, orientation: state.orientation });
  }

  /**
   * Gọi khi layout.js phát hiện đổi hướng màn hình (dọc <-> ngang).
   * Nếu layout hiện tại vượt quá số ô cho phép ở hướng mới thì tự hạ xuống.
   * Luôn bắn 'layout:changed' vì cùng 1 layout id có thể có cấu trúc lưới
   * khác nhau giữa dọc và ngang (ví dụ layout '2': ngang xếp cạnh nhau, dọc
   * xếp chồng lên nhau).
   */
  function setOrientation(orientation) {
    if (state.orientation === orientation) return;
    state.orientation = orientation;

    const max = maxPanesForOrientation(orientation);
    if (Number(state.layout) > max) {
      state.layout = String(max);
    }

    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
    }

    EventBus.emit('orientation:changed', { orientation });
    EventBus.emit('layout:changed', {
      layout: state.layout,
      visiblePaneIds: getVisiblePaneIds(),
      orientation: state.orientation,
    });
  }

  function getLayoutRatioKey(layout, orientation) {
    return `${layout}-${orientation}`;
  }

  function getLayoutRatios(layout, orientation) {
    return state.layoutRatios[getLayoutRatioKey(layout, orientation)] || null;
  }

  function setLayoutRatios(layout, orientation, ratios) {
    state.layoutRatios[getLayoutRatioKey(layout, orientation)] = ratios;
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
    maxPanesForOrientation,
    setActivePane,
    setLayout,
    setOrientation,
    getLayoutRatios,
    setLayoutRatios,
    setPaneSymbol,
    setPaneTimeframe,
    setPaneCandles,
    upsertPaneCandle,
    setPaneLastPrice,
    setAllSymbols,
  };
})();