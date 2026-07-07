/**
 * indicator-legend.js
 * Vẽ 1 legend nhỏ (giống TradingView) đè lên góc trên-trái của mỗi pane,
 * liệt kê các indicator (EMA21, EMA200, RSI14, EMA9(RSI), WMA45(RSI)):
 * - Click vào tên/chấm màu -> ẩn/hiện indicator đó (gọi ChartModule.setIndicatorVisible).
 * - Click icon bánh răng -> mở popover nhỏ để nhập chu kỳ mới (gọi ChartModule.setIndicatorPeriod).
 *
 * CẬP NHẬT (đợt fix này): thêm 2 chip KHÔNG có bánh răng (không cần chỉnh
 * chu kỳ), chỉ bật/tắt:
 *   - "Volume": gọi instance.setVolumeVisible()/getVolumeVisible()
 *   - "BUY/SELL": gọi instance.getBreakout().setVisible()/isVisible()
 *
 * Module này KHÔNG giữ state riêng - luôn đọc/ghi qua instance ChartModule
 * của đúng pane (instance được app.js truyền vào sau khi initChart xong).
 */

const IndicatorLegend = (function () {
  /** Vẽ lại toàn bộ legend của 1 pane từ config hiện tại của instance đó. */
  function render(paneId, instance) {
    const container = document.getElementById(`${paneId}-legend`);
    if (!container) return;
    container.innerHTML = '';

    const config = instance.getIndicatorConfig();
    Object.keys(config).forEach((key) => {
      container.appendChild(buildChip(paneId, instance, key, config[key]));
    });

    container.appendChild(buildSimpleToggleChip('#787b86', 'Volume', instance.getVolumeVisible(), (next) => {
      instance.setVolumeVisible(next);
      render(paneId, instance);
    }));

    const breakout = instance.getBreakout();
    container.appendChild(buildSimpleToggleChip('#2962ff', 'BUY/SELL', breakout.isVisible(), (next) => {
      breakout.setVisible(next);
      render(paneId, instance);
    }));
  }

  function buildChip(paneId, instance, key, item) {
    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (item.enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = item.color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `${item.label} ${item.period}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Chỉnh chu kỳ';
    gear.textContent = '⚙';

    function toggle(e) {
      e.stopPropagation();
      instance.setIndicatorVisible(key, !item.enabled);
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openPeriodPopover(chip, paneId, instance, key, item);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  /** Chip đơn giản không có bánh răng - chỉ bật/tắt (dùng cho Volume, BUY/SELL). */
  function buildSimpleToggleChip(color, label, enabled, onToggle) {
    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = label;

    function toggle(e) {
      e.stopPropagation();
      onToggle(!enabled);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);

    chip.appendChild(dot);
    chip.appendChild(name);
    return chip;
  }

  function closeAnyOpenPopover() {
    document.querySelectorAll('.indicator-popover').forEach((el) => el.remove());
  }

  function openPeriodPopover(chip, paneId, instance, key, item) {
    closeAnyOpenPopover();

    const popover = document.createElement('div');
    popover.className = 'indicator-popover';
    popover.addEventListener('click', (e) => e.stopPropagation()); // không để click nổi lên pane-focus / đóng popover ngay lập tức

    const label = document.createElement('label');
    label.textContent = `Chu kỳ ${item.label}`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '1000';
    input.value = item.period;

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const val = parseInt(input.value, 10);
      if (val && val > 0) {
        instance.setIndicatorPeriod(key, val);
      }
      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') popover.remove();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    popover.appendChild(label);
    popover.appendChild(input);
    popover.appendChild(actions);
    chip.appendChild(popover);

    input.focus();
    input.select();
  }

  // Click ra ngoài bất kỳ đâu -> đóng popover đang mở (nếu có)
  document.addEventListener('click', closeAnyOpenPopover);

  return { render };
})();
