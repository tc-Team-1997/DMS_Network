import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';
import { registerServiceWorker } from './lib/sw-register';

// Register Service Worker for offline sync (BHU-57).
// Gated by VITE_FF_OFFLINE_SYNC env flag — no-op when flag is off.
void registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
