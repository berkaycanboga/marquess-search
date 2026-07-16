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

Yerelde Shopier'in headless-browser fallback'ini (aşağıya bakın) test etmek
isterseniz bir kere şunu çalıştırmanız gerekir:

```bash
npx playwright install chromium
```

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
                           kendi kurduğu Chromium)
  htmlVariants.ts          esans.com.tr + Shopier ürün sayfaları için ortak,
                           site-agnostik varyant çıkarma stratejileri
  normalize.ts             kaynaklardan gelen sonuçları tek listede birleştirme
  sources/esans.ts         esans.com.tr — düz HTML + JSON-LD parse
  sources/felicita.ts      Felicita — api.felicitafragrances.com REST client
  sources/shopier.ts       Shopier — düz HTTP (cookie/Referer) önce, olmazsa
                           headless browser; esnek JSON parse
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

## Canlı doğrulama durumu

Bu ortamda (kurumsal egress proxy) esans.com.tr, api.felicitafragrances.com ve
shopier.com'a doğrudan ağ erişimi yok, o yüzden kod büyük ölçüde elle
çıkarılmış teknik notlara dayanarak yazıldı — ama Vercel'e deploy edilip gerçek
ortamda denendi ve şu an bilinen durum:

- ✅ **esans.com.tr** ve **Felicita** — arama sonuçları (isim/fiyat/gram/kalite)
  doğru geliyor.
- ⚠️ **Ürün linkleri (esans.com.tr + Felicita) yanlış** — bilinen, henüz
  düzeltilmemiş hata. Felicita'da her ürün aynı (sabit) adrese gidiyor çünkü
  gerçek SPA rotası notlarda yoktu ve `felicita.ts` sadece kategori sayfasına
  tahmini bir link üretiyor. esans.com.tr'de link üretimi muhtemelen
  `extractCardsHeuristically` (JSON-LD bulunamadığında devreye giren, daha
  kırılgan CSS taraması) yanlış anchor'ı seçiyor. Kesin düzeltme için gerçek
  ürün URL'lerine ihtiyaç var (bkz. Teşhis aracı).
- ⚠️ **Shopier (John Lucas) — mağaza sayfası bile 403 dönüyor.** Bu, notlardaki
  tahminin ötesinde bir koruma: yalnızca arama endpoint'i değil, düz `fetch()`
  ile yapılan sıradan sayfa GET'i bile bloklanıyor — büyük ihtimalle WAF, Node
  `fetch()`'in gerçek Chrome'dan farklı TLS/HTTP parmak izine bakıyor; bu
  header/cookie eklemekle çözülemez. Bu yüzden `shopier.ts` artık düz HTTP
  başarısız olursa **gerçek bir headless Chromium'a** (`lib/browser.ts`) düşüyor
  — bkz. aşağıdaki "Shopier headless-browser fallback" bölümü.

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

## Shopier headless-browser fallback

`lib/sources/shopier.ts` önce düz HTTP dener (hızlı, ucuz); başarısız olursa
`lib/browser.ts` üzerinden gerçek bir Chromium açıp mağaza sayfasını ziyaret
eder ve arama isteğini **sayfanın kendi JS bağlamı içinden** (`page.evaluate`
+ `fetch`) yapar — böylece gerçek tarayıcı TLS/JS parmak izini taşır. Bu,
notlardaki son çare önerisinin ("gerçek arama kutusunu doldurup DOM'dan oku")
daha hafif bir versiyonu: aynı JSON API'yi kullanıyoruz, sadece isteği bizim
yerimize sayfa yapıyor.

**Vercel'de dikkat edilmesi gerekenler:**

- **Node.js sürümü:** `@sparticuz/chromium` Node 22.17+ istiyor;
  `package.json` içine `"engines": {"node": "22.x"}` eklendi, Vercel bunu
  otomatik okur. Proje ayarlarında farklı bir Node sürümü sabitlenmişse
  (Settings → General → Node.js Version) 22.x'e çekin.
- **Süre/bellek limitleri:** Headless Chromium açmak sıradan bir `fetch()`'ten
  çok daha yavaş ve bellek aç (`@sparticuz/chromium` en az 512MB, 1600MB+
  öneriyor). `maxDuration = 60` route'lara eklendi ama Vercel bunu planınızın
  (Hobby/Pro/Fluid Compute) izin verdiği üst sınıra kadar uygular — Shopier
  fallback'i sürekli zaman aşımına uğrarsa Vercel Dashboard → Settings →
  Functions'tan süre/bellek limitlerinizi kontrol edin, gerekirse
  `vercel.json`'da `functions` alanıyla artırın.
- **Yerelde test:** `npx playwright install chromium` çalıştırmanız gerekir
  (bkz. yukarıdaki Çalıştırma bölümü); yoksa "Executable doesn't exist" hatası
  alırsınız.
- **Fault isolation:** `lib/browser.ts`, `playwright-core` ve `@sparticuz/chromium`'u
  modül seviyesinde değil, `launchBrowser()` çağrıldığı anda (dinamik `import()`
  ile) yükler. Amaç: bu paketlerle ilgili bir paketleme/uyumluluk sorunu
  (ör. Vercel'in serverless fonksiyonuna Chromium binary'sinin dahil
  edilmemesi) yalnızca Shopier kaynağını "erişilemedi" yapsın — tüm siteyi
  500'e düşürmesin. Yine de tüm sayfa 500 veriyorsa (Shopier'e özel bir hata
  değil de gerçekten her istek çöküyorsa) Vercel Dashboard → Deployments →
  ilgili deployment → Functions/Logs'tan gerçek hatayı kontrol edin.

Bu fallback yine de başarısız olursa (ör. Shopier'in WAF'ı headless Chromium'u
da tespit ederse, ya da bir CAPTCHA/interactive challenge devreye girerse),
kasıtlı olarak daha fazla zorlamıyoruz — o noktada Shopier kaynağı
"erişilemedi" gösterir, diğer iki kaynak çalışmaya devam eder. CAPTCHA çözme
gibi aktif tespit-atlatma yöntemleri eklenmedi.

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
