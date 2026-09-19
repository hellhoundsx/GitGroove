import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiProvider } from './ui/UiContext';
// Inter, the app's face since GC-213 and as close to ChatGPT's as Windows can get. The variable
// cut is one file for the whole weight axis, so the 400/500/600 the app uses cost nothing over a
// single static weight — and it carries an optical-size axis, which is what `optical-sizing: auto`
// in `app.css` drives in place of GC-212's three named Segoe cuts. Open Sans stays as the bundled
// fallback: it is still the face a machine without either would otherwise pick for itself.
import '@fontsource-variable/inter';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import './styles/tokens.css';
import './styles/app.css';

// What the main process decided about the window's material (GC-212, GC-213), read before the
// first render so no frame is painted with the ground filled in over a material that is about to
// show through. It arrives on the URL rather than over IPC precisely so it can be read here, at
// module scope, rather than a round trip later. Absent means no material — an older Windows,
// another platform, or the offscreen window an unattended run uses — which is the case the
// stylesheet treats as ordinary.
if (new URLSearchParams(location.search).get('material') === 'acrylic') {
  document.documentElement.dataset.material = 'acrylic';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>,
);
