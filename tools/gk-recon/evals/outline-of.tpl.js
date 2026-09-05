(() => {
  const root = document.querySelector('__SEL__'); if (!root) return 'missing __SEL__';
  const out = [];
  function own(el) { return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 50); }
  function walk(el, d, max) {
    if (d > max || out.length > 500) return;
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const kids = [...el.children];
    const t = own(el); const tid = el.getAttribute('data-testid');
    out.push(`${'  '.repeat(d)}<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 7).join('.') : ''}${tid ? ' [' + tid + ']' : ''}> ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}${t ? ' "' + t + '"' : ''}${el.tagName === 'svg' ? ' ' + (el.getAttribute('class') || '') : ''}${kids.length > 6 ? ' (' + kids.length + ' kids, showing 3)' : ''}`);
    for (const k of (kids.length > 6 ? kids.slice(0, 3) : kids)) walk(k, d + 1, max);
  }
  walk(root, 0, 14);
  return out.join('\n');
})()
