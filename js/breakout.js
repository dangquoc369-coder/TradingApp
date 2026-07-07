/**
 * breakout.js
 * Chuyển logic từ BreakoutAlert.mq5 sang JS, hiển thị trực quan lên chart.
 *
 * THAY ĐỔI so với bản gốc: BreakoutModule trước đây là IIFE singleton
 * (candleSeriesRef, markers, activeTradeOpen... ở module scope). Giờ chuyển
 * thành factory `BreakoutModule.create(paneId)` để mỗi pane có 1 bộ trạng
 * thái "lệnh ảo" hoàn toàn độc lập - pane A đang theo dõi lệnh BUY của
 * BTCUSDT không được lẫn với pane B đang theo dõi SELL của ETHUSDT.
 *
 * CẬP NHẬT (đợt fix này): thêm setVisible()/isVisible() để bật/tắt hiển thị
 * marker BUY/SELL/SL + đường Stop Loss trên chart mà KHÔNG ảnh hưởng tới
 * logic theo dõi lệnh ảo bên dưới (getMarketStatus() vẫn hoạt động bình
 * thường dù marker đang bị ẩn) - chỉ là bật/tắt phần hiển thị.
 */

const BreakoutModule = (function () {
  function create(paneId) {
    let candleSeriesRef = null;
    let markersPrimitive = null;
    let slPriceLine = null;
    let markers = [];
    let visible = true; // bật/tắt hiển thị marker BUY/SELL/SL + đường SL

    let activeTradeOpen = false;
    let activeDirection = 0; // 1 = BUY, -1 = SELL
    let activeEntryPrice = 0;
    let activeSLPrice = 0;

    const CONFIG = {
      atrPeriod: 14,
      atrMultiplier: 2.5,
    };

    function configure(options) {
      Object.assign(CONFIG, options);
    }

    function init(chart, candleSeries) {
      candleSeriesRef = candleSeries;
      markersPrimitive = LightweightCharts.createSeriesMarkers(candleSeries, []);
    }

    function removeSLLine() {
      if (slPriceLine && candleSeriesRef) {
        candleSeriesRef.removePriceLine(slPriceLine);
        slPriceLine = null;
      }
    }

    function drawSLLine(price, direction) {
      removeSLLine();
      if (!visible) return; // đang tắt hiển thị -> không vẽ đường SL
      slPriceLine = candleSeriesRef.createPriceLine({
        price,
        color: '#f5c518',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'SL ' + (direction === 1 ? 'BUY' : 'SELL'),
      });
    }

    function pushMarker(marker) {
      markers.push(marker);
      markers.sort((a, b) => a.time - b.time);
      if (visible) markersPrimitive.setMarkers(markers);
    }

    function addEntryMarker(time, direction, isReversal) {
      const marker =
        direction === 1
          ? { time, position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: isReversal ? 'B' : 'BUY' }
          : { time, position: 'aboveBar', color: '#ef5350', shape: 'arrowDown', text: isReversal ? 'S' : 'SELL' };
      pushMarker(marker);
    }

    function addSLHitMarker(time) {
      pushMarker({ time, position: 'inBar', color: '#f5c518', shape: 'circle', text: 'SL' });
    }

    function openTrade(direction, entryPrice, slDistance) {
      activeTradeOpen = true;
      activeDirection = direction;
      activeEntryPrice = entryPrice;
      activeSLPrice = direction === 1 ? entryPrice - slDistance : entryPrice + slDistance;
      drawSLLine(activeSLPrice, direction);
    }

    function closeTrade() {
      activeTradeOpen = false;
      removeSLLine();
    }

    function checkSLAgainstBar(bar) {
      if (!activeTradeOpen) return false;
      if (activeDirection === 1 && bar.low <= activeSLPrice) return true;
      if (activeDirection === -1 && bar.high >= activeSLPrice) return true;
      return false;
    }

    function detectBreakout(closedCandles) {
      const len = closedCandles.length;
      const c1 = closedCandles[len - 1];
      const c2 = closedCandles[len - 2];
      const c3 = closedCandles[len - 3];
      const maxHigh12 = Math.max(c2.high, c3.high);
      const minLow12 = Math.min(c2.low, c3.low);

      let direction = 0;
      if (c1.close > maxHigh12) direction = 1;
      else if (c1.close < minLow12) direction = -1;

      return { direction, time: c1.time, entryPrice: c1.close };
    }

    function run(candles) {
      if (!candleSeriesRef) return;

      activeTradeOpen = false;
      activeDirection = 0;
      activeEntryPrice = 0;
      activeSLPrice = 0;
      markers = [];
      removeSLLine();

      if (candles.length < 5) {
        markersPrimitive.setMarkers([]);
        return;
      }

      const closed = candles.slice(0, -1);
      const forming = candles[candles.length - 1];

      for (let i = 3; i < closed.length; i++) {
        const bar = closed[i];

        if (checkSLAgainstBar(bar)) {
          addSLHitMarker(bar.time);
          closeTrade();
        }

        const slice = closed.slice(0, i + 1);
        const result = detectBreakout(slice);
        if (result.direction === 0) continue;

        if (activeTradeOpen && result.direction === activeDirection) continue;

        const atrArr = IndicatorModule.calcATR(slice, CONFIG.atrPeriod);
        const atr = atrArr[atrArr.length - 1];
        if (!atr) continue;
        const slDistance = atr * CONFIG.atrMultiplier;

        const isReversal = activeTradeOpen;
        addEntryMarker(result.time, result.direction, isReversal);
        openTrade(result.direction, result.entryPrice, slDistance);
      }

      if (checkSLAgainstBar(forming)) {
        addSLHitMarker(forming.time);
        closeTrade();
      }

      markersPrimitive.setMarkers(visible ? markers : []);
    }

    /**
     * Bật/tắt hiển thị marker BUY/SELL/SL + đường SL trên chart.
     * Logic theo dõi lệnh ảo (activeTradeOpen, activeSLPrice...) vẫn chạy
     * bình thường phía dưới dù đang ẩn - chỉ phần VẼ ra là bị tắt.
     */
    function setVisible(v) {
      visible = !!v;
      if (markersPrimitive) markersPrimitive.setMarkers(visible ? markers : []);
      if (visible && activeTradeOpen) {
        drawSLLine(activeSLPrice, activeDirection);
      } else if (!visible) {
        removeSLLine();
      }
    }

    function isVisible() {
      return visible;
    }

    function getMarketStatus(candles) {
      if (!candles || candles.length < 5) {
        return { ok: false, reason: 'Chưa đủ dữ liệu nến để phân tích.' };
      }

      const closed = candles.slice(0, -1);
      const forming = candles[candles.length - 1];
      const len = closed.length;
      const c1 = closed[len - 1];
      const c2 = closed[len - 2];
      const c3 = closed[len - 3];
      const maxHigh12 = Math.max(c2.high, c3.high);
      const minLow12 = Math.min(c2.low, c3.low);

      let trend = 'sideway';
      let breakDistance = 0;
      if (c1.close > maxHigh12) {
        trend = 'up';
        breakDistance = c1.close - maxHigh12;
      } else if (c1.close < minLow12) {
        trend = 'down';
        breakDistance = minLow12 - c1.close;
      }

      return {
        ok: true,
        paneId,
        lastClosedCandleTime: c1.time,
        trend,
        breakDistance,
        distanceToHighZone: maxHigh12 - c1.close,
        distanceToLowZone: c1.close - minLow12,
        maxHigh12,
        minLow12,
        currentPrice: forming.close,
        activeTradeOpen,
        activeDirection,
        activeEntryPrice,
        activeSLPrice,
        risk: activeTradeOpen ? Math.abs(activeEntryPrice - activeSLPrice) : null,
      };
    }

    return { init, run, configure, getMarketStatus, setVisible, isVisible };
  }

  return { create };
})();
