(() => {
  const g = document.querySelector('.gk-graph') || document.querySelector('.graph-container') || document.querySelector('.inner-right-panel');
  if (!g) return 'no graph root found';
  const out = [];
  out.push('root: ' + g.tagName + '.' + g.className);
  const r = g.getBoundingClientRect(); out.push(`rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  // class histogram inside graph
  const hist = {}; g.querySelectorAll('*').forEach(e => { if (typeof e.className === 'string') e.className.split(/\s+/).filter(Boolean).forEach(c => hist[c] = (hist[c] || 0) + 1); });
  out.push('elements: ' + g.querySelectorAll('*').length + ' svg: ' + g.querySelectorAll('svg').length + ' canvas: ' + g.querySelectorAll('canvas').length + ' img: ' + g.querySelectorAll('img').length);
  out.push('top classes: ' + Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 120).map(([k, v]) => k + '(' + v + ')').join(' '));
  // outline to depth 7 with full class names, collapsing repeated siblings
  function walk(el, d, max) {
    if (d > max || out.length > 400) return;
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const kids = [...el.children];
    out.push(`${'  '.repeat(d)}<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}> ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)} ${cs.display}${cs.position !== 'static' ? ' ' + cs.position : ''}${cs.transform !== 'none' ? ' tf:' + cs.transform : ''}${kids.length > 4 ? ' (' + kids.length + ' kids, showing 3)' : ''}`);
    for (const k of (kids.length > 4 ? kids.slice(0, 3) : kids)) walk(k, d + 1, max);
  }
  out.push('\n--- outline ---'); walk(g, 0, 9);
  // one row's outerHTML, text redacted, trimmed
  const row = g.querySelector('[class*="row"]:not([class*="rows"])');
  if (row) {
    const clone = row.cloneNode(true);
    clone.querySelectorAll('*').forEach(e => { for (const n of [...e.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = '…'; if (e.tagName === 'path') e.setAttribute('d', '…'); if (e.tagName === 'IMG') e.setAttribute('src', '…'); });
    out.push('\n--- first row outerHTML (text redacted) ---'); out.push(clone.outerHTML.slice(0, 4000));
    const rcs = getComputedStyle(row); out.push(`\nrow computed: h=${rcs.height} font=${rcs.fontSize}/${rcs.lineHeight} bg=${rcs.backgroundColor} color=${rcs.color}`);
  }
  // svg samples inside graph: sizes and what they draw
  out.push('\n--- svg samples ---');
  [...g.querySelectorAll('svg')].slice(0, 6).forEach(s => { const b = s.getBoundingClientRect(); out.push(`svg ${Math.round(b.width)}x${Math.round(b.height)} viewBox=${s.getAttribute('viewBox')} children=${[...s.children].map(c => c.tagName).join(',')} class=${s.getAttribute('class')} parent=${s.parentElement.className}`); });
  return out.join('\n');
})()
