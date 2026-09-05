(() => {
  const out = [];
  const redact = (el) => { const c = el.cloneNode(true); c.querySelectorAll('*').forEach(e => { for (const n of [...e.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = '…'; if (e.tagName === 'path') e.setAttribute('d', '…'); if (e.tagName === 'IMG') e.setAttribute('src', '…'); const st = e.getAttribute('style'); if (st && st.includes('url(')) e.setAttribute('style', st.replace(/url\([^)]*\)/g, 'url(…)')); if (e.hasAttribute('title')) e.setAttribute('title', '…'); }); return c.outerHTML; };
  for (const zone of ['#ref-zone', '#commit-zone']) {
    const z = document.querySelector(zone); const inner = z && z.querySelector('.ReactVirtualized__Grid__innerScrollContainer');
    if (!inner) { out.push(zone + ' missing inner'); continue; }
    const cells = [...inner.children];
    const hist = {}; z.querySelectorAll('*').forEach(e => { if (typeof e.className === 'string') e.className.split(/\s+/).filter(Boolean).forEach(c => hist[c] = (hist[c] || 0) + 1); });
    out.push(`\n===== ${zone}: cells=${cells.length} tags=${[...new Set([...z.querySelectorAll('*')].map(e => e.tagName))].join(',')}`);
    out.push('classes: ' + Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => k + '(' + v + ')').join(' '));
    cells.slice(0, 4).forEach((c, i) => out.push(`--- cell ${i} ---\n` + redact(c).slice(0, 3000)));
  }
  // any element in the graph that has a background-image gradient or border used as a line
  const lines = [...document.querImageerySelectorAll ? [] : []];
  const cand = [...document.querySelectorAll('#commit-zone *')].filter(e => { const cs = getComputedStyle(e); return cs.backgroundImage.includes('gradient') || (cs.borderLeftWidth !== '0px' && cs.borderLeftStyle !== 'none' && cs.borderLeftStyle !== 'hidden') || cs.borderTopWidth !== '0px' && cs.borderTopStyle === 'solid'; });
  out.push(`\n===== line-like elements in #commit-zone: ${cand.length}`);
  cand.slice(0, 8).forEach(e => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); out.push(`<${e.tagName.toLowerCase()}.${(e.className || '').toString().split(/\s+/).join('.')}> ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)} bl=${cs.borderLeft} bt=${cs.borderTop} br=${cs.borderRadius} bgimg=${cs.backgroundImage.slice(0, 80)} bg=${cs.backgroundColor}`); });
  return out.join('\n');
})()
