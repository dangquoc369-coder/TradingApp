/**
 * utils.js
 * Các hàm tiện ích thuần (pure functions) + EventBus dùng chung toàn app.
 * File này KHÔNG phụ thuộc vào bất kỳ module nào khác -> phải load đầu tiên.
 */

/* ===================== EVENT BUS ===================== */
/**
 * EventBus đơn giản dựa trên CustomEvent của window.
 * Cho phép các module giao tiếp với nhau mà không cần import trực tiếp.
 */
const EventBus = {
  on(eventName, callback) {
    window.addEventListener(eventName, (e) => callback(e.detail));
  },
  off(eventName, callback) {
    window.removeEventListener(eventName, callback);
  },
  emit(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  },
};

/* ===================== FORMATTERS ===================== */

/**
 * Format giá theo số thập phân phù hợp.
 * Giá càng nhỏ thì càng cần nhiều số lẻ (vd: SHIB, PEPE).
 */
function formatPrice(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  let decimals = 2;
  if (num < 1) decimals = 6;
  else if (num < 10) decimals = 4;
  else if (num < 1000) decimals = 2;
  else decimals = 2;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Rút gọn volume lớn thành dạng K / M / B.
 */
function formatVolume(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

/**
 * Format % thay đổi giá, kèm dấu +/-.
 */
function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Debounce: trì hoãn gọi hàm cho đến khi ngừng gọi trong khoảng `delay` ms.
 * Dùng cho ô tìm kiếm symbol.
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Map timeframe hiển thị (UI) -> interval Binance API.
 * Lưu ý: Binance phân biệt hoa/thường - '1w' (tuần) viết thường,
 * '1M' (tháng) viết hoa M. Gõ sai hoa/thường sẽ khiến API trả lỗi 400.
 */
const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1H', value: '1h' },
  { label: '2H', value: '2h' },
  { label: '4H', value: '4h' },
  { label: '12H', value: '12h' },
  { label: '1D', value: '1d' },
  { label: '3D', value: '3d' },
  { label: 'W', value: '1w' },
  { label: 'M', value: '1M' },
];