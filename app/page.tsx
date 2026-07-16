import { Suspense } from "react";
import { SearchBar } from "@/components/SearchBar";
import { CompareResults } from "@/components/CompareResults";
import { ResultsSkeleton } from "@/components/ResultsSkeleton";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-10 text-center sm:py-14">
          <p className="text-xs font-medium tracking-[0.3em] text-accent uppercase">Marquess Search</p>
          <h1 className="mt-3 font-serif text-3xl text-foreground sm:text-4xl">Esans Fiyat Karşılaştırma</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
            esans.com.tr, Felicita Fragrances ve John Lucas (Shopier) üzerinden aynı anda arama yaparak
            ₺/gram bazında en uygun esansı bulun.
          </p>
          <div className="mt-8">
            <SearchBar initialQuery={query} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {query ? (
          <Suspense key={query} fallback={<ResultsSkeleton />}>
            <CompareResults query={query} />
          </Suspense>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted">
            Aramak istediğiniz esansın adını yazın — üç kaynak paralel olarak sorgulanır.
          </div>
        )}
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted">
        Fiyatlar kaynak sitelerden anlık çekilir, KDV durumu ve stok bilgisi kaynağa göre değişebilir.
      </footer>
    </div>
  );
}
