// Installable-app support (PWA): service worker registration + install prompt handling.
import { useEffect, useState } from 'react';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function initPwa() {
  // Capture the install prompt as early as possible (it can fire before React mounts).
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; notify(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPhone/iPad Safari has no install prompt; users add the app via Share → "Add to Home Screen".
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  if (isStandalone()) return { mode: 'installed' };
  if (deferredPrompt) {
    return {
      mode: 'prompt',
      async install() {
        const p = deferredPrompt; deferredPrompt = null; notify();
        p.prompt();
        const choice = await p.userChoice.catch(() => null);
        return choice?.outcome === 'accepted';
      },
    };
  }
  if (isIos()) return { mode: 'ios' };
  return { mode: 'none' };
}
