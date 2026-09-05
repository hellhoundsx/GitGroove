(() => {
  const vars = {}; const fontFaces = []; let ruleCount = 0;
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules; } catch { continue; }
    const visit = rl => { for (const r of rl) {
      ruleCount++;
      if (r instanceof CSSFontFaceRule) { fontFaces.push(r.cssText.slice(0, 220)); continue; }
      if (r.cssRules && !(r instanceof CSSStyleRule)) { visit(r.cssRules); continue; }
      if (!r.style) continue;
      for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (p.startsWith('--')) (vars[r.selectorText] ||= {})[p] = r.style.getPropertyValue(p).trim(); }
    } };
    visit(rules);
  }
  const b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
  // every custom property currently resolved on <html> and <body>
  const resolved = {};
  for (const sel of Object.keys(vars)) for (const p of Object.keys(vars[sel])) { const v = h.getPropertyValue(p).trim() || b.getPropertyValue(p).trim(); if (v) resolved[p] = v; }
  return JSON.stringify({ ruleCount, selectorsDefiningVars: Object.keys(vars), varCountBySelector: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Object.keys(v).length])), resolvedOnRoot: resolved, definitions: vars, fontFaces, body: { font: b.fontFamily, size: b.fontSize, lineHeight: b.lineHeight, color: b.color, bg: b.backgroundColor }, html: { bg: h.backgroundColor, fontSize: h.fontSize } }, null, 1);
})()
