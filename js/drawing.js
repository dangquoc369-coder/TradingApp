/**
 * drawing.js
 * Bộ công cụ vẽ cơ bản kiểu TradingView cho MỖI pane, độc lập với nhau:
 *   - Con trỏ (mặc định, không vẽ gì, thao tác chart bình thường)
 *   - Đường ngang (Horizontal Line)
 *   - Đường xu hướng (Trend Line) - kéo từ điểm A -> điểm B
 *   - Hình chữ nhật (Rectangle) - kéo để khoanh vùng
 *   - Xoá tất cả
 *
 * Cách làm: KHÔNG dùng series/primitive phức tạp của lightweight-charts, mà
 * chèn 1 <canvas> overlay tuyệt đối đè lên trên container của chart, tự vẽ
 * tay bằng Canvas 2D API. Toạ độ (time, price) được quy đổi qua toạ độ pixel
 * bằng chart.timeScale() và candleSeries.priceToCoordinate()/coordinateToPrice(),
 * nên khi người dùng pan/zoom chart, hình vẽ tự "bám" đúng theo dữ liệu vì ta
 * redraw() lại mỗi khi visible range đổi.
 *
 * Dùng Pointer Events (không phải mouse events) để 1 bộ code chạy được cho
 * cả chuột (desktop) lẫn cảm ứng (điện thoại/tablet) - phục vụ yêu cầu tối
 * ưu cho mọi thiết bị.
 *
 * KHÔNG giữ state dùng chung - mỗi pane gọi DrawingModule.create(...) ra 1
 * instance riêng, y hệt pattern của ChartModule/BreakoutModule.
 */

const DrawingModule = (function () {
  function create(paneId, chart, candleSeries, container) {
    let currentTool = 'cursor'; // cursor | hline | trendline | rectangle
    let drawings = [];
    let dragStart = null;
    let previewDrawing = null;

    // Đảm bảo container có position để canvas overlay tuyệt đối bám đúng vị trí
    const computed = window.getComputedStyle(container);
    if (computed.position === 'static') container.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.className = 'draw-canvas';
    canvas.style.touchAction = 'none'; // chặn cuộn trang khi đang kéo vẽ trên mobile
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function timeToX(time) {
      return chart.timeScale().timeToCoordinate(time);
    }
    function priceToY(price) {
      return candleSeries.priceToCoordinate(price);
    }
    function xToTime(x) {
      return chart.timeScale().coordinateToTime(x);
    }
    function yToPrice(y) {
      return candleSeries.coordinateToPrice(y);
    }

    function setTool(tool) {
      currentTool = tool;
      canvas.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
      canvas.style.cursor = tool === 'cursor' ? 'default' : 'crosshair';
    }

    function clearAll() {
      drawings = [];
      redraw();
    }

    function getRect() {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }

    function redraw() {
      const { width, height } = getRect();
      ctx.clearRect(0, 0, width, height);
      drawings.forEach((d) => drawShape(d, false));
      if (previewDrawing) drawShape(previewDrawing, true);
    }

    function drawShape(d, isPreview) {
      ctx.save();
      ctx.strokeStyle = isPreview ? 'rgba(41, 98, 255, 0.55)' : '#2962ff';
      ctx.lineWidth = 1.5;

      if (d.type === 'hline') {
        const y = priceToY(d.price);
        if (y === null || y === undefined) { ctx.restore(); return; }
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(getRect().width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#2962ff';
        ctx.font = '10px sans-serif';
        ctx.fillText(formatPrice(d.price), 4, y - 4);
      } else if (d.type === 'trendline') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (d.type === 'rectangle') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
        ctx.fillStyle = 'rgba(41, 98, 255, 0.10)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      }
      ctx.restore();
    }

    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = xToTime(x);
      const price = yToPrice(y);
      return { time, price };
    }

    function onPointerDown(e) {
      if (currentTool === 'cursor') return;
      const pt = pointFromEvent(e);
      if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;

      if (currentTool === 'hline') {
        drawings.push({ type: 'hline', price: pt.price });
        redraw();
        return;
      }
      dragStart = pt;
      canvas.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (currentTool === 'cursor' || !dragStart) return;
      const pt = pointFromEvent(e);
      if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;
      previewDrawing = { type: currentTool, p1: dragStart, p2: pt };
      redraw();
    }

    function onPointerUp(e) {
      if (currentTool === 'cursor' || !dragStart) return;
      const pt = pointFromEvent(e);
      if (
        pt.time !== null && pt.time !== undefined &&
        pt.price !== null && pt.price !== undefined &&
        (currentTool === 'trendline' || currentTool === 'rectangle')
      ) {
        drawings.push({ type: currentTool, p1: dragStart, p2: pt });
      }
      dragStart = null;
      previewDrawing = null;
      redraw();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', () => { dragStart = null; previewDrawing = null; redraw(); });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw());

    const resizeObs = new ResizeObserver(() => resizeCanvas());
    resizeObs.observe(container);
    resizeCanvas();

    const api = { setTool, clearAll, redraw, getTool: () => currentTool };
    createToolbar(container, api);
    return api;
  }

  function formatPrice(v) {
    if (typeof formatPriceLocal === 'function') return formatPriceLocal(v);
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }

  const TOOLS = [
    { id: 'cursor', label: '↖', title: 'Con trỏ' },
    { id: 'hline', label: '—', title: 'Đường ngang' },
    { id: 'trendline', label: '/', title: 'Đường xu hướng' },
    { id: 'rectangle', label: '▭', title: 'Hình chữ nhật' },
    { id: 'clear', label: '🗑', title: 'Xoá tất cả hình vẽ' },
  ];

  function createToolbar(container, api) {
    const bar = document.createElement('div');
    bar.className = 'draw-toolbar';
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    TOOLS.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draw-tool-btn' + (t.id === 'cursor' ? ' active' : '');
      btn.textContent = t.label;
      btn.title = t.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.id === 'clear') {
          api.clearAll();
          return;
        }
        api.setTool(t.id);
        bar.querySelectorAll('.draw-tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      bar.appendChild(btn);
    });

    container.appendChild(bar);
  }

  return { create };
})();
