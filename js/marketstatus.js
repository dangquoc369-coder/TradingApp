/**
 * marketstatus.js
 * Nút "Trạng thái thị trường" - CHỈ 1 NÚT DUY NHẤT dùng chung cho cả 4 pane.
 */

(function () {
  function formatPriceLocalMS(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    const digits = Math.abs(value) < 1 ? 6 : 2;
    return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatTime(unixSeconds) {
    if (!unixSeconds) return '--';
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  function buildStatusHTML(status, paneLabel) {
    if (!status.ok) {
      return `<div class="ms-row ms-muted">${status.reason}</div>`;
    }

    let trendHTML = '';
    if (status.trend === 'up') {
      trendHTML = `
        <div class="ms-row ms-trend-up">✅ NẾN GẦN NHẤT: XU HƯỚNG TĂNG</div>
        <div class="ms-row ms-muted">📏 Vượt vùng bán buôn: +${formatPriceLocalMS(status.breakDistance)}</div>`;
    } else if (status.trend === 'down') {
      trendHTML = `
        <div class="ms-row ms-trend-down">✅ NẾN GẦN NHẤT: XU HƯỚNG GIẢM</div>
        <div class="ms-row ms-muted">📏 Vượt vùng bán buôn: -${formatPriceLocalMS(status.breakDistance)}</div>`;
    } else {
      trendHTML = `
        <div class="ms-row ms-trend-side">⏸️ NẾN GẦN NHẤT: ĐANG SIDEWAY</div>
        <div class="ms-row ms-muted">📏 Tới vùng trên: +${formatPriceLocalMS(status.distanceToHighZone)}</div>
        <div class="ms-row ms-muted">📏 Tới vùng dưới: -${formatPriceLocalMS(status.distanceToLowZone)}</div>`;
    }

    let tradeHTML = '';
    if (status.activeTradeOpen) {
      const dirLabel = status.activeDirection === 1 ? 'BUY 🔵' : 'SELL 🔴';
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">📌 ĐANG THEO DÕI LỆNH: ${dirLabel}</div>
        <div class="ms-row">Entry: ${formatPriceLocalMS(status.activeEntryPrice)}</div>
        <div class="ms-row">Stop Loss: ${formatPriceLocalMS(status.activeSLPrice)}</div>
        <div class="ms-row">Giá hiện tại: ${formatPriceLocalMS(status.currentPrice)}</div>
        <div class="ms-row">📏 Risk: ${formatPriceLocalMS(status.risk)}</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi chạm SL hoặc có đảo chiều</div>`;
    } else {
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">⏳ KHÔNG CÓ LỆNH NÀO ĐANG THEO DÕI</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi có tín hiệu breakout mới</div>`;
    }

    return `
      <div class="ms-row ms-bold">${paneLabel}</div>
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
        max-width: calc(100vw - 24px);
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
      #marketStatusPanel .ms-close { cursor: pointer; color: #787b86; font-size: 16px; line-height: 1; }
      #marketStatusPanel .ms-row { margin-bottom: 6px; line-height: 1.4; }
      #marketStatusPanel .ms-muted { color: #9aa0aa; font-size: 12px; }
      #marketStatusPanel .ms-bold { font-weight: 600; color: #fff; }
      #marketStatusPanel .ms-trend-up { color: #26a69a; font-weight: 600; }
      #marketStatusPanel .ms-trend-down { color: #ef5350; font-weight: 600; }
      #marketStatusPanel .ms-trend-side { color: #f5c518; font-weight: 600; }
      #marketStatusPanel .ms-divider { border-top: 1px solid #2a2e39; margin: 10px 0; }
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
    panel.querySelector('.ms-close').addEventListener('click', () => panel.classList.remove('open'));
    return panel;
  }

  function showStatus(panel) {
    const body = panel.querySelector('#marketStatusBody');
    try {
      const activePane = Store.getActivePane();
      const instance = window.PaneRegistry.get(activePane.id);
      const candles = instance.getCandles();
      const status = instance.getBreakout().getMarketStatus(candles);
      const paneLabel = `Pane đang xem: ${activePane.symbol} (${activePane.timeframe})`;
      body.innerHTML = buildStatusHTML(status, paneLabel);
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

  function bindAutoRefreshOnFocusChange(panel) {
    EventBus.on('pane:focused', () => {
      if (panel.classList.contains('open')) showStatus(panel);
    });
  }

  function mount() {
    injectStyles();
    const panel = createPanel();
    const btn = createButton(panel);
    bindAutoRefreshOnFocusChange(panel);

    const target = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (target) {
      target.appendChild(btn);
    } else {
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
