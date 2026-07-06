/**
 * storage.js
 * State trung tâm (single source of truth) cho toàn bộ app.
 * Mọi module đọc/ghi state qua các hàm ở đây, không tự giữ biến global riêng.
 * Mỗi lần thay đổi quan trọng sẽ emit event tương ứng qua EventBus.
 */

const Store = (function () {
  const state = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    candles: [],        // { time, open, high, low, close, volume }
    lastPrice: null,
    priceChangePercent: null,
    popularSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
    allSymbols: [],      // cache danh sách symbol từ exchangeInfo (đổ vào khi search lần đầu)
  };

  function getState() {
    return state;
  }

  function setSymbol(symbol) {
    if (symbol === state.symbol) return;
    state.symbol = symbol;
    state.candles = [];
    state.lastPrice = null;
    state.priceChangePercent = null;
    EventBus.emit('symbol:changed', symbol);
  }

  function setTimeframe(timeframe) {
    if (timeframe === state.timeframe) return;
    state.timeframe = timeframe;
    state.candles = [];
    EventBus.emit('timeframe:changed', timeframe);
  }

  function setCandles(candles) {
    state.candles = candles;
    EventBus.emit('candles:loaded', candles);
  }

  /**
   * Cập nhật (hoặc thêm mới) cây nến cuối cùng khi có dữ liệu realtime.
   */
  function upsertCandle(candle) {
    const candles = state.candles;
    const last = candles[candles.length - 1];
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      candles.push(candle);
    }
    // Nếu candle.time < last.time -> dữ liệu cũ/trễ, bỏ qua để tránh làm hỏng thứ tự.
  }

  function setLastPrice(price, changePercent) {
    state.lastPrice = price;
    if (changePercent !== undefined) state.priceChangePercent = changePercent;
    EventBus.emit('price:changed', { price, changePercent: state.priceChangePercent });
  }

  function setAllSymbols(list) {
    state.allSymbols = list;
  }

  return {
    getState,
    setSymbol,
    setTimeframe,
    setCandles,
    upsertCandle,
    setLastPrice,
    setAllSymbols,
  };
})();
