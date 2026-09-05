(() => {
  const out = [];
  const cls = el => (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
  function walk(el, depth, maxDepth) {
    if (depth > maxDepth || out.length > 700) return;
    const r = el.getBoundingClientRect();
    const zero = r.width < 2 || r.height < 2;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const kids = [...el.children].filter(k => getComputedStyle(k).display !== "none");
    const id = el.id ? '#' + el.id : '';
    const extra = [zero ? "ZERO-SIZE-WRAPPER" : "", cs.display, cs.position !== 'static' ? cs.position : '', cs.overflow !== 'visible' ? 'ov:' + cs.overflow : '', kids.length > 8 ? '(' + kids.length + ' children, showing 2)' : ''].filter(Boolean).join(' ');
    out.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${id}${cls(el)}> @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ${extra}`);
    for (const k of (kids.length > 8 ? kids.slice(0, 2) : kids)) walk(k, depth + 1, maxDepth);
  }
  walk(document.body, 0, 10);
  const head = [
    `viewport ${innerWidth}x${innerHeight} dpr=${devicePixelRatio}`,
    `html attrs: ${[...document.documentElement.attributes].map(a => a.name + '=' + JSON.stringify(a.value)).join(' ')}`,
    `body class: ${document.body.className}`,
    `counts: canvas=${document.querySelectorAll('canvas').length} svg=${document.querySelectorAll('svg').length} iframe/webview=${document.querySelectorAll('iframe,webview').length} button=${document.querySelectorAll('button,[role=button]').length} input=${document.querySelectorAll('input,textarea').length}`,
    `canvases: ${[...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height + cls(c)).join(' | ')}`,
    `stylesheets: ${[...document.styleSheets].map(s => (s.href || '(inline)').split('/').pop() + '[' + (() => { try { return s.cssRules.length } catch { return '?' } })() + ']').join(', ')}`,
  ];
  return head.join('\n') + '\n\n' + out.join('\n');
})()
