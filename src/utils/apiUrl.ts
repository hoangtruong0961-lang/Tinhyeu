import { Capacitor } from '@capacitor/core';
import { getAppSettings } from './settingsStorage';

/**
 * Returns the base URL for backend API requests (yt-dlp, proxy-video, TTS, etc.)
 */
export function getBackendBaseUrl(): string {
  try {
    const settings = getAppSettings();
    if (settings?.backendServerUrl && settings.backendServerUrl.trim()) {
      return settings.backendServerUrl.trim().replace(/\/+$/, '');
    }
  } catch (e) {
    console.debug('[apiUrl] Failed to read appSettings:', e);
  }

  // On Native Mobile (Capacitor APK):
  // Check if user set window.__CUSTOM_BACKEND_URL or localStorage
  if (typeof window !== 'undefined') {
    const cachedUrl = localStorage.getItem('vtranslate_backend_server_url');
    if (cachedUrl && cachedUrl.trim()) {
      return cachedUrl.trim().replace(/\/+$/, '');
    }
  }

  // If on mobile APK without explicit override, use the official deployment
  if (Capacitor.isNativePlatform()) {
    return 'https://thiantai.onrender.com';
  }

  // If on Web / Dev server, relative paths hit the host directly
  return '';
}

/**
 * Resolves an API endpoint path (e.g. '/api/download') with the active backend host
 */
export function resolveApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getBackendBaseUrl();

  if (!baseUrl) {
    return cleanPath;
  }

  return `${baseUrl}${cleanPath}`;
}

/**
 * Checks if the current environment is running standalone native mobile (Capacitor APK)
 */
export function isMobileCapacitor(): boolean {
  return Capacitor.isNativePlatform();
}
