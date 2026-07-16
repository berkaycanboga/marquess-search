"use client";

import { useState } from "react";
import { formatTRY } from "@/lib/format";
import type { ProductResult, ProductVariant, SourceResult } from "@/lib/types";

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
  const [open, setOpen] = useState(false);
  const cheapest = cheapestVariant(product.variants);

  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Thumbnail src={product.imageUrl} alt={product.name} />
          <div>
            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-foreground hover:text-accent hover:underline"
            >
              {product.name}
            </a>
            {cheapest && (
              <p className="mt-1 text-xs text-muted">
                en düşük: {formatTRY(cheapest.price)} · {cheapest.label}
                {cheapest.quality ? ` · ${cheapest.quality}` : ""}
              </p>
            )}
          </div>
        </div>
        {product.variants.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-xs whitespace-nowrap text-accent hover:underline"
          >
            {open ? "gizle" : `${product.variants.length} seçenek`}
          </button>
        )}
      </div>

      {open && (
        <ul className="mt-3 space-y-1 border-t border-border/70 pt-3 text-xs">
          {product.variants.map((v, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-muted">
              <span>
                {v.label}
                {v.quality ? ` · ${v.quality}` : ""}
              </span>
              <span className="whitespace-nowrap text-foreground">{formatTRY(v.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cheapestVariant(variants: ProductVariant[]): ProductVariant | undefined {
  if (variants.length === 0) return undefined;
  return [...variants].sort((a, b) => {
    const av = a.pricePerGram ?? a.pricePerMl ?? a.price;
    const bv = b.pricePerGram ?? b.pricePerMl ?? b.price;
    return av - bv;
  })[0];
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
