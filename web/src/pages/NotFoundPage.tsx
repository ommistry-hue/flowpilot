import { Compass, TriangleAlert } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { EmptyState } from '@/components/States'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you are looking for does not exist or was moved."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  )
}

export function RouteErrorPage() {
  const err = useRouteError()
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Unknown error'
  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <EmptyState
        icon={<TriangleAlert />}
        title="Something broke"
        description={message}
        action={
          <Button variant="secondary" size="sm" onClick={() => location.assign('/')}>
            Reload app
          </Button>
        }
      />
    </div>
  )
}
