# "Imagination" Esans Karşılaştırma Sitesi — 3 Kaynak için Teknik Notlar

Bu notlar tarayıcı üzerinden (gerçek Chrome oturumu) network trafiği izlenerek çıkarıldı.
Amaç: Claude Code'un HTTP istekleriyle (headless browser olmadan, mümkün olduğunca) bu 3 siteden
arama yapıp fiyat/gr/kalite verisi çekebilmesi.

Genel not — User-Agent: Üçü de gerçek bir tarayıcı UA bekleyebilir. Test sırasında kullanılan:
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
(daha stabil bir sürüm numarası kullanmak isterseniz 120-126 arası herhangi biri güvenli.)
Ayrıca `Accept-Language: tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7` eklemek Türkçe içerik/fiyat için öneriliyor.

---

## 1) esans.com.tr (Şelale Kimya) — EN KOLAY, düz HTML

- Platform: T-Soft (server-side rendered e-ticaret). JavaScript'e gerek yok, sonuçlar HTML içinde direkt geliyor.
- Arama URL'i (GET, query string ile):
  `https://www.esans.com.tr/arama?q={QUERY}`
  Örnek: `https://www.esans.com.tr/arama?q=imagination`
- Sonuç HTML'i içinde ürün kartları düz olarak yer alıyor: ürün adı, kalite etiketi (TOP/EG-Ekonomik/DELUX),
  fiyat (TL, "+KDV" hariç yazan), stok durumu.
- Ürün detay sayfası: `https://www.esans.com.tr/{slug}` (örn. `fragrance-s08369`).
  Detay sayfasında miktar seçenekleri (15/30/60/100/150/250/500 GRAM, 1 KİLO) her biri ayrı bir
  "link" (tıklanan öğe URL'i değiştirmiyor, JS ile fiyatı günceller) — yani gramaj bazlı fiyatları almak
  için bu linklerin `href`/`data-*` attribute'larına bakmak ya da sayfadaki gizli JSON/script bloğunu
  parse etmek gerekebilir (tam varyant fiyat tablosu HTML'de mevcut, sadece görünüşte JS ile toggle ediliyor).
- **robots.txt** açıkça izin veriyor, hatta `ClaudeBot` için özel `Allow: /` satırı var:
  ```
  User-agent: *
  Allow: /
  Disallow: /AsiriYogunluk.php
  Disallow: /ajax.php
  Disallow: /Cache/GelismisVitrin/
  Disallow: /SecCode.php*
  Disallow: /*?pg=*
  Disallow: /*?Markald=*

  User-agent: ClaudeBot
  Allow: /
  ```
- Buradan 403 gelme ihtimali düşük; geliyorsa muhtemelen eksik User-Agent/Accept-Language başlığı
  ya da çok hızlı ardışık istek (rate limit) sebebiyledir. Normal istek hızında (>1-2 sn aralıkla) sorun
  olmamalı.

---

## 2) Felicita Fragrances — React SPA, ama TEMİZ bir JSON API var

- `www.felicitafragrances.com` sadece boş bir React kabuğu döndürür (CRA build). Gerçek veri ayrı bir
  subdomain'den, düz JSON REST API olarak geliyor: **`api.felicitafragrances.com`**
- Bu API'de CORS açık, cookie/CSRF/login gerektirmiyor — doğrudan `fetch`/`requests` ile çağrılabiliyor.
- Kategori + arama (sayfalı liste):
  ```
  GET https://api.felicitafragrances.com/api/products/category/{categoryId}?page=0&size=20&sort=nameTr,asc&search={QUERY}
  ```
  "Esanslar" (esans) kategorisinin id'si: `adc17f7c-68a3-40f6-8a2c-2559a91c6b46`
  (kullanıcının verdiği URL'deki `category=` parametresiyle aynı)
  Örnek: `https://api.felicitafragrances.com/api/products/category/adc17f7c-68a3-40f6-8a2c-2559a91c6b46?page=0&size=20&sort=nameTr,asc&search=imagination`
  Cevap: Spring Boot pageable formatı → `{content:[...], totalElements, totalPages, ...}`.
  `content[].id` her ürünün parent id'si.

- Ürün detay + TÜM varyant/gramaj/kalite/fiyat kombinasyonları (asıl ihtiyaç bu):
  ```
  GET https://api.felicitafragrances.com/api/products/{productId}
  ```
  Cevapta `childProducts[]` dizisi var, her biri:
  ```json
  {
    "sku": "FRANSIZ-LOVUIM-100gr-TOP",
    "price": 1004.64,
    "name": "LOUIS VUITTON IMAGINATION Muadili France-Mpe-Grasse 100gr Top Kalite Esans",
    "variantAttributes": {"Volume": "100gr", "Quality": "Top"},
    "stockQuantity": 25
  }
  ```
  Yani gramaj = `variantAttributes.Volume`, kalite = `variantAttributes.Quality`, fiyat = `price` (TL, KDV hariç).

- Diğer yardımcı endpoint'ler (opsiyonel): `/api/categories/hierarchy`, `/api/products/category/{id}/filters`.
- **robots.txt boş** (kural yok = engel yok). Bot koruması gözlemlenmedi; düz `fetch()` sorunsuz çalıştı.
  403 alınıyorsa muhtemel sebep: `www.felicitafragrances.com` üzerinden HTML çekmeye çalışmak (SPA, veri yok)
  yerine doğrudan `api.felicitafragrances.com` adresine gitmek gerekiyor. Ayrıca gerçekçi bir
  `User-Agent` + `Accept: application/json` header'ı eklemek faydalı olur.

---

## 3) Shopier — John Lucas Fragrances (ve genel olarak her Shopier mağazası)

- Mağaza sayfası da client-side render + arama ayrı bir API çağrısı ile yapılıyor.
- Arama endpoint'i (mağaza koduna göre değişir, `jlfragrances` = bu mağazanın slug'ı):
  ```
  POST https://www.shopier.com/s/api/v1/search_product/{storeSlug}
  Content-Type: application/x-www-form-urlencoded

  Body: search_query={QUERY}&username={storeSlug}&search_as_you_type=true&highlight=
  ```
  (Bu endpoint ve body formatı, mağazanın kendi `search_elasticsearch.js` dosyası incelenerek çıkarıldı.)
- **ÖNEMLİ / muhtemel 403 sebebi:** Bu endpoint'i mağaza sayfasını hiç ziyaret etmeden, izole/otomatik
  bir istekle direkt çağırdığımda (aynı URL, aynı body) **404/500** döndü — ama gerçek tarayıcıda arama
  kutusuna yazıldığında **200** dönüyor. Bu, Shopier'in bu endpoint'te bot/otomasyon karşıtı bir kontrol
  (rate-limit, session/cookie doğrulama, ya da Referer/Origin kontrolü) yaptığını gösteriyor. Claude Code
  muhtemelen tam bu noktada 403/40x alıyor.
  Önerilen çözüm sırası:
  1. Önce mağaza ana sayfasını normal bir GET ile çekip (`https://www.shopier.com/{storeSlug}`) dönen
     `Set-Cookie` çerezlerini bir sonraki isteğe taşıyın (session/cookie jar kullanın).
  2. Arama isteğine `Referer: https://www.shopier.com/{storeSlug}` ve `Origin: https://www.shopier.com`
     header'larını ekleyin.
  3. İstekler arasına gerçekçi bekleme süresi koyun (art arda hızlı istek atmayın).
  4. Yukarıdakiler yetmezse, bu site için düz HTTP yerine headless browser (Playwright/Puppeteer) kullanıp
     gerçek arama kutusunu doldurup sonucu DOM'dan okumak en garanti yol — çünkü koruma muhtemelen
     tarayıcı-benzeri tam bir oturum/etkileşim bekliyor.
- Ürün sayfasında gramaj/fiyat: Her ürünün kendi sayfası var
  (`https://www.shopier.com/{storeSlug}/{productId}`), sayfa içinde "Miktar" dropdown'u ile
  ML seçenekleri (15/25/50/100/250 ML gibi) ve her birinin fiyatı JS ile client-side state'te tutuluyor;
  ürün sayfası HTML'inde başlangıç fiyatı + seçenek listesi mevcut ama her ML için ayrı fiyat muhtemelen
  sayfa kaynağındaki bir JSON bloğunda (`__NEXT_DATA__` benzeri script tag ya da inline JS objesi) gömülü.
  Bunun tam adını bulmak için ürün sayfasının HTML kaynağında `variant` / `price` geçen `<script>` etiketlerine
  bakılması gerekir.
- robots.txt: sadece `Sitemap:` var, disallow yok → genel tarama engeli yok. Sorun spesifik olarak
  arama API'sinin bot algılama davranışında.

---

## Özet — Claude Code için öneri

| Site | Yöntem | Zorluk | 403 riski |
|---|---|---|---|
| esans.com.tr | Düz GET + HTML parse (`/arama?q=...`) | Kolay | Düşük (robots.txt ClaudeBot'a izin veriyor) |
| felicitafragrances.com | Düz JSON REST API (`api.felicitafragrances.com`) | Kolay | Düşük (auth/CSRF yok, CORS açık) |
| shopier.com | POST form endpoint, ama bot koruması var | Orta-Zor | Yüksek → önce session/cookie + Referer dene, olmazsa headless browser |

İkisi (esans.com.tr, Felicita) için basit bir HTTP client (requests/axios/fetch) yeterli.
Shopier için mutlaka cookie-jar + doğru Referer/Origin header'ları dene; yine 403/404 alırsa
Playwright ile gerçek sayfa etkileşimine geç.
