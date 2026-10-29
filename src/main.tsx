import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { restoreAutosave, startAutosave } from './io/files';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Wait a frame so the canvas has measured itself before fitting the view.
requestAnimationFrame(() => {
  restoreAutosave();
  startAutosave();
});
