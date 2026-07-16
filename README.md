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

Yerelde Shopier'in headless-browser fallback'ini (canlı önbellek-boşsa yolu,
aşağıya bakın) test etmek isterseniz bir kere şunu çalıştırmanız gerekir:

```bash
npx playwright install chromium
```

`scripts/sync-shopier.mjs` (`npm run shopier:sync:headed`) bundan ayrı olarak
makinenizde **gerçek, kurulu bir Google Chrome** ister (`channel: "chrome"`,
Playwright'ın kendi indirdiği Chromium değil) — bkz. "Shopier: cache-first
mimari" bölümü.

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
  browser.ts               Shopier fallback'i için headless Chromium başlatıcı
                           (Vercel'de @sparticuz/chromium, yerelde Playwright'ın
                           kendi kurduğu Chromium; patchright-core kullanır —
                           bkz. aşağıdaki Shopier bölümü)
  shopierCache.ts          data/shopier-products.json'ı okuyup filtreleyen,
                           bayatlık kontrolü yapan cache katmanı
  htmlVariants.ts          esans.com.tr + Shopier ürün sayfaları için ortak,
                           site-agnostik varyant çıkarma stratejileri
  normalize.ts             kaynaklardan gelen sonuçları tek listede birleştirme
  sources/esans.ts         esans.com.tr — düz HTML + JSON-LD parse
  sources/felicita.ts      Felicita — api.felicitafragrances.com REST client
  sources/shopier.ts       Shopier — önce data/shopier-products.json önbelleği
                           (cache-first), yalnızca boş/bayat ise canlı denemeye
                           düşer (düz HTTP → headless browser)
data/shopier-products.json  scripts/sync-shopier.mjs'nin ürettiği, deploy'a
                           dahil edilen Shopier ürün önbelleği (repoya commit
                           edilir — bkz. "Shopier: cache-first mimari" bölümü)
scripts/inspect.mjs        canlı bir URL'in HTML/JSON yapısını dökmek için
                           bağımsız teşhis aracı (bkz. aşağıda)
scripts/sync-shopier.mjs   data/shopier-products.json'ı yerelde, gerçek bir
                           Chrome oturumuyla yeniden üreten bağımsız araç
                           (bkz. "Shopier: cache-first mimari" bölümü)
```

Üç kaynak `lib/sources/index.ts` üzerinden paralel (`Promise.allSettled`)
çağrılır; her istemci kendi hatasını yakalar ve `SourceResult.ok=false` olarak
döner, tek bir kaynağın çökmesi diğerlerini etkilemez.

**Gram vs. ml:** esans.com.tr ve Felicita saf esansı gram bazlı satıyor,
Shopier'deki (John Lucas) mağaza ise bitmiş/dilüe parfümü ml bazlı satıyor.
Bu iki birim yoğunluk bilgisi olmadan doğru şekilde birbirine çevrilemez, bu
yüzden uygulama bunları ayrı tablolarda gösterir ve otomatik ₺/gram ↔ ₺/ml
kıyaslaması **yapmaz**.

## Canlı doğrulama durumu

Bu ortamda (kurumsal egress proxy) esans.com.tr, api.felicitafragrances.com ve
shopier.com'a doğrudan ağ erişimi yok, o yüzden kod büyük ölçüde elle
çıkarılmış teknik notlara dayanarak yazıldı — ama Vercel'e deploy edilip gerçek
ortamda denendi ve şu an bilinen durum:

- ✅ **esans.com.tr** ve **Felicita** — arama sonuçları (isim/fiyat/gram/kalite)
  doğru geliyor.
- ✅ **Felicita ürün linki düzeltildi** — gerçek route (`/products/{id}`)
  kullanıcı tarafından doğrulanıp bildirildi, `felicita.ts` artık buna göre
  link üretiyor.
- ⚠️ **esans.com.tr link + gram/kalite tablosu hâlâ boş çıkıyor** (yalnızca
  "Liste fiyatı" fallback'i görünüyor). Muhtemel sebep: arama sayfasının
  JSON-LD'si `ItemList`+`ListItem` deseninde ve URL, iç içteki `Product`
  değil `ListItem` üzerinde duruyor (düzeltildi — URL artık miras alınıyor),
  ya da site JSON-LD yerine schema.org microdata (`itemprop="url"/"price"`)
  kullanıyor (bunun için de ayrı bir çıkarım stratejisi eklendi). Bunlar
  canlıda doğrulanamadı — hâlâ boş geliyorsa `npm run inspect` çıktısını
  paylaşın, kesin sebebi görüp seçicileri buna göre ayarlarız.
- ⚠️ **Shopier (John Lucas) — Cloudflare Turnstile arkasında, otomatik hiçbir
  yöntem geçemedi.** Denenip elenenler: düz `fetch()` (mağaza sayfası bile 403),
  headless Playwright + manuel JS-özellik stealth yamaları, CDP sızıntısını
  kapatan `patchright-core` fork'u — hepsi "Just a moment..." interstitial'ında
  takıldı. Bu, header/cookie/parmak-izi ayarıyla çözülebilecek bir şey değil;
  Cloudflare gerçek, insan tarafından yürütülen bir tarayıcı istiyor. Bu yüzden
  Shopier artık **cache-first** çalışıyor — bkz. "Shopier: cache-first mimari"
  bölümü. `lib/sources/shopier.ts` içindeki düz HTTP → headless browser zinciri
  hâlâ var (önbellek boş/bayatsa son çare olarak denenir) ama birincil yol değil.

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
ekrana döker — parser'ları/link üretimini gerçek markup'a göre ayarlamak için
başlangıç noktası budur.

## Shopier: cache-first mimari

Shopier'in Cloudflare Turnstile koruması her otomatik yöntemi elemiş durumda
(yukarıdaki "Canlı doğrulama durumu" bölümüne bakın), o yüzden `searchShopier`
her aramada canlı scraping yapmıyor:

1. **Önbellek taze ise** (`data/shopier-products.json`, `updatedAt` 24 saatten
   yeni) — canlı hiçbir istek atılmadan doğrudan önbellekten filtrelenip
   dönülür. Bu, Shopier'in WAF'ına gereksiz yük bindirmemenin asıl amacı.
2. **Önbellek boş veya bayatsa** — canlı deneme (düz HTTP → gerekirse headless
   browser, `lib/sources/shopier.ts`'teki eski zincir) son çare olarak
   çalışır.
3. **Canlı deneme de başarısız olursa** ama eski bir önbellek varsa — o
   önbellek `degraded: true` ile (ve neden bayat olduğunu açıklayan bir
   hata notuyla) yine de gösterilir; hiç sonuç göstermemektense bayat veri
   göstermek tercih edildi.
4. **Ne önbellek ne canlı istek varsa** — Shopier kaynağı "erişilemedi" döner,
   diğer iki kaynak (esans.com.tr, Felicita) bundan etkilenmez
   (`lib/sources/index.ts`'teki `Promise.allSettled` izolasyonu, değişmedi).

Arayüzde önbellekten gelen sonuçların yanında son güncelleme tarihi gösterilir
(`SourceCard`/`SourceStatusBar`, `SourceResult.cachedAt`).

### Önbelleği yenileme: `scripts/sync-shopier.mjs`

Bu, deploy edilen uygulamanın parçası **değil** — yerel makinenizde, gerçek ve
görünür bir Chrome ile, gerekirse Cloudflare doğrulamasını elle tamamlayarak
çalıştırılır:

```bash
npm run shopier:sync:headed   # ilk çalıştırma, ya da Cloudflare tekrar sorarsa
npm run shopier:sync          # sonraki, hâlâ geçerli bir oturum varsa (headless)
```

`shopier:sync:headed` gerçek bir Chrome penceresi açar (`channel: "chrome"`,
kalıcı profil: `./.shopier-profile`, gitignore'da). Cloudflare doğrulaması
çıkarsa pencerede elle tamamlayın — betik en fazla 10 dakika bekler. Geçtikten
sonra sayfayı kaydırarak (`scroll`) ürünleri toplar (JSON-LD → microdata →
genel sezgisel tarama sırasıyla dener — gerçek liste sayfası seçicileri hâlâ
doğrulanmadı, bu yüzden katmanlı/tahmin bazlı bir strateji kullanılıyor) ve
`data/shopier-products.json`'a atomik olarak yazar (`updatedAt` alanıyla).
Ham HTML de `shopier-sync-debug.html`'e kaydedilir (gitignore'da) — sonuç
beklenenden az/boşsa incelemek için.

`shopier:sync` aynı akışı `headless: true` ile dener; profildeki Cloudflare
oturumu hâlâ geçerliyse pencere açmadan çalışır, değilse `challenge` hatasıyla
`:headed` ile tekrar denemenizi ister.

`data/shopier-products.json` **repoya commit edilir** — Vercel'e her deploy
onu da taşır, uygulama çalışırken hiçbir şey yazmaz (yalnızca okur). Yeni bir
senkron için: yerelde `npm run shopier:sync:headed` (veya `:sync`) çalıştırın,
`data/shopier-products.json`'daki değişikliği commit'leyip push'layın.

**Vercel'de dikkat edilmesi gerekenler** (canlı fallback zinciri hâlâ
tetiklenebildiği için geçerliliğini koruyor):

- **Node.js sürümü:** `@sparticuz/chromium` Node 22.17+ istiyor;
  `package.json` içine `"engines": {"node": "22.x"}` eklendi, Vercel bunu
  otomatik okur.
- **Süre/bellek limitleri:** `maxDuration = 60` route'a eklendi; Vercel bunu
  planınızın izin verdiği üst sınıra kadar uygular.
- **`data/shopier-products.json` deploy'a dahil olmalı:** `next.config.ts`'teki
  `outputFileTracingIncludes` bunu zorunlu kılıyor — dosya runtime'da dinamik
  bir `fs` yoluyla okunuyor (statik `import` değil), Next'in file tracing'i
  bunu kendiliğinden göremiyor (`browsers.json` ile aynı sınıf sorun).
- **Fault isolation:** `lib/browser.ts` hâlâ `playwright-core`/`patchright-core`/
  `@sparticuz/chromium`'u modül seviyesinde değil, çağrıldığı anda yükler —
  bir paketleme sorunu yalnızca Shopier'i "erişilemedi" yapar, tüm siteyi
  500'e düşürmez.

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
