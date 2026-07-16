"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const SUGGESTIONS = ["Imagination", "Vanilla Sky", "Oud Wood", "Baccarat Rouge"];

export function SearchBar({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  function runSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    startTransition(() => {
      router.push(`/?q=${encodeURIComponent(trimmed)}`);
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(value);
        }}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-2 shadow-sm transition-colors focus-within:border-accent"
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          className="ml-2 h-4 w-4 shrink-0 text-muted"
        >
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Esans adı ara… (örn. Imagination)"
          className="flex-1 bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={isPending || value.trim().length === 0}
          className="shrink-0 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Aranıyor…" : "Karşılaştır"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setValue(s);
              runSearch(s);
            }}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
