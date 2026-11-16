'use client';
import { useEffect } from 'react';

/** Registers /sw.js for the scorecard pages only (scope /c/), so a reload works offline. */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/c/' }).catch(() => {});
  }, []);
  return null;
}
