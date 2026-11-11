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
    Haptics: {}
  }
};

export default config;
