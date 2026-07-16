import type { SourceResult } from "@/lib/types";

const cacheDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatCacheDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : cacheDateFormatter.format(date);
}

export function SourceStatusBar({ sources }: { sources: SourceResult[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => {
        const tone = !s.ok ? "danger" : s.degraded ? "accent" : "success";
        return (
          <div
            key={s.source}
            title={s.error}
            className={
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs " +
              (tone === "danger"
                ? "border-danger/40 bg-danger/10 text-danger"
                : tone === "accent"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-success/40 bg-success/10 text-success")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (tone === "danger" ? "bg-danger" : tone === "accent" ? "bg-accent" : "bg-success")
              }
            />
            <span className="font-medium text-foreground">{s.label}</span>
            <span>
              {s.ok ? (s.degraded ? `${s.products.length} sonuç · kısmi veri` : `${s.products.length} sonuç`) : "erişilemedi"}
            </span>
            {s.cachedAt ? (
              <span className="text-muted">önbellek: {formatCacheDate(s.cachedAt)}</span>
            ) : (
              <span className="text-muted">{s.tookMs}ms</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
