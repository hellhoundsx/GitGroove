import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiProvider } from './ui/UiContext';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import './styles/tokens.css';
import './styles/app.css';

// What the main process decided about the window's material (GC-212), read before the first render
// so no frame is painted with the ground filled in over a material that is about to show through.
// Absent means no material, which is every case the stylesheet treats as the ordinary one.
if (new URLSearchParams(location.search).get('material') === 'mica') {
  document.documentElement.dataset.material = 'mica';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>,
);
