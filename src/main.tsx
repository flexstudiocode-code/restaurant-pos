import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import { SyncEngine } from './syncEngine';
import App from './App';
import { isDesktop } from './desktop';
import { initDesktopBluetooth } from './desktopBluetooth.tsx';
import { ThermalWidthAutoSync } from './usbThermal';
import './styles.css';

const THEME_KEY = 'nellara-theme';
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') document.documentElement.dataset.theme = 'dark';
} catch {
  /* storage unavailable — default to light theme */
}

// Desktop app: wire the main-process bridges (Bluetooth chooser, sync hub).
initDesktopBluetooth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <SyncEngine />
      <ThermalWidthAutoSync />
      <App />
    </StoreProvider>
  </StrictMode>
);

// Register the service worker in production builds for offline support
// (browser/PWA only — the desktop app loads from disk, no SW needed).
if (!isDesktop() && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
