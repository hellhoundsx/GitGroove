(() => {
  const out = [];
  const q = (s) => document.querySelector(s);
  const txt = (el, max = 1500) => el ? el.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, max) : '(missing)';
  const attrs = (el) => el ? [...el.querySelectorAll('[title],[aria-label],[data-tooltip],[data-testid]')].map(e => (e.getAttribute('data-testid') ? 'testid=' + e.getAttribute('data-testid') + ' ' : '') + (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('data-tooltip'))).filter(Boolean).slice(0, 60).join(' | ') : '';
  out.push('=== TITLE BAR text ===\n' + txt(q('.title-bar')) + '\nattrs: ' + attrs(q('.title-bar')));
  out.push('\n=== TOOLBAR text ===\n' + txt(q('.top-panel')) + '\nattrs: ' + attrs(q('.top-panel')));
  out.push('\n=== TOOLBAR buttons ===\n' + [...document.querySelectorAll('.top-panel button')].map(b => { const r = b.getBoundingClientRect(); return `[${b.innerText.replace(/\n/g, ' ').trim() || '(icon)'} ${Math.round(r.width)}x${Math.round(r.height)} ${b.disabled ? 'disabled' : ''} cls=${b.className}]`; }).join('\n'));
  out.push('\n=== LEFT PANEL text ===\n' + txt(q('.left-panel'), 2500) + '\nattrs: ' + attrs(q('.left-panel')));
  out.push('\n=== GRAPH HEADER text ===\n' + txt(q('.graph-header') || q('.gk-graph [class*=header]')));
  out.push('\n=== DETAIL PANEL text ===\n' + txt(q('.detail-panel'), 2500) + '\nattrs: ' + attrs(q('.detail-panel')));
  out.push('\n=== STATUS BAR text ===\n' + txt(q('.status-bar')) + '\nattrs: ' + attrs(q('.status-bar')));
  out.push('\n=== data-testid inventory (all) ===\n' + [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].slice(0, 200).join(', '));
  out.push('\n=== all button labels (deduped) ===\n' + [...new Set([...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(' | '));
  return out.join('\n');
})()
