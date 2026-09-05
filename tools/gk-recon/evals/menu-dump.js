(() => {
  const cands = [...document.querySelectorAll('[role="menu"], .context-menu, .gk-menu, .dropdown-menu, [class*="context-menu"], [class*="ContextMenu"], [class*="menu"]')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 60 && b.height > 40 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; });
  if (!cands.length) return 'no visible menu found';
  const roots = cands.filter(e => !cands.some(o => o !== e && o.contains(e)));
  return roots.map(r => {
    const b = r.getBoundingClientRect(); const cs = getComputedStyle(r);
    const items = [...r.querySelectorAll('[role="menuitem"], li, .menu-item, [class*="menu-item"], [class*="MenuItem"]')].filter(i => i.getBoundingClientRect().height > 8 && ![...i.querySelectorAll('[role="menuitem"], li, .menu-item')].length);
    return `menu <${r.tagName.toLowerCase()}.${(r.className || '').toString().split(/\s+/).slice(0, 6).join('.')}> ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)} bg=${cs.backgroundColor} border=${cs.border} radius=${cs.borderRadius} shadow=${cs.boxShadow.slice(0, 70)} font=${cs.fontSize} pad=${cs.padding}\nitems(${items.length}):\n` + items.map(i => { const ib = i.getBoundingClientRect(); const ics = getComputedStyle(i); return `  [${Math.round(ib.height)}px] ${i.innerText.replace(/\s+/g, ' ').trim().slice(0, 70)}${i.querySelector('svg') ? ' (icon)' : ''}${/submenu|has-children|caret|chevron/i.test(i.className + i.innerHTML) ? ' >' : ''}${ics.opacity !== '1' || i.getAttribute('aria-disabled') === 'true' || /disabled/.test(i.className) ? ' (disabled)' : ''}`; }).join('\n') + `\n\nraw text:\n${r.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500)}`;
  }).join('\n\n');
})()
