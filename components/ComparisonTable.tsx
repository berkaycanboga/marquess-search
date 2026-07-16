"use client";

import { useMemo, useState } from "react";
import { formatTRY } from "@/lib/format";
import { groupByProduct, unitPriceOf, type FlatVariant, type ProductGroup, type UnitLabel } from "@/lib/normalize";

export function ComparisonTable({ variants, unitLabel }: { variants: FlatVariant[]; unitLabel: UnitLabel }) {
  const qualities = useMemo(() => {
    const set = new Set<string>();
    for (const v of variants) if (v.quality) set.add(v.quality);
    return Array.from(set);
  }, [variants]);

  const [activeQuality, setActiveQuality] = useState<string | null>(null);

  const groups = useMemo(() => {
    const all = groupByProduct(variants, unitLabel);
    if (!activeQuality) return all;
    return all.filter((g) => g.variants.some((v) => v.quality === activeQuality));
  }, [variants, unitLabel, activeQuality]);

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
              <th className="px-4 py-3 font-medium text-right">Fiyat</th>
              <th className="px-4 py-3 font-medium text-right">₺/{unitLabel}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, i) => (
              <ProductRow
                key={`${group.productId}-${activeQuality ?? "all"}`}
                group={group}
                unitLabel={unitLabel}
                preferredQuality={activeQuality}
                highlight={i === 0}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductRow({
  group,
  unitLabel,
  preferredQuality,
  highlight,
}: {
  group: ProductGroup;
  unitLabel: UnitLabel;
  preferredQuality: string | null;
  highlight: boolean;
}) {
  const options = group.variants;
  const initialIndex = Math.max(
    preferredQuality ? options.findIndex((v) => v.quality === preferredQuality) : 0,
    0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const selected = options[selectedIndex] ?? options[0];
  const unitPrice = unitPriceOf(selected, unitLabel);

  return (
    <tr className={"border-b border-border last:border-0 " + (highlight ? "bg-accent/5" : "")}>
      <td className="max-w-[220px] truncate px-4 py-3">
        <a
          href={group.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:text-accent hover:underline"
        >
          {group.productName}
        </a>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-muted">{group.sourceLabel}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {options.length > 1 ? (
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
          >
            {options.map((v, idx) => (
              <option key={idx} value={idx}>
                {v.label}
                {v.quality ? ` · ${v.quality}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted">
            {selected.label}
            {selected.quality ? ` · ${selected.quality}` : ""}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap text-foreground">{formatTRY(selected.price)}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-foreground">
        {unitPrice != null ? formatTRY(unitPrice) : "—"}
      </td>
    </tr>
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
