/**
 * breakout.js
 * Chuyển logic từ BreakoutAlert.mq5 sang JS, hiển thị trực quan lên chart:
 * - Nến đóng cửa vượt ra ngoài vùng high/low của 2 nến liền trước -> tín hiệu breakout
 *   (giống CheckBreakout() trong MQL5, dùng iClose/iHigh/iLow index 1/2/3).
 * - SL = ATR(14) * 2.5 (giống GetATR + ATRMultiplier).
 * - "Lệnh ảo" được theo dõi: nếu giá chạm SL -> đóng; nếu đảo chiều TRƯỚC khi chạm SL
 *   -> huỷ lệnh cũ, vào lệnh mới (giống MonitorActiveTradeSL / CheckBreakout).
 *
 * Vẽ lên chart bằng:
 * - Marker mũi tên (BUY/SELL/Đảo chiều) qua LightweightCharts.createSeriesMarkers (API v5).
 * - Marker tròn khi chạm SL.
 * - Đường Stop Loss của lệnh đang theo dõi qua series.createPriceLine().
 *
 * Không tự gọi Telegram - chỉ phần visualize. Việc gọi API/alert (nếu cần) do bạn nối thêm.
 */

const BreakoutModule = (function () {
  let candleSeriesRef = null;
  let markersPrimitive = null;
  let slPriceLine = null;
  let markers = [];

  // Trạng thái "lệnh ảo" đang theo dõi (tương đương activeTradeOpen/... trong MQL5)
  let activeTradeOpen = false;
  let activeDirection = 0; // 1 = BUY, -1 = SELL
  let activeEntryPrice = 0;
  let activeSLPrice = 0;

  const CONFIG = {
    atrPeriod: 14,
    atrMultiplier: 2.5,
  };

  /** Cho phép chỉnh ATR period/multiplier từ bên ngoài nếu cần, giống input trong MQL5. */
  function configure(options) {
    Object.assign(CONFIG, options);
  }

  /** Gọi 1 lần sau khi candleSeries đã được tạo trong chart.js. */
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
    markersPrimitive.setMarkers(markers);
  }

  function addEntryMarker(time, direction, isReversal) {
    const marker =
      direction === 1
        ? {
            time,
            position: 'belowBar',
            color: '#26a69a',
            shape: 'arrowUp',
            text: isReversal ? 'B' : 'BUY',
          }
        : {
            time,
            position: 'aboveBar',
            color: '#ef5350',
            shape: 'arrowDown',
            text: isReversal ? 'S' : 'SELL',
          };
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

  /** Kiểm tra 1 nến (high/low) có chạm SL của lệnh ảo đang theo dõi không (giống MonitorActiveTradeSL). */
  function checkSLAgainstBar(bar) {
    if (!activeTradeOpen) return false;
    if (activeDirection === 1 && bar.low <= activeSLPrice) return true;
    if (activeDirection === -1 && bar.high >= activeSLPrice) return true;
    return false;
  }

  /** So sánh nến đóng cửa mới nhất với vùng high/low của 2 nến trước đó (giống CheckBreakout). */
  function detectBreakout(closedCandles) {
    const len = closedCandles.length;
    const c1 = closedCandles[len - 1]; // nến vừa đóng (giống iClose(...,1))
    const c2 = closedCandles[len - 2]; // giống index 2
    const c3 = closedCandles[len - 3]; // giống index 3
    const maxHigh12 = Math.max(c2.high, c3.high);
    const minLow12 = Math.min(c2.low, c3.low);

    let direction = 0;
    if (c1.close > maxHigh12) direction = 1;
    else if (c1.close < minLow12) direction = -1;

    return { direction, time: c1.time, entryPrice: c1.close };
  }

  /**
   * Quét toàn bộ lịch sử nến đã đóng, dựng lại chuỗi tín hiệu breakout / đảo chiều / SL hit
   * (giống việc OnTick chạy tuần tự qua từng nến trong MQL5).
   * candles: mảng ascending, phần tử CUỐI có thể là nến đang chạy dở (chưa đóng).
   */
  function run(candles) {
    if (!candleSeriesRef) return; // chưa init xong, bỏ qua

    // Reset trạng thái - tính lại từ đầu mỗi lần (an toàn, tránh lệch state khi đổi symbol/timeframe)
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

    // Nến cuối cùng coi như đang chạy dở (giống index 0 trong MQL5), không dùng để tính breakout
    const closed = candles.slice(0, -1);
    const forming = candles[candles.length - 1];

    for (let i = 3; i < closed.length; i++) {
      const bar = closed[i];

      // 1. Theo dõi SL trước (mỗi tick trong MQL5 gọi MonitorActiveTradeSL trước CheckBreakout)
      if (checkSLAgainstBar(bar)) {
        addSLHitMarker(bar.time);
        closeTrade();
      }

      // 2. Kiểm tra breakout trên nến vừa đóng
      const slice = closed.slice(0, i + 1);
      const result = detectBreakout(slice);
      if (result.direction === 0) continue;

      if (activeTradeOpen && result.direction === activeDirection) {
        continue; // cùng chiều với lệnh đang theo dõi -> bỏ qua, giống MQL5
      }

      const atrArr = IndicatorModule.calcATR(slice, CONFIG.atrPeriod);
      const atr = atrArr[atrArr.length - 1];
      if (!atr) continue;
      const slDistance = atr * CONFIG.atrMultiplier;

      const isReversal = activeTradeOpen; // có lệnh cũ khác chiều -> đây là đảo chiều
      addEntryMarker(result.time, result.direction, isReversal);
      openTrade(result.direction, result.entryPrice, slDistance);
    }

    // 3. Theo dõi SL bằng giá của nến đang chạy dở (giống theo dõi mỗi tick trong MQL5)
    if (checkSLAgainstBar(forming)) {
      addSLHitMarker(forming.time);
      closeTrade();
    }

    markersPrimitive.setMarkers(markers);
  }

  /**
   * Trả về trạng thái thị trường hiện tại - tương đương SendCurrentMarketStatus() trong MQL5,
   * nhưng trả về dữ liệu có cấu trúc để hiển thị trên web thay vì gửi Telegram.
   * Gọi hàm này bất cứ lúc nào (VD: khi bấm nút) - không làm thay đổi trạng thái lệnh ảo.
   */
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

    let trend = 'sideway'; // 'up' | 'down' | 'sideway'
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
      lastClosedCandleTime: c1.time,
      trend,
      breakDistance,
      distanceToHighZone: maxHigh12 - c1.close,
      distanceToLowZone: c1.close - minLow12,
      maxHigh12,
      minLow12,
      currentPrice: forming.close,
      activeTradeOpen,
      activeDirection, // 1 = BUY, -1 = SELL
      activeEntryPrice,
      activeSLPrice,
      risk: activeTradeOpen ? Math.abs(activeEntryPrice - activeSLPrice) : null,
    };
  }

  return { init, run, configure, getMarketStatus };
})();