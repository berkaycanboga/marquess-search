import { formatTRY } from "@/lib/format";
import type { FlatVariant } from "@/lib/normalize";

export function BestValueBanner({ best }: { best: FlatVariant }) {
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-6">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">En iyi ₺/gram</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-3xl text-foreground">{formatTRY(best.pricePerGram!)}</span>
        <span className="text-sm text-muted">/ gram</span>
      </div>
      <p className="mt-2 text-sm text-foreground">
        {best.productName}
        {best.quality ? (
          <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">{best.quality}</span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-muted">
        {best.sourceLabel} · {best.label} · toplam {formatTRY(best.price)}
      </p>
      <a
        href={best.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
      >
        Ürüne git →
      </a>
    </div>
  );
}
