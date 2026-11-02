import type { CapacitorConfig } from '@capacitor/cli';

// The Android app loads the hosted web app (set CAPACITOR_SERVER_URL to your own deployment),
// so it gets every web release without a store update; `dist` is copied in as the page shown if
// the site can't be reached at start. Without the variable it runs the bundled `dist` alone,
// which can sign in to Firebase but cannot reach a Slate API — set the variable for a real build.
// Change appId and appName before publishing your own build.
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'org.slate.app',
  appName: 'Slate',
  webDir: 'dist',
  server: serverUrl
    ? { url: serverUrl, androidScheme: 'https', errorPath: 'offline.html' }
    : { androidScheme: 'https' },
  android: {
    backgroundColor: '#1c1c1e',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#1c1c1e',
      showSpinner: false,
      androidScaleType: 'CENTER_INSIDE',
    },
    StatusBar: {
      backgroundColor: '#1c1c1e',
      style: 'DARK',
      overlaysWebView: false,
    },
    FirebaseAuthentication: {
      // Google sign-in runs natively; the web Firebase SDK then signs in with the returned token,
      // so the rest of the app keeps using the same `auth` object as on the web.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
