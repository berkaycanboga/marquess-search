"use client";

import { useMemo, useState } from "react";
import { formatTRY } from "@/lib/format";
import type { FlatVariant } from "@/lib/normalize";

export function ComparisonTable({
  variants,
  unitLabel,
}: {
  variants: FlatVariant[];
  unitLabel: "gr" | "ml";
}) {
  const qualities = useMemo(() => {
    const set = new Set<string>();
    for (const v of variants) if (v.quality) set.add(v.quality);
    return Array.from(set);
  }, [variants]);

  const [activeQuality, setActiveQuality] = useState<string | null>(null);
  const filtered = activeQuality ? variants.filter((v) => v.quality === activeQuality) : variants;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      {qualities.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <FilterChip label="Tümü" active={activeQuality === null} onClick={() => setActiveQuality(null)} />
          {qualities.map((q) => (
            <FilterChip key={q} label={q} active={activeQuality === q} onClick={() => setActiveQuality(q)} />
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Ürün</th>
              <th className="px-4 py-3 font-medium">Kaynak</th>
              <th className="px-4 py-3 font-medium">Seçenek</th>
              <th className="px-4 py-3 font-medium">Kalite</th>
              <th className="px-4 py-3 font-medium text-right">Fiyat</th>
              <th className="px-4 py-3 font-medium text-right">₺/{unitLabel}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v, i) => {
              const unitPrice = unitLabel === "gr" ? v.pricePerGram : v.pricePerMl;
              return (
                <tr
                  key={`${v.productId}-${v.label}-${v.price}-${i}`}
                  className={"border-b border-border last:border-0 " + (i === 0 ? "bg-accent/5" : "")}
                >
                  <td className="max-w-[220px] truncate px-4 py-3">
                    <a
                      href={v.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground hover:text-accent hover:underline"
                    >
                      {v.productName}
                    </a>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{v.sourceLabel}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{v.label}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{v.quality ?? "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-foreground">{formatTRY(v.price)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-foreground">
                    {unitPrice != null ? formatTRY(unitPrice) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border text-muted hover:border-accent hover:text-accent")
      }
    >
      {label}
    </button>
  );
}
