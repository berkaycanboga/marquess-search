export function ResultsSkeleton() {
  return (
    <div className="animate-pulse space-y-10">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-36 rounded-full bg-surface-muted" />
        ))}
      </div>
      <div className="h-32 rounded-2xl bg-surface-muted" />
      <div className="h-64 rounded-2xl bg-surface-muted" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 rounded-2xl bg-surface-muted" />
        ))}
      </div>
    </div>
  );
}
