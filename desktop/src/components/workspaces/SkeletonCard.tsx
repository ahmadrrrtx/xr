/* Phase 10 — loading placeholder matching the card silhouette. */
import { Skeleton } from '@/components/ui/skeleton';

export function SkeletonCard() {
  return (
    <div
      data-testid="workspace-skeleton"
      className="border-border-subtle flex h-[164px] flex-col overflow-hidden rounded-xl border"
    >
      <div className="bg-bg-raised h-1 w-full" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="size-5" />
        </div>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
        <div className="mt-auto flex gap-1">
          <Skeleton className="h-[18px] w-12" />
          <Skeleton className="h-[18px] w-12" />
        </div>
      </div>
    </div>
  );
}
