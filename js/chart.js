/**
 * chart.js
 * Khởi tạo và điều khiển biểu đồ Lightweight Charts v5.x.
 * Chịu trách nhiệm: candlestick series, volume series, resize, cập nhật realtime.
 *
 * Lưu ý API v5: series được tạo qua chart.addSeries(SeriesType, options, paneIndex),
 * KHÔNG dùng chart.addCandlestickSeries()/addHistogramSeries() (API cũ của v3/v4).
 */

const ChartModule = (function () {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let resizeObserver = null;

  // Series chỉ báo (indicator.js chỉ tính toán, việc tạo series thuộc về chart.js)
  let ema21Series = null;
  let ema200Series = null;
  let rsiSeries = null;
  let emaRsiSeries = null;
  let wmaRsiSeries = null;

  // Giữ toàn bộ nến hiện tại để tính lại chỉ báo khi có tick mới
  let currentCandles = [];

  /**
   * Khởi tạo chart trong container truyền vào. Gọi 1 lần duy nhất khi app start.
   */
  function initChart(container) {
    chart = LightweightCharts.createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#d1d4dc',
        panes: {
          separatorColor: '#2a2e39',
        },
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    // Chừa khoảng trống phía dưới cho volume để 2 series không đè lên nhau.
    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.3 },
    });

    // Khởi tạo module breakout (marker BUY/SELL/đảo chiều/SL) trên chính candleSeries.
    BreakoutModule.init(chart, candleSeries);

    volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // --- EMA21 / EMA200 của giá: đè lên pane 0 (cùng pane với nến) ---
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

    // --- RSI14 / EMA9(RSI) / WMA45(RSI): pane 1, tự tách riêng khỏi giá ---
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

    // Giới hạn chiều cao pane RSI để không chiếm quá nhiều diện tích.
    // Lưu ý: setStretchFactor() chỉ có từ lightweight-charts v5.0.8 trở lên.
    // Nếu bạn đang dùng v5.0.0 (như thẻ <script> hiện tại), hàm này không tồn tại,
    // nên phải feature-detect để không làm gãy initChart().
    try {
      const panes = chart.panes();
      if (panes[1] && typeof panes[1].setStretchFactor === 'function') {
        panes[1].setStretchFactor(0.3);
      }
      if (panes[0] && typeof panes[0].setStretchFactor === 'function') {
        panes[0].setStretchFactor(0.7);
      }
    } catch (err) {
      console.warn('Không thể chỉnh tỉ lệ pane (setStretchFactor không khả dụng ở phiên bản này):', err);
    }

    setupResize(container);

    // Tự lắng nghe dữ liệu realtime - các module khác chỉ cần emit đúng event.
    EventBus.on('kline:update', handleKlineUpdate);

    return chart;
  }

  /**
   * Tự động resize chart khi container đổi kích thước (thu/phóng cửa sổ trình duyệt).
   */
  function setupResize(container) {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    resizeObserver.observe(container);
  }

  /**
   * Tính lại EMA21/EMA200 (giá) và RSI14/EMA9(RSI)/WMA45(RSI), rồi đổ vào các series tương ứng.
   */
  function renderIndicators(candles) {
    const closes = candles.map((c) => c.close);

    const ema21 = IndicatorModule.calcEMA(closes, 21);
    const ema200 = IndicatorModule.calcEMA(closes, 200);
    ema21Series.setData(IndicatorModule.toSeriesData(candles, ema21));
    ema200Series.setData(IndicatorModule.toSeriesData(candles, ema200));

    const rsi = IndicatorModule.calcRSI(candles, 14);
    const emaOfRsi = IndicatorModule.calcEMA(rsi, 9);
    const wmaOfRsi = IndicatorModule.calcWMA(rsi, 45);
    rsiSeries.setData(IndicatorModule.toSeriesData(candles, rsi));
    emaRsiSeries.setData(IndicatorModule.toSeriesData(candles, emaOfRsi));
    wmaRsiSeries.setData(IndicatorModule.toSeriesData(candles, wmaOfRsi));
  }

  /**
   * Đổ dữ liệu ban đầu (từ REST API) vào chart.
   */
  function loadInitialData(candles) {
    currentCandles = candles.slice();

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      }))
    );

    renderIndicators(currentCandles);
    BreakoutModule.run(currentCandles);
  }

  /**
   * Xử lý nến realtime từ WebSocket - chỉ update nến cuối, không setData lại toàn bộ.
   */
  function handleKlineUpdate(candle) {
    Store.upsertCandle(candle);

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

    // Cập nhật nến cuối (hoặc thêm nến mới) trong bản sao cục bộ, rồi tính lại chỉ báo.
    const lastIndex = currentCandles.length - 1;
    if (lastIndex >= 0 && currentCandles[lastIndex].time === candle.time) {
      currentCandles[lastIndex] = candle;
    } else {
      currentCandles.push(candle);
    }
    renderIndicators(currentCandles);
    BreakoutModule.run(currentCandles);
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
    BreakoutModule.run([]); // dọn marker + SL line của symbol/timeframe cũ
  }

  return {
    initChart,
    loadInitialData,
    clearData,
    getCandles: () => currentCandles.slice(),
  };
})();