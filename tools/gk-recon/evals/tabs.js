(() => [...document.querySelectorAll('.tabs-bar .tab')].map((t, i) => i + ':' + t.innerText.replace(/\s+/g, ' ').trim()).join(' | '))()
