import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Toaster, toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { AppShell } from '@/components/layout/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTheme } from '@/lib/theme'
import { DashboardPage } from '@/pages/DashboardPage'
import { NotFoundPage, RouteErrorPage } from '@/pages/NotFoundPage'

const WorkflowsPage = lazy(() => import('@/pages/WorkflowsPage'))
const DesignerPage = lazy(() => import('@/pages/DesignerPage'))
const RunsPage = lazy(() => import('@/pages/RunsPage'))
const RunDetailPage = lazy(() => import('@/pages/RunDetailPage'))
const ApprovalsPage = lazy(() => import('@/pages/ApprovalsPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An unreachable server is not a failure to show: the query pauses while the connection
      // monitor reports offline and resumes once it is back (see api/connection.ts).
      retry: (count, err) => {
        if (err instanceof ApiError && err.isNetwork) return true
        return !(err instanceof ApiError && (err.status === 404 || err.status === 401)) && count < 1
      },
      retryDelay: (count) => Math.min(1000 * 2 ** count, 15_000),
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      toast.error(errorMessage(err))
    },
  }),
})

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workflows', element: page(<WorkflowsPage />) },
      { path: 'workflows/:id', element: page(<DesignerPage />) },
      { path: 'runs', element: page(<RunsPage />) },
      { path: 'runs/:id', element: page(<RunDetailPage />) },
      { path: 'approvals', element: page(<ApprovalsPage />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

function ThemedToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans !rounded-lg !border-border !shadow-elevated' } }}
    />
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <ThemedToaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
