/**
 * app.js
 * Entry point - khởi động app và điều phối luồng dữ liệu giữa các module.
 * Đây là nơi DUY NHẤT quyết định "khi nào" gọi API / mở socket / vẽ lại chart.
 * Luôn load SAU CÙNG vì phụ thuộc toàn bộ module khác.
 */

(async function App() {
  try {
    await init();
  } catch (err) {
    // Quan trọng: nếu không catch, lỗi trong init() sẽ là unhandled rejection
    // và toàn bộ app đứng im (VD: kẹt ở "Đang kết nối...") mà không rõ lý do.
    console.error('Lỗi khởi động app:', err);
  }

  async function init() {
    // 1. Khởi tạo chart
    const container = document.getElementById('chartContainer');
    ChartModule.initChart(container);

    // 2. Render UI (sidebar, toolbar...)
    UI.init();

    // 3. Lắng nghe khi người dùng đổi symbol/timeframe (Store sẽ emit các event này)
    EventBus.on('symbol:changed', onSymbolOrTimeframeChanged);
    EventBus.on('timeframe:changed', onSymbolOrTimeframeChanged);

    // 4. Load dữ liệu ban đầu + mở socket cho symbol/timeframe mặc định
    const state = Store.getState();
    await loadSymbolData(state.symbol, state.timeframe);
    connectSockets(state.symbol, state.timeframe);
    await loadInitialPrice(state.symbol);
  }

  /**
   * Gọi lại mỗi khi symbol hoặc timeframe thay đổi:
   * đóng socket cũ -> load lại dữ liệu REST -> vẽ lại chart -> mở socket mới.
   */
  async function onSymbolOrTimeframeChanged() {
    const state = Store.getState();

    closeAllSockets();
    ChartModule.clearData();

    try {
      await loadSymbolData(state.symbol, state.timeframe);
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu:', err);
    }

    connectSockets(state.symbol, state.timeframe);
    await loadInitialPrice(state.symbol);
  }

  /**
   * Tải dữ liệu nến từ REST API và đổ vào chart + Store.
   */
  async function loadSymbolData(symbol, timeframe) {
    const candles = await fetchKlines(symbol, timeframe, 500);
    Store.setCandles(candles);
    ChartModule.loadInitialData(candles);
  }

  /**
   * Lấy giá hiện tại ngay lập tức qua REST (trước khi WebSocket kịp gửi tick đầu tiên),
   * tránh hiển thị "--" vài giây lúc mới load / mới đổi symbol.
   */
  async function loadInitialPrice(symbol) {
    try {
      const { lastPrice, changePercent } = await fetch24hTicker(symbol);
      EventBus.emit('price:update', { price: lastPrice, changePercent });
    } catch (err) {
      console.error('Lỗi khi tải giá ban đầu:', err);
    }
  }
})();