# Esans Fiyat Karşılaştırma

"Imagination" ve benzeri esansları üç kaynaktan (esans.com.tr, Felicita
Fragrances, John Lucas / Shopier) aynı anda arayıp ₺/gram bazında karşılaştıran
Next.js uygulaması. Kaynakların URL/API yapısı için bkz.
[`docs/site-scraping-notes.md`](docs/site-scraping-notes.md).

## Çalıştırma

```bash
npm install
npm run dev
```

<http://localhost:3000> adresini açın, arama kutusuna bir esans adı yazın
(örn. `imagination`). Sonuçlar `/?q=...` URL'i ile paylaşılabilir/bookmark'lanabilir.

`npm run build && npm run start` production modu için.

## Mimari

```
app/
  page.tsx              search UI + sonuç ekranı (server component, ?q= okur)
  api/compare/route.ts  aynı mantığı JSON olarak sunan uç nokta (5 dk TTL cache)
components/              SearchBar, kıyaslama tablosu, kaynak kartları vs.
lib/
  types.ts               ortak veri modeli (ProductVariant, SourceResult, ...)
  format.ts               TL/gram parse+format yardımcıları
  http.ts                  fetch+timeout, Shopier için cookie jar
  htmlVariants.ts          esans.com.tr + Shopier ürün sayfaları için ortak,
                           site-agnostik varyant çıkarma stratejileri
  normalize.ts             kaynaklardan gelen sonuçları tek listede birleştirme
  sources/esans.ts         esans.com.tr — düz HTML + JSON-LD parse
  sources/felicita.ts      Felicita — api.felicitafragrances.com REST client
  sources/shopier.ts       Shopier — cookie/Referer akışı + esnek JSON parse
scripts/inspect.mjs        canlı bir URL'in HTML/JSON yapısını dökmek için
                           bağımsız teşhis aracı (bkz. aşağıda)
```

Üç kaynak `lib/sources/index.ts` üzerinden paralel (`Promise.allSettled`)
çağrılır; her istemci kendi hatasını yakalar ve `SourceResult.ok=false` olarak
döner, tek bir kaynağın çökmesi diğerlerini etkilemez.

**Gram vs. ml:** esans.com.tr ve Felicita saf esansı gram bazlı satıyor,
Shopier'deki (John Lucas) mağaza ise bitmiş/dilüe parfümü ml bazlı satıyor.
Bu iki birim yoğunluk bilgisi olmadan doğru şekilde birbirine çevrilemez, bu
yüzden uygulama bunları ayrı tablolarda gösterir ve otomatik ₺/gram ↔ ₺/ml
kıyaslaması **yapmaz**.

## ÖNEMLİ — bu kod canlı sitelere karşı doğrulanamadı

Bu proje, bu ortamda (kurumsal egress proxy) esans.com.tr,
api.felicitafragrances.com ve shopier.com'a doğrudan ağ erişimi mümkün
olmadığı için **canlı HTML/JSON çıktısı görülmeden**, yalnızca elle çıkarılmış
teknik notlara dayanarak yazıldı. Şunlar gerçek ağınız olan bir makineden
doğrulanmalı:

1. **esans.com.tr** — arama sayfası JSON-LD `Product` şeması içeriyorsa
   (`lib/sources/esans.ts` → `extractCardsFromJsonLd`) sorunsuz çalışır;
   içermiyorsa heuristik CSS taramasına (`extractCardsHeuristically`) düşer,
   bu daha kırılgandır. Ürün detay sayfasındaki gram/kalite tablosu için
   aynı şekilde JSON-LD → `data-*` → genel liste-eleman taraması sırasıyla
   denenir (`htmlVariants.ts`).
2. **Felicita** — API şekli notlarda tam olarak verildiği için bu kaynağın
   çalışma ihtimali en yüksek.
3. **Shopier** — arama endpoint'inin **gerçek response şekli notlarda yoktu**
   (sadece request formatı reverse-engineer edilmişti). `shopier.ts` birkaç
   olası JSON şeklini dener (`result`/`data`/`products`/Elasticsearch
   `hits.hits`); gerçek cevap bunlardan biri değilse `findCandidateArrays`/
   `normalizeShopierItem` fonksiyonlarını gerçek veriye göre güncelleyin.
   Cookie/Referer/Origin akışı da hâlâ 403/404 dönerse notlardaki gibi
   headless browser (Playwright, ki bu ortamda zaten kurulu) fallback'ine
   geçmek gerekebilir — bilinçli olarak eklenmedi, sonuç kalitesi
   doğrulanamadan bir "her zaman çalışır" görünümü vermemek için.

### Teşhis aracı

```bash
npm run inspect -- "https://www.esans.com.tr/arama?q=imagination"
npm run inspect -- "https://www.esans.com.tr/fragrance-s08369"
npm run inspect -- "https://www.shopier.com/s/api/v1/search_product/jlfragrances" \
  --post "search_query=imagination&username=jlfragrances&search_as_you_type=true&highlight=" \
  --referer "https://www.shopier.com/jlfragrances"
```

Bu komut JSON-LD bloklarını, `data-price`/`data-fiyat` elemanlarını, "gram"+
"fiyat" geçen `<script>` bloklarını ve TL/₺ içeren liste elemanlarını
ekrana döker — parser'ları gerçek markup'a göre ayarlamak için başlangıç
noktası budur.

## Diğer notlar

- `lib/cache.ts` — `/api/compare` için 5 dakikalık bellek-içi TTL cache;
  hem tekrar aramaları hızlandırır hem de kaynak sitelere gereksiz yük
  bindirmeyi azaltır (esans.com.tr rate limit uyarısı, Shopier'in bot
  koruması için).
- esans.com.tr için arama sonucundaki ilk 5 üründe detay sayfası
  (tam gram/kalite tablosu) ayrıca çekilir; istekler arası ~700ms bekleme
  var (nezaket/rate-limit için). Sonraki ürünler yalnızca liste fiyatıyla
  gösterilir.
- `next/font/google` kasıtlı olarak kullanılmadı — build sırasında internete
  çıkmayan, sistem font stack'ine (`font-serif`/`font-sans`) dayanan bir
  tasarım tercih edildi; kısıtlı ağ ortamlarında da güvenilir build alınır.
