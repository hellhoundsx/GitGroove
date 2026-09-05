(() => {
  const out = [];
  const redact = (el) => { const c = el.cloneNode(true); c.querySelectorAll('*').forEach(e => { for (const n of [...e.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = '…'; if (e.tagName === 'path') e.setAttribute('d', '…'); if (e.tagName === 'IMG') e.setAttribute('src', '…'); const st = e.getAttribute('style'); if (st && st.includes('url(')) e.setAttribute('style', st.replace(/url\([^)]*\)/g, 'url(…)')); }); return c.outerHTML; };
  for (const zone of ['#ref-zone', '#commit-zone', '#commit-message-zone']) {
    const z = document.querySelector(zone); if (!z) { out.push(zone + ' missing'); continue; }
    const rows = [...z.querySelectorAll('.graph-row-wrapper')];
    out.push(`\n===== ${zone} rows=${rows.length} zoneRect=${JSON.stringify(z.getBoundingClientRect().toJSON())} scrollH=${z.scrollHeight} =====`);
    rows.slice(0, 3).forEach((r, i) => out.push(`--- row ${i} ---\n` + redact(r).slice(0, 3500)));
  }
  out.push('\n===== computed styles of graph atoms =====');
  for (const s of ['.gk-graph .node', '.gk-graph .commit-node .node', '.gk-graph .color-strip', '.gk-graph .avatar', '.gk-graph .gravatar', '.gk-graph .column-1', '.gk-graph .graph-zone', '.gk-graph .ref-node', '.gk-graph .ref-name', '.gk-graph .ref-icon', '.gk-graph .message-zone--summary', '.gk-graph .message-zone--body', '.gk-graph .commit-bg-color', '.gk-graph .has-active', '.gk-graph .is-selected', '.gk-graph .work-dir-changes', '.gk-graph .graph-row', '.gk-graph .graph-header .text-disabled']) {
    const el = document.querySelector(s); if (!el) { out.push(s + ': (none)'); continue; }
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    const pick = ['width', 'height', 'background-color', 'background-image', 'color', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'border-left', 'box-shadow', 'padding', 'margin', 'left', 'top', 'position', 'opacity', 'text-overflow', 'white-space'].map(p => { const v = cs.getPropertyValue(p); return (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)' && v !== '0px' && v !== 'static' && v !== 'clip' && v !== '1') ? p + '=' + v.replace(/url\([^)]*\)/g, 'url(…)').slice(0, 120) : null; }).filter(Boolean).join(' ');
    out.push(`${s} [${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}] ${pick}`);
  }
  // pseudo-elements on lines?
  const col = document.querySelector('.gk-graph .column-1');
  if (col) for (const pe of ['::before', '::after']) { const cs = getComputedStyle(col, pe); if (cs.content !== 'none') out.push(`.column-1${pe} content=${cs.content} w=${cs.width} h=${cs.height} bg=${cs.backgroundColor} border-left=${cs.borderLeft}`); }
  return out.join('\n');
})()
