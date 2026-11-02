import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './work.css'
import './answer.css'
import './board.css'
import './sim.css'
import AuthGate from './auth/AuthGate.tsx'
import type { LegalDoc } from './legal/content'
import { storedTheme } from './settings/bridge'
import { isNativeApp } from './back'

document.documentElement.dataset.theme = storedTheme()
if (isNativeApp()) document.documentElement.classList.add('native')

// Boards and notes live in this browser's storage; ask it not to clear them when space runs low.
void navigator.storage?.persist?.().catch(() => {})

// A public link to a shared board (/s/<id>) opens it read-only, with no sign-in.
const ShareView = lazy(() => import('./share/ShareView'))
const shared = /^\/s\/([A-Za-z0-9_-]{22})\/?$/.exec(location.pathname)?.[1]

// /terms and /privacy are public pages, for anyone who wants to read them before signing in.
const LegalPage = lazy(() => import('./legal/LegalPage'))
const legal = /^\/(terms|privacy)\/?$/.exec(location.pathname)?.[1] as LegalDoc | undefined

// In the Android app a shared-board link opens the app (an App Link), but the app starts at
// its home address: the link it was opened with is followed here instead. The board opens
// read-only, and "Make a copy" there is what lets it be edited — as the viewer's own slate.
if (isNativeApp() && !shared) {
  void import('@capacitor/app')
    .then(async ({ App }) => {
      const follow = (url?: string) => {
        if (!url) return
        try {
          const path = new URL(url).pathname
          if (/^\/s\/[A-Za-z0-9_-]{22}\/?$/.test(path) && location.pathname !== path) location.href = path
        } catch {
          // not a link we open
        }
      }
      follow((await App.getLaunchUrl().catch(() => null))?.url)
      void App.addListener('appUrlOpen', ({ url }) => follow(url))
    })
    .catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shared ? (
      <Suspense fallback={null}>
        <ShareView id={shared} />
      </Suspense>
    ) : legal ? (
      <Suspense fallback={null}>
        <LegalPage doc={legal} />
      </Suspense>
    ) : (
      <AuthGate />
    )}
  </StrictMode>,
)
