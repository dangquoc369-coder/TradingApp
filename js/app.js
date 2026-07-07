/**
 * app.js
 * Entry point - khởi động app và điều phối luồng dữ liệu giữa các module.
 *
 * Khởi tạo ĐỦ 4 PANE ngay từ đầu (dù layout đang là '1'/'2'/'3'/'4', 4 pane
 * vẫn tồn tại và chạy nền). Mỗi pane có:
 *   - 1 ChartModule instance riêng (kèm BreakoutModule + DrawingModule riêng)
 *   - 1 cặp socket riêng (qua websocket.js, khoá theo paneId)
 *   - lắng nghe 'pane:symbolChanged' / 'pane:timeframeChanged' CHỈ của paneId
 *     của chính nó để reload đúng lúc.
 * Vì socket của mỗi pane chạy độc lập với việc pane đó có đang được hiển thị
 * hay không, MỌI pane luôn cập nhật giá/nến real-time - không phải "đang
 * chọn ô nào thì ô đó mới chạy".
 *
 * `window.PaneRegistry` được export ra để marketstatus.js, ui.js (thanh công
 * cụ vẽ dùng chung) và các module khác tra được instance theo paneId mà
 * không cần biết chi tiết cách app.js quản lý nó.
 *
 * CẬP NHẬT (đợt fix này):
 * - Thêm CountdownModule.init() - đếm ngược đóng nến hiển thị dưới giá mỗi ô.
 * - Bố cục nhiều ô (resize, số ô tối đa theo hướng màn hình) do layout.js
 *   đảm nhiệm hoàn toàn; app.js không cần biết layout đang là gì.
 */

(async function App() {
  const KLINES_LIMIT = 1000;

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
    CountdownModule.init();

    const state = Store.getState();

    // Khởi tạo TỪNG pane: chart, load data REST, mở socket - độc lập nhau.
    for (const pane of state.panes) {
      await setupPane(pane.id);
    }

    // Mỗi pane tự lắng nghe thay đổi CỦA CHÍNH NÓ (lọc theo paneId trong payload).
    EventBus.on('pane:symbolChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('pane:timeframeChanged', onPaneSymbolOrTimeframeChanged);

    // Resize lại các pane vừa hiển thị sau khi đổi layout (đề phòng trình
    // duyệt/thiết bị chậm - splitter tự resize qua ResizeObserver rồi, đây
    // chỉ là lưới an toàn bổ sung).
    EventBus.on('layout:changed', onLayoutChanged);

    // Sau khi tất cả pane đã có instance thật, vẽ lại thanh công cụ vẽ dùng
    // chung để phản ánh đúng tool hiện tại của pane đang active.
    UI.renderSharedDrawGroup();
  }

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
      Store.setPaneLastPrice(paneId, lastPrice, changePercent);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải giá ban đầu:`, err);
    }
  }
})();