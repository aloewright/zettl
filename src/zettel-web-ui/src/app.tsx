import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { HomePage } from '@/pages/home'
import { NotePage } from '@/pages/note'
import { EditorPage } from '@/pages/editor'
import { NotFoundPage } from '@/pages/not-found'
import { CallbackPage } from '@/pages/callback'

/** Wrap a dynamic import so stale-asset 404s trigger a full page reload. */
function lazyWithReload<T extends Record<string, unknown>>(
  factory: () => Promise<T>,
): Promise<T> {
  return factory().catch((err: unknown) => {
    const alreadyReloaded = sessionStorage.getItem('chunk-reload')
    if (!alreadyReloaded) {
      sessionStorage.setItem('chunk-reload', '1')
      window.location.reload()
    }
    throw err
  })
}

const GraphPage = lazy(() =>
  lazyWithReload(() => import('./pages/graph')).then((m) => ({ default: m.GraphPage })),
)
const InboxPage = lazy(() =>
  lazyWithReload(() => import('./pages/inbox')).then((m) => ({ default: m.InboxPage })),
)
const SettingsPage = lazy(() =>
  lazyWithReload(() => import('./pages/settings')).then((m) => ({ default: m.SettingsPage })),
)
const ContentReviewPage = lazy(() =>
  lazyWithReload(() => import('./pages/content-review')).then((m) => ({ default: m.ContentReviewPage })),
)
const VoiceConfigPage = lazy(() =>
  lazyWithReload(() => import('./pages/voice-config')).then((m) => ({ default: m.VoiceConfigPage })),
)
const VoicePage = lazy(() =>
  lazyWithReload(() => import('./pages/voice')).then((m) => ({ default: m.VoicePage })),
)
const KbHealthPage = lazy(() =>
  lazyWithReload(() => import('./pages/kb-health')).then((m) => ({ default: m.KbHealthPage })),
)
const ResearchPage = lazy(() =>
  lazyWithReload(() => import('./pages/research')).then((m) => ({ default: m.ResearchPage })),
)

// Clear stale-asset reload guard on successful load
sessionStorage.removeItem('chunk-reload')

function LazyFallback() {
  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
    </div>
  )
}

function RouteErrorBoundary() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-medium">Something went wrong</p>
      <p className="text-sm text-muted-foreground">
        A new version may have been deployed. Try refreshing the page.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        Refresh
      </button>
    </div>
  )
}

export const router = createBrowserRouter([
  // Auth callback — outside AppShell, no auth required
  { path: '/callback', element: <CallbackPage /> },
  {
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/notes/:id', element: <NotePage /> },
      { path: '/notes/:id/edit', element: <EditorPage /> },
      { path: '/new', element: <EditorPage /> },
      {
        path: '/inbox',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <InboxPage />
          </Suspense>
        ),
      },
      {
        path: '/settings',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: '/content',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <ContentReviewPage />
          </Suspense>
        ),
      },
      {
        path: '/voice',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <VoicePage />
          </Suspense>
        ),
      },
      {
        path: '/voice-config',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <VoiceConfigPage />
          </Suspense>
        ),
      },
      {
        path: '/graph',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <GraphPage />
          </Suspense>
        ),
      },
      {
        path: '/kb-health',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <KbHealthPage />
          </Suspense>
        ),
      },
      {
        path: '/research',
        element: (
          <Suspense fallback={<LazyFallback />}>
            <ResearchPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
