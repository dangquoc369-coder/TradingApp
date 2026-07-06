/**
 * websocket.js
 * Quản lý kết nối WebSocket realtime tới Binance.
 * - kline stream: cập nhật nến đang chạy + volume
 * - ticker stream: cập nhật live price + % thay đổi 24h (mượt hơn, tần suất cao)
 *
 * Mọi dữ liệu nhận được sẽ được bắn ra qua EventBus, module khác tự lắng nghe,
 * websocket.js không biết và không cần biết ai đang lắng nghe.
 */

const WS_BASE = 'wss://stream.binance.com:9443/ws';

let klineSocket = null;
let tickerSocket = null;
let intentionalClose = false; // để phân biệt đóng chủ động vs mất kết nối

/**
 * Mở kết nối kline stream cho 1 symbol + 1 timeframe.
 * Tự đóng kết nối cũ trước khi mở mới.
 */
function connectKlineStream(symbol, interval) {
  closeKlineSocket();

  const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
  klineSocket = new WebSocket(`${WS_BASE}/${streamName}`);

  klineSocket.onopen = () => {
    EventBus.emit('ws:status', 'connected');
  };

  klineSocket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x, // true nếu nến đã đóng
    };
    EventBus.emit('kline:update', candle);
  };

  klineSocket.onerror = () => {
    EventBus.emit('ws:status', 'disconnected');
  };

  klineSocket.onclose = () => {
    if (!intentionalClose) {
      EventBus.emit('ws:status', 'disconnected');
      // Tự động reconnect sau 2s nếu không phải chủ động đóng
      setTimeout(() => {
        connectKlineStream(symbol, interval);
      }, 2000);
    }
  };
}

/**
 * Mở kết nối 24hr ticker stream cho live price + % thay đổi.
 */
function connectTickerStream(symbol) {
  closeTickerSocket();

  const streamName = `${symbol.toLowerCase()}@ticker`;
  tickerSocket = new WebSocket(`${WS_BASE}/${streamName}`);

  tickerSocket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    EventBus.emit('price:update', {
      price: parseFloat(msg.c),
      changePercent: parseFloat(msg.P),
    });
  };

  tickerSocket.onclose = () => {
    if (!intentionalClose) {
      setTimeout(() => connectTickerStream(symbol), 2000);
    }
  };
}

function closeKlineSocket() {
  if (klineSocket) {
    intentionalClose = true;
    klineSocket.onclose = null; // tránh trigger reconnect logic của lần đóng chủ động
    klineSocket.close();
    klineSocket = null;
    intentionalClose = false;
  }
}

function closeTickerSocket() {
  if (tickerSocket) {
    intentionalClose = true;
    tickerSocket.onclose = null;
    tickerSocket.close();
    tickerSocket = null;
    intentionalClose = false;
  }
}

/**
 * Đóng toàn bộ kết nối - gọi khi đổi symbol/timeframe hoặc rời trang.
 */
function closeAllSockets() {
  closeKlineSocket();
  closeTickerSocket();
}

/**
 * Mở lại cả 2 stream cho symbol/timeframe hiện tại - dùng khi đổi symbol/timeframe.
 */
function connectSockets(symbol, timeframe) {
  connectKlineStream(symbol, timeframe);
  connectTickerStream(symbol);
}
