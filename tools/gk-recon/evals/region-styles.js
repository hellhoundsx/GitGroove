(() => {
  const sels = ['.title-bar', '.tabs-bar .tab', '.tabs-bar .tab.selected', '.toolbar .upper', '.toolbar .btn-toolbar button.btn', '.bread-crumb', '.left-panel', '.ref-panel-container', '.inner-right-panel', '.gk-graph', '.detail-panel', '.status-bar', 'button.btn-success', 'button.btn-default', 'button.btn-primary', '.btn-link', 'input', 'input[type=text]', '.scrollbar-bg0', '.panel-bg0', '.collapsible-panel-header', '.commit-row', '.commit-message-input', '.graph-header', 'select', '.zoom-select', '.tier-label', '.quick-focus-launcher', 'body'];
  const props = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'background-image', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-radius', 'box-shadow', 'height', 'min-height', 'padding', 'margin', 'opacity', 'cursor', 'text-transform'];
  const res = {};
  for (const s of sels) {
    const el = document.querySelector(s); if (!el) { res[s] = null; continue; }
    const cs = getComputedStyle(el); const o = {}; for (const p of props) { const v = cs.getPropertyValue(p); if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)') o[p] = v; }
    const b = el.getBoundingClientRect(); o._rect = `${Math.round(b.width)}x${Math.round(b.height)}`; o._count = document.querySelectorAll(s).length;
    res[s] = o;
  }
  // histogram of font sizes and colors across visible elements
  const fs = {}, col = {}, bg = {};
  document.querySelectorAll('body *').forEach(e => { const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return; const cs = getComputedStyle(e); fs[cs.fontSize] = (fs[cs.fontSize] || 0) + 1; col[cs.color] = (col[cs.color] || 0) + 1; if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bg[cs.backgroundColor] = (bg[cs.backgroundColor] || 0) + 1; });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 18);
  return JSON.stringify({ regions: res, fontSizes: top(fs), textColors: top(col), backgrounds: top(bg) }, null, 1);
})()
