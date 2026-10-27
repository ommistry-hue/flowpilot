import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useWorkflow } from '@/api/hooks'
import { ErrorState } from '@/components/States'
import { Skeleton } from '@/components/ui/misc'
import { Designer } from '@/features/designer/Designer'
import { emptyDefinition } from '@/features/designer/model'

function DesignerSkeleton() {
  return (
    <div className="flex h-full">
      <div className="w-[260px] space-y-2 border-r bg-sidebar p-3">
        <Skeleton className="h-8" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
      <div className="relative flex-1 bg-canvas bg-dots">
        <Skeleton className="absolute top-1/3 left-1/4 h-20 w-60 rounded-xl" />
        <Skeleton className="absolute top-1/3 left-1/2 h-24 w-60 rounded-xl" />
      </div>
      <div className="w-[340px] space-y-3 border-l bg-sidebar p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-16" />
      </div>
    </div>
  )
}

export default function DesignerPage() {
  const { id = 'new' } = useParams()
  const [params] = useSearchParams()
  const [adoptedId, setAdoptedId] = useState<string | null>(null)
  const [blank] = useState(emptyDefinition)
  const isNew = id === 'new'
  const adopted = !isNew && id === adoptedId
  const query = useWorkflow(isNew || adopted ? undefined : id)

  if (isNew || adopted) {
    return (
      <Designer
        key="new"
        definition={blank}
        workflowId={null}
        publishedVersion={null}
        openAi={params.get('ai') === '1'}
        onCreated={setAdoptedId}
      />
    )
  }
  if (query.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    )
  }
  if (!query.data) return <DesignerSkeleton />
  return (
    <Designer
      key={id}
      definition={query.data.definition}
      workflowId={query.data.id}
      publishedVersion={query.data.publishedVersion ?? null}
      openAi={params.get('ai') === '1'}
      onCreated={setAdoptedId}
    />
  )
}
