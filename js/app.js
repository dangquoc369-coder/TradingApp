/**
 * app.js
 * Entry point - khởi động app và điều phối luồng dữ liệu giữa các module.
 *
 * Khởi tạo ĐỦ 4 PANE ngay từ đầu (dù layout đang là 1 hay 2 ô, 4 pane vẫn
 * tồn tại và chạy nền). Mỗi pane có:
 *   - 1 ChartModule instance riêng (kèm BreakoutModule + DrawingModule riêng)
 *   - 1 cặp socket riêng (qua websocket.js, khoá theo paneId)
 *   - lắng nghe 'pane:symbolChanged' / 'pane:timeframeChanged' CHỈ của paneId
 *     của chính nó để reload đúng lúc.
 *
 * `window.PaneRegistry` được export ra để marketstatus.js (và các module
 * ngoài khác nếu cần) tra được instance theo paneId mà không cần biết chi
 * tiết cách app.js quản lý nó.
 *
 * CẬP NHẬT (đợt fix này):
 * - FIX layout 4 ô: onLayoutChanged() giờ "poll" resize() qua vài khung hình
 *   (requestAnimationFrame) cho tới khi container thật sự có kích thước > 0
 *   mới dừng, thay vì chỉ gọi cố định 2 lần rồi thôi - tránh trường hợp
 *   trình duyệt/thiết bị chậm chưa kịp reflow xong CSS grid.
 * - Số nến tải về tăng từ 500 lên 1000 (KLINES_LIMIT).
 */

(async function App() {
  const KLINES_LIMIT = 1000; // trước đây là 500

  const paneInstances = {}; // paneId -> ChartModule instance

  window.PaneRegistry = {
    get(paneId) {
      return paneInstances[paneId];
    },
  };

  try {
    await init();
  } catch (err) {
    console.error('Lỗi khởi động app:', err);
  }

  async function init() {
    UI.init();

    const state = Store.getState();

    // Khởi tạo TỪNG pane: chart, load data REST, mở socket - độc lập nhau.
    for (const pane of state.panes) {
      await setupPane(pane.id);
    }

    // Mỗi pane tự lắng nghe thay đổi CỦA CHÍNH NÓ (lọc theo paneId trong payload).
    EventBus.on('pane:symbolChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('pane:timeframeChanged', onPaneSymbolOrTimeframeChanged);

    // FIX bug "4 ô không hoạt động": xem giải thích ở onLayoutChanged() bên dưới.
    EventBus.on('layout:changed', onLayoutChanged);
  }

  /**
   * Resize các pane vừa hiển thị sau khi đổi layout. "Poll" qua nhiều khung
   * hình thay vì cố định 2 khung: một số thiết bị (đặc biệt màn hình yếu,
   * điện thoại) cần nhiều hơn 2 animation frame để trình duyệt áp CSS grid
   * xong và trả về clientWidth/clientHeight > 0. Dừng sớm ngay khi mọi pane
   * đã có kích thước hợp lệ, tối đa 10 lần thử để tránh loop vô hạn.
   */
  function onLayoutChanged({ visiblePaneIds }) {
    let attempts = 0;

    function tryResize() {
      attempts++;
      let allReady = true;

      visiblePaneIds.forEach((paneId) => {
        const instance = paneInstances[paneId];
        if (!instance) return;
        instance.resize();

        const container = document.getElementById(`${paneId}-container`);
        if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
          allReady = false;
        }
      });

      if (!allReady && attempts < 10) {
        requestAnimationFrame(tryResize);
      }
    }

    requestAnimationFrame(() => requestAnimationFrame(tryResize));
  }

  /** Khởi tạo lần đầu cho 1 pane: tạo chart, load nến REST, mở socket, lấy giá ban đầu. */
  async function setupPane(paneId) {
    const container = document.getElementById(`${paneId}-container`);
    if (!container) {
      console.error(`Không tìm thấy container cho ${paneId}`);
      return;
    }

    const instance = ChartModule.create(paneId);
    instance.initChart(container);
    paneInstances[paneId] = instance;
    IndicatorLegend.render(paneId, instance);

    const pane = Store.getPane(paneId);
    await loadPaneData(paneId, instance, pane.symbol, pane.timeframe);
    connectSockets(paneId, pane.symbol, pane.timeframe);
    await loadInitialPrice(paneId, pane.symbol);
  }

  /**
   * Gọi lại mỗi khi symbol hoặc timeframe của 1 pane cụ thể thay đổi:
   * đóng socket cũ của pane đó -> load lại dữ liệu REST -> vẽ lại chart đó -> mở socket mới.
   * KHÔNG đụng tới các pane khác.
   */
  async function onPaneSymbolOrTimeframeChanged({ paneId }) {
    const instance = paneInstances[paneId];
    const pane = Store.getPane(paneId);
    if (!instance || !pane) return;

    closePaneSockets(paneId);
    instance.clearData();

    try {
      await loadPaneData(paneId, instance, pane.symbol, pane.timeframe);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải dữ liệu:`, err);
    }

    connectSockets(paneId, pane.symbol, pane.timeframe);
    await loadInitialPrice(paneId, pane.symbol);
  }

  /** Tải dữ liệu nến từ REST API và đổ vào chart + Store cho ĐÚNG 1 pane. */
  async function loadPaneData(paneId, instance, symbol, timeframe) {
    const candles = await fetchKlines(symbol, timeframe, KLINES_LIMIT);
    Store.setPaneCandles(paneId, candles);
    instance.loadInitialData(candles);
  }

  /**
   * Lấy giá hiện tại ngay lập tức qua REST (trước khi WebSocket kịp gửi tick đầu tiên)
   * cho ĐÚNG 1 pane, tránh hiển thị "--" vài giây lúc mới load / mới đổi symbol.
   */
  async function loadInitialPrice(paneId, symbol) {
    try {
      const { lastPrice, changePercent } = await fetch24hTicker(symbol);
      // Store.setPaneLastPrice() tự emit 'pane:priceChanged' - không emit tay ở đây
      // nữa để tránh bắn trùng sự kiện (trước đây có bug gọi cả 2).
      Store.setPaneLastPrice(paneId, lastPrice, changePercent);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải giá ban đầu:`, err);
    }
  }
})();
