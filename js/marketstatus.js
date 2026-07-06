/**
 * marketstatus.js
 * Nút "Trạng thái thị trường" - tương đương SendCurrentMarketStatus() trong MQL5,
 * nhưng hiển thị ngay trên web (panel) thay vì gửi qua Telegram.
 *
 * Tự chèn nút vào #topbar, không cần sửa ui.js. Khi bấm:
 * 1. Lấy nến hiện tại từ ChartModule.getCandles()
 * 2. Phân tích bằng BreakoutModule.getMarketStatus(candles)
 * 3. Hiển thị kết quả trong 1 panel nhỏ, đóng được.
 */

(function () {
  function formatPrice(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    // Số càng nhỏ (VD: altcoin giá 0.0003) thì càng cần nhiều số thập phân.
    const digits = Math.abs(value) < 1 ? 6 : 2;
    return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatTime(unixSeconds) {
    if (!unixSeconds) return '--';
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  /** Dựng nội dung panel - giống cấu trúc message trong SendCurrentMarketStatus(). */
  function buildStatusHTML(status) {
    if (!status.ok) {
      return `<div class="ms-row ms-muted">${status.reason}</div>`;
    }

    let trendHTML = '';
    if (status.trend === 'up') {
      trendHTML = `
        <div class="ms-row ms-trend-up">✅ NẾN GẦN NHẤT: XU HƯỚNG TĂNG</div>
        <div class="ms-row ms-muted">📏 Vượt vùng bán buôn: +${formatPrice(status.breakDistance)}</div>`;
    } else if (status.trend === 'down') {
      trendHTML = `
        <div class="ms-row ms-trend-down">✅ NẾN GẦN NHẤT: XU HƯỚNG GIẢM</div>
        <div class="ms-row ms-muted">📏 Vượt vùng bán buôn: -${formatPrice(status.breakDistance)}</div>`;
    } else {
      trendHTML = `
        <div class="ms-row ms-trend-side">⏸️ NẾN GẦN NHẤT: ĐANG SIDEWAY</div>
        <div class="ms-row ms-muted">📏 Tới vùng trên: +${formatPrice(status.distanceToHighZone)}</div>
        <div class="ms-row ms-muted">📏 Tới vùng dưới: -${formatPrice(status.distanceToLowZone)}</div>`;
    }

    let tradeHTML = '';
    if (status.activeTradeOpen) {
      const dirLabel = status.activeDirection === 1 ? 'BUY 🔵' : 'SELL 🔴';
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">📌 ĐANG THEO DÕI LỆNH: ${dirLabel}</div>
        <div class="ms-row">Entry: ${formatPrice(status.activeEntryPrice)}</div>
        <div class="ms-row">Stop Loss: ${formatPrice(status.activeSLPrice)}</div>
        <div class="ms-row">Giá hiện tại: ${formatPrice(status.currentPrice)}</div>
        <div class="ms-row">📏 Risk: ${formatPrice(status.risk)}</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi chạm SL hoặc có đảo chiều</div>`;
    } else {
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">⏳ KHÔNG CÓ LỆNH NÀO ĐANG THEO DÕI</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi có tín hiệu breakout mới</div>`;
    }

    return `
      <div class="ms-row ms-muted">⏱️ Nến đóng gần nhất: ${formatTime(status.lastClosedCandleTime)}</div>
      ${trendHTML}
      ${tradeHTML}
    `;
  }

  function injectStyles() {
    if (document.getElementById('marketStatusStyles')) return;
    const style = document.createElement('style');
    style.id = 'marketStatusStyles';
    style.textContent = `
      #marketStatusBtn {
        background: #1e222d;
        color: #d1d4dc;
        border: 1px solid #2a2e39;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        cursor: pointer;
        margin-left: 12px;
      }
      #marketStatusBtn:hover { background: #2a2e39; }
      #marketStatusPanel {
        position: fixed;
        top: 60px;
        right: 20px;
        width: 300px;
        background: #131722;
        border: 1px solid #2a2e39;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        color: #d1d4dc;
        font-size: 13px;
        z-index: 9999;
        padding: 14px 16px;
        display: none;
      }
      #marketStatusPanel.open { display: block; }
      #marketStatusPanel .ms-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 10px; font-weight: 600; color: #fff;
      }
      #marketStatusPanel .ms-close {
        cursor: pointer; color: #787b86; font-size: 16px; line-height: 1;
      }
      #marketStatusPanel .ms-row { margin-bottom: 6px; line-height: 1.4; }
      #marketStatusPanel .ms-muted { color: #9aa0aa; font-size: 12px; }
      #marketStatusPanel .ms-bold { font-weight: 600; color: #fff; }
      #marketStatusPanel .ms-trend-up { color: #26a69a; font-weight: 600; }
      #marketStatusPanel .ms-trend-down { color: #ef5350; font-weight: 600; }
      #marketStatusPanel .ms-trend-side { color: #f5c518; font-weight: 600; }
      #marketStatusPanel .ms-divider {
        border-top: 1px solid #2a2e39; margin: 10px 0;
      }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'marketStatusPanel';
    panel.innerHTML = `
      <div class="ms-header">
        <span>📊 Trạng thái thị trường</span>
        <span class="ms-close">✕</span>
      </div>
      <div id="marketStatusBody"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.ms-close').addEventListener('click', () => {
      panel.classList.remove('open');
    });
    return panel;
  }

  function showStatus(panel) {
    const body = panel.querySelector('#marketStatusBody');
    try {
      const candles = ChartModule.getCandles();
      const status = BreakoutModule.getMarketStatus(candles);
      body.innerHTML = buildStatusHTML(status);
    } catch (err) {
      body.innerHTML = `<div class="ms-row ms-muted">Lỗi khi lấy trạng thái: ${err.message}</div>`;
      console.error('marketstatus.js error:', err);
    }
    panel.classList.add('open');
  }

  function createButton(panel) {
    const btn = document.createElement('button');
    btn.id = 'marketStatusBtn';
    btn.type = 'button';
    btn.textContent = '📊 Trạng thái thị trường';
    btn.addEventListener('click', () => {
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
      } else {
        showStatus(panel);
      }
    });
    return btn;
  }

  function mount() {
    injectStyles();
    const panel = createPanel();
    const btn = createButton(panel);

    // Chèn nút vào topbar-right nếu có, nếu không thì chèn cuối #topbar.
    const target = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (target) {
      target.appendChild(btn);
    } else {
      // Không tìm thấy topbar - vẫn hiển thị nút cố định để không mất tính năng.
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.right = '20px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();