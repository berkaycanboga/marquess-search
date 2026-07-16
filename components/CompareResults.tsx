import { searchAllSources } from "@/lib/sources";
import { flattenVariants, gramComparableVariants, mlComparableVariants } from "@/lib/normalize";
import { SourceStatusBar } from "./SourceStatusBar";
import { BestValueBanner } from "./BestValueBanner";
import { SourceCard } from "./SourceCard";
import { ComparisonTable } from "./ComparisonTable";

export async function CompareResults({ query }: { query: string }) {
  const sources = await searchAllSources(query);
  const flat = flattenVariants(sources);
  const gramVariants = gramComparableVariants(flat);
  const mlVariants = mlComparableVariants(flat);
  const totalProducts = sources.reduce((n, s) => n + s.products.length, 0);

  return (
    <div className="space-y-10">
      <SourceStatusBar sources={sources} />

      {totalProducts === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted">
          &ldquo;{query}&rdquo; için hiçbir kaynakta sonuç bulunamadı.
        </div>
      ) : (
        <>
          {gramVariants.length > 0 && <BestValueBanner best={gramVariants[0]} />}

          {gramVariants.length > 0 && (
            <section>
              <h2 className="font-serif text-xl text-foreground">Gram Bazlı Karşılaştırma</h2>
              <p className="mb-4 text-sm text-muted">
                esans.com.tr ve Felicita Fragrances — saf esans, en düşük ₺/gram önde.
              </p>
              <ComparisonTable variants={gramVariants} unitLabel="gr" />
            </section>
          )}

          {mlVariants.length > 0 && (
            <section>
              <h2 className="font-serif text-xl text-foreground">Hacim Bazlı Karşılaştırma (ml)</h2>
              <p className="mb-4 text-sm text-muted">
                Shopier — bitmiş/dilüe parfüm, ml bazlı satılıyor. Farklı birim ve yoğunluk nedeniyle
                gram fiyatlarıyla doğrudan kıyaslanamaz, bu yüzden ayrı listelendi.
              </p>
              <ComparisonTable variants={mlVariants} unitLabel="ml" />
            </section>
          )}

          <section>
            <h2 className="mb-4 font-serif text-xl text-foreground">Kaynak Bazında Sonuçlar</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((s) => (
                <SourceCard key={s.source} result={s} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
