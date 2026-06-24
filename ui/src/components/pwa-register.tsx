'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWARegister() {
  const [showInstall, setShowInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Unregister service worker and purge caches in development mode to prevent stale assets
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'development') {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister().then((success) => {
              if (success) {
                console.log('[PWA] Stale development service worker unregistered successfully.');
              }
            });
          }
        });

        // Also clear all cache storage to ensure hot module reloading works perfectly
        if ('caches' in window) {
          window.caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => window.caches.delete(key)));
          }).then(() => {
            console.log('[PWA] Development caches purged successfully.');
          }).catch((err) => {
            console.warn('[PWA] Failed to clear caches:', err);
          });
        }
      } else {
        // Register service worker in production
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('SW registered', reg.scope);
            setInterval(() => reg.update(), 60_000);
          })
          .catch((err) => console.warn('SW registration failed:', err));
      }
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (typeof window !== 'undefined' && !sessionStorage.getItem('factory-pwa-dismissed')) {
        setShowInstall(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setShowInstall(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('factory-pwa-dismissed', 'true');
    }
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (!showInstall) return null;

  return (
    <div className="fixed bottom-16 right-4 z-50 md:bottom-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-xl backdrop-blur-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium">Install Factory</p>
          <p className="text-xs text-muted-foreground">Add to home screen</p>
        </div>
        <button
          onClick={handleInstall}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Install
        </button>
        <button
          onClick={() => {
            setShowInstall(false);
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('factory-pwa-dismissed', 'true');
            }
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          x
        </button>
      </div>
    </div>
  );
}
