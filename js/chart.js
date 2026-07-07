/**
 * chart.js
 * Khởi tạo và điều khiển biểu đồ Lightweight Charts v5.x.
 *
 * CẬP NHẬT (đợt fix này):
 * 1) FIX layout 4 ô: trước đây khi pane-3/4 còn ẩn (display:none) lúc khởi
 *    tạo lần đầu, chart được tạo với width/height = clientWidth/clientHeight
 *    = 0. Một số bản build của lightweight-charts giữ nguyên trạng thái nội
 *    bộ (canvas 0x0, tỉ lệ pixel) dù sau đó gọi resize() với kích thước thật
 *    - khiến pane-3/4 trông "trống"/không tương tác được dù đã đo lại đúng.
 *    -> Sửa: initChart() không bao giờ tạo chart với width/height = 0 nữa,
 *    luôn có kích thước mặc định hợp lý (fallback) làm điểm khởi tạo, sau đó
 *    app.js vẫn resize() lại bằng kích thước thật khi pane thực sự hiển thị.
 * 2) Thêm setVolumeVisible()/getVolumeVisible() để bật/tắt volume theo pane.
 * 3) Tích hợp DrawingModule (vẽ đường ngang/trend line/hình chữ nhật) riêng
 *    cho từng pane, expose qua getDrawing().
 */

const ChartModule = (function () {
  function create(paneId) {
    let chart = null;
    let containerRef = null;
    let candleSeries = null;
    let volumeSeries = null;
    let resizeObserver = null;
    let volumeVisible = true;

    let ema21Series = null;
    let ema200Series = null;
    let rsiSeries = null;
    let emaRsiSeries = null;
    let wmaRsiSeries = null;

    // Giữ toàn bộ nến hiện tại để tính lại chỉ báo khi có tick mới
    let currentCandles = [];

    /**
     * Cấu hình từng indicator: label hiển thị trên legend, màu (khớp màu series),
     * chu kỳ hiện tại, và enabled (ẩn/hiện). Đây là "single source of truth" cho
     * indicator-legend.js đọc để vẽ chip + popover chỉnh chu kỳ.
     */
    const indicatorConfig = {
      ema21: { label: 'EMA', color: '#f5c518', period: 21, enabled: true },
      ema200: { label: 'EMA', color: '#ff5f5f', period: 200, enabled: true },
      rsi: { label: 'RSI', color: '#7e57c2', period: 14, enabled: true },
      emaRsi: { label: 'EMA(RSI)', color: '#26a69a', period: 9, enabled: true },
      wmaRsi: { label: 'WMA(RSI)', color: '#ef5350', period: 45, enabled: true },
    };

    // BreakoutModule instance riêng của pane này (xem breakout.js)
    const breakout = BreakoutModule.create(paneId);

    // DrawingModule instance riêng của pane này (xem drawing.js) - gán khi initChart
    let drawing = null;

    function handleKlineUpdate({ paneId: sourcePaneId, candle }) {
      if (sourcePaneId !== paneId) return; // không phải data của pane này -> bỏ qua
      Store.upsertPaneCandle(paneId, candle);

      candleSeries.update({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });

      volumeSeries.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      });

      const lastIndex = currentCandles.length - 1;
      if (lastIndex >= 0 && currentCandles[lastIndex].time === candle.time) {
        currentCandles[lastIndex] = candle;
      } else {
        currentCandles.push(candle);
      }
      renderIndicators(currentCandles);
      breakout.run(currentCandles);
    }

    /** Khởi tạo chart trong container truyền vào. Gọi 1 lần khi pane được mount. */
    function initChart(container) {
      containerRef = container;

      // FIX layout 4 ô: không bao giờ khởi tạo chart với kích thước 0x0, kể cả
      // khi pane này đang bị ẩn (display:none) lúc setup lần đầu. Dùng giá trị
      // mặc định hợp lý làm fallback; kích thước thật sẽ được app.js gọi lại
      // qua resize() ngay khi pane được hiển thị thật sự.
      const rect = container.getBoundingClientRect();
      const initialWidth = container.clientWidth || rect.width || 400;
      const initialHeight = container.clientHeight || rect.height || 300;

      chart = LightweightCharts.createChart(container, {
        autoSize: false,
        width: initialWidth,
        height: initialHeight,
        layout: {
          background: { type: 'solid', color: '#131722' },
          textColor: '#d1d4dc',
          panes: { separatorColor: '#2a2e39' },
        },
        grid: {
          vertLines: { color: '#1e222d' },
          horzLines: { color: '#1e222d' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#2a2e39' },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
      });

      candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
      candleSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.3 },
      });

      breakout.init(chart, candleSeries);

      volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      ema21Series = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#f5c518', lineWidth: 1, title: 'EMA 21', priceLineVisible: false, lastValueVisible: false },
        0
      );
      ema200Series = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#ff5f5f', lineWidth: 1, title: 'EMA 200', priceLineVisible: false, lastValueVisible: false },
        0
      );

      rsiSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#7e57c2', lineWidth: 1, title: 'RSI 14', priceLineVisible: false, lastValueVisible: false },
        1
      );
      emaRsiSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#26a69a', lineWidth: 1, title: 'EMA 9', priceLineVisible: false, lastValueVisible: false },
        1
      );
      wmaRsiSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#ef5350', lineWidth: 1, title: 'WMA 45', priceLineVisible: false, lastValueVisible: false },
        1
      );

      try {
        const panes = chart.panes();
        if (panes[1] && typeof panes[1].setStretchFactor === 'function') panes[1].setStretchFactor(0.3);
        if (panes[0] && typeof panes[0].setStretchFactor === 'function') panes[0].setStretchFactor(0.7);
      } catch (err) {
        console.warn(`[${paneId}] Không thể chỉnh tỉ lệ pane:`, err);
      }

      setupResize(container);

      EventBus.on('kline:update', handleKlineUpdate);

      // Công cụ vẽ cơ bản riêng cho pane này (đường ngang / trend line / rectangle)
      drawing = DrawingModule.create(paneId, chart, candleSeries, container);

      return chart;
    }

    function setupResize(container) {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) chart.resize(width, height);
      });
      resizeObserver.observe(container);
    }

    /**
     * Resize thủ công - BẮT BUỘC gọi hàm này ngay sau khi đổi layout (ẩn/hiện
     * pane bằng CSS), vì ResizeObserver không phải lúc nào cũng kịp bắn ra khi
     * 1 phần tử chuyển từ display:none sang hiển thị lần đầu tiên trên một số
     * trình duyệt/thiết bị - đây chính là lý do layout 4 ô trước đây không ổn
     * định (pane-3/pane-4 chưa từng được đo kích thước đúng lúc). app.js gọi
     * hàm này khi nhận event 'layout:changed' và có cơ chế thử lại (poll) vài
     * khung hình cho tới khi kích thước thật > 0 mới thôi (xem app.js).
     */
    function resize() {
      if (!chart || !containerRef) return;
      const { clientWidth, clientHeight } = containerRef;
      if (clientWidth > 0 && clientHeight > 0) {
        chart.resize(clientWidth, clientHeight);
      }
    }

    function renderIndicators(candles) {
      const closes = candles.map((c) => c.close);

      const ema21 = IndicatorModule.calcEMA(closes, indicatorConfig.ema21.period);
      const ema200 = IndicatorModule.calcEMA(closes, indicatorConfig.ema200.period);
      ema21Series.setData(IndicatorModule.toSeriesData(candles, ema21));
      ema200Series.setData(IndicatorModule.toSeriesData(candles, ema200));

      const rsi = IndicatorModule.calcRSI(candles, indicatorConfig.rsi.period);
      const emaOfRsi = IndicatorModule.calcEMA(rsi, indicatorConfig.emaRsi.period);
      const wmaOfRsi = IndicatorModule.calcWMA(rsi, indicatorConfig.wmaRsi.period);
      rsiSeries.setData(IndicatorModule.toSeriesData(candles, rsi));
      emaRsiSeries.setData(IndicatorModule.toSeriesData(candles, emaOfRsi));
      wmaRsiSeries.setData(IndicatorModule.toSeriesData(candles, wmaOfRsi));
    }

    // key -> series tương ứng, dùng để toggle visible / đọc lại khi cần
    function seriesForKey(key) {
      return { ema21: ema21Series, ema200: ema200Series, rsi: rsiSeries, emaRsi: emaRsiSeries, wmaRsi: wmaRsiSeries }[key];
    }

    /** Ẩn/hiện 1 indicator (không xóa dữ liệu, chỉ applyOptions visible - rẻ và tức thời). */
    function setIndicatorVisible(key, visible) {
      const cfg = indicatorConfig[key];
      const series = seriesForKey(key);
      if (!cfg || !series) return;
      cfg.enabled = visible;
      series.applyOptions({ visible });
    }

    /** Đổi chu kỳ 1 indicator rồi tính lại toàn bộ (đơn giản, đủ nhanh với 1000 nến). */
    function setIndicatorPeriod(key, period) {
      const cfg = indicatorConfig[key];
      if (!cfg || !period || period <= 0) return;
      cfg.period = period;
      renderIndicators(currentCandles);
    }

    /** Trả về bản sao cấu hình indicator hiện tại - cho indicator-legend.js đọc để vẽ UI. */
    function getIndicatorConfig() {
      return JSON.parse(JSON.stringify(indicatorConfig));
    }

    /** Bật/tắt hiển thị Volume (histogram) của riêng pane này. */
    function setVolumeVisible(visible) {
      volumeVisible = visible;
      if (volumeSeries) volumeSeries.applyOptions({ visible });
    }

    function getVolumeVisible() {
      return volumeVisible;
    }

    function loadInitialData(candles) {
      currentCandles = candles.slice();

      candleSeries.setData(
        candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      volumeSeries.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        }))
      );

      renderIndicators(currentCandles);
      breakout.run(currentCandles);
    }

    function clearData() {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      ema21Series.setData([]);
      ema200Series.setData([]);
      rsiSeries.setData([]);
      emaRsiSeries.setData([]);
      wmaRsiSeries.setData([]);
      currentCandles = [];
      breakout.run([]);
    }

    /** Dọn dẹp hoàn toàn instance - gọi nếu pane bị gỡ vĩnh viễn (hiện chưa dùng vì pane cố định, nhưng để sẵn cho tương lai). */
    function destroy() {
      EventBus.off('kline:update', handleKlineUpdate);
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) chart.remove();
      chart = null;
    }

    return {
      initChart,
      loadInitialData,
      clearData,
      destroy,
      resize,
      setIndicatorVisible,
      setIndicatorPeriod,
      getIndicatorConfig,
      setVolumeVisible,
      getVolumeVisible,
      getCandles: () => currentCandles.slice(),
      getBreakout: () => breakout,
      getDrawing: () => drawing,
    };
  }

  return { create };
})();
