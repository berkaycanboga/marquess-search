"use client";

import { useState } from "react";
import { formatTRY } from "@/lib/format";
import type { ProductResult, SourceResult } from "@/lib/types";

export function SourceCard({ result }: { result: SourceResult }) {
  const tone = !result.ok ? "danger" : result.degraded ? "accent" : "success";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-lg text-foreground">{result.label}</h3>
        <span
          className={
            "h-2 w-2 rounded-full " +
            (tone === "danger" ? "bg-danger" : tone === "accent" ? "bg-accent" : "bg-success")
          }
        />
      </div>

      {!result.ok && <p className="text-sm text-danger">{result.error}</p>}

      {result.ok && result.products.length === 0 && (
        <p className="text-sm text-muted">Bu kaynakta sonuç bulunamadı.</p>
      )}

      <div className="flex flex-col gap-3">
        {result.products.map((p) => (
          <ProductRow key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: ProductResult }) {
  const options = [...product.variants].sort((a, b) => {
    const av = a.pricePerGram ?? a.pricePerMl ?? a.price;
    const bv = b.pricePerGram ?? b.pricePerMl ?? b.price;
    return av - bv;
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = options[selectedIndex];

  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start gap-3">
        <Thumbnail src={product.imageUrl} alt={product.name} />
        <div className="min-w-0 flex-1">
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground hover:text-accent hover:underline"
          >
            {product.name}
          </a>
          {selected && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {options.length > 1 ? (
                <select
                  value={selectedIndex}
                  onChange={(e) => setSelectedIndex(Number(e.target.value))}
                  className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent"
                >
                  {options.map((v, idx) => (
                    <option key={idx} value={idx}>
                      {v.label}
                      {v.quality ? ` · ${v.quality}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted">
                  {selected.label}
                  {selected.quality ? ` · ${selected.quality}` : ""}
                </span>
              )}
              <span className="text-xs font-medium text-foreground">{formatTRY(selected.price)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Thumbnail({ src, alt }: { src?: string; alt: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return <div className="h-11 w-11 shrink-0 rounded-lg bg-surface-muted" aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external hosts, next/image domain allowlisting adds no value here
    <img
      src={src}
      alt={alt}
      className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover"
      onError={() => setError(true)}
    />
  );
}
