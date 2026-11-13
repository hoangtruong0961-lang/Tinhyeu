import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bachtranlastor.app',
  appName: 'BachTranlastor',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    Device: {},
    App: {},
    Haptics: {},
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK'
    }
  }
};

export default config;
