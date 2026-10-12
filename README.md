# postacim — Masaüstü (Electron)

[English](README.en.md)

postacim masaüstü uygulaması: **Electron sarmalayıcı**. İnce istemcidir —
kripto ve arayüz web uygulamasının kendisidir; ama masaüstünde web kodu
sunucudan indirilmez: pakete gömülü, sha256 manifest'le doğrulanan
**sabitlenmiş web paketi (pinned web bundle)** üzerinden yüklenir
(aşağıda). Discord'un masaüstü uygulaması ile aynı model:
Electron + sabit Chromium, LiveKit/WebRTC açısından öngörülebilir ve
güvenilir bir ortam verir. Tauri/WebKitGTK alternatifi WebRTC'de
güvenilmez olduğundan bilinçli olarak tercih edilmedi.

Uygulama **postacim'e özeldir**: sunucu adresi sorulmaz ve girilemez —
doğrudan `https://postacim.dev`'e bağlanır.

Masaüstü kabuğu kripto işine karışmaz; E2EE tarayıcıdakiyle birebir aynı
koddur (aynı web paketi, aynı libsodium zincirleri).

## Öne çıkanlar

- **Ekran/pencere kaynak seçici** — ekran paylaşımı başlatılırken uygulamanın
  kendi seçim penceresi açılır: ekranlar ve pencereler küçük resimli liste
  hâlinde sunulur, kaynak oradan seçilir.
- **Uygulama içinden güncelleme** — açılışta ve 4 saatte bir denetler; yeni
  sürümü arka planda indirip "yeniden başlat" diye sorar. Tepsi menüsündeki
  **Güncellemeleri denetle** anında tetikler (güncel/yeni/hata sonucunu
  söyler, indirme yüzdesi tepsi ipucunda). Kaynak: bu deponun Releases'i.
- **Sistemle başlatma** ve **"kapatınca tepsiye gizlen"** tercihleri — tepsi
  menüsünden açılıp kapatılır.
- **Tepsiye gizlenme** — tercih açıkken pencere kapatınca uygulama çıkmaz,
  sistem tepsisine gizlenir; tepsiden tekrar açılır.
- **Okunmamış sayacı** — uygulama rozeti + tepsi ipucu (tooltip) üzerinden
  okunmamış mesaj sayısı görünür.
- **Secure-context muafiyeti (http)** — mikrofon, kamera, bildirim ve
  pencere-içi-pencere (PiP) özellikleri tarayıcıdaki "yalnız https" kısıtı
  olmadan çalışır. Muafiyet **yalnızca postacim.dev kaynağına** uygulanır;
  uygulama rastgele sitelere ayrıcalık kazanmaz.
- **Ekran paylaşımı** — `getDisplayMedia` yerel kaynak seçici ile çağrılır;
  paylaşım başlatılırken uygulamanın kendi penceresi açılır, ekranlar ve
  pencereler küçük resimle listelenir (tarayıcı sekmesi yerine).
- **Tek örnek kilidi** — ikinci başlatma yeni pencere açmaz, mevcut örneği
  öne getirir.
- **Dış bağlantılar** — uygulama içindeki harici linkler sistem tarayıcısında
  açılır.

## Geliştirici kurulumu

```bash
npm install && npm start
```

Sunucu adresi **girilemez** — uygulama `src/main.js` içindeki `PROD_SERVER`
sabitine (`https://postacim.dev`) bağlıdır. Geliştirme sırasında başka bir
sunucuyu denemek için yalnızca o sabit elle değiştirilir.

Pencere konumu gibi tercihler `~/.config/postacim/config.json` içinde
tutulur (paketlenmiş uygulamada `productName` dizindir; geliştirme modunda
`postacim-cli`).

## Sabitlenmiş web paketi (pinned web bundle)

Masaüstü uygulaması postacim.dev'in **sayfa varlıklarını** (index.html,
JS, CSS, fontlar, sesler) sunucudan indirmez: bunlar uygulama paketinin
içine gömülüdür (`webapp/`) ve her dosyanın sha256 hash'i
`webapp/manifest.json`'de listelenir. Açılışta yine `https://postacim.dev`
yüklenir, ama varlık istekleri yerel paketten servis edilir:

- **`/api`, `/ws`, `/livekit`** çağrıları gerçek ağa gider — veri ve
  sinyal trafiği her zaman sunucudadır.
- Manifest'te olmayan bir varlık **403** ile engellenir; diskte
  değiştirilmiş bir dosya sha256 uyuşmazlığından **500** alır.
- `index.html`'e, web'in nginx conf'undaki politikaya uyarlanmış bir CSP
  başlığı eklenir.

Güvenlik anlamı: ele geçen sunucu masaüstü istemcisine **değiştirilmiş JS
basamaz** — ana depodaki "Web JS trust" sınırının masaüstü kapanışı.
Web istemcisi (tarayıcı) için aynı koruma yoktur; orada manifest
doğrulaması elle yapılır.

Güncelleme akışı: web kodu değişince yeni masaüstü sürümü gerekir —
`desktop-v*` etiketi yeni paketi keser.

Üretim:

```bash
npm run web:embed   # postacim deposundan klon + build → webapp/ + manifest
```

Varsayılan olarak en son `v*` etiketi gömülür; `POSTACIM_REF=main npm run
web:embed` ile dal/etiket seçilir, `POSTACIM_GIT_URL` ile klon adresi
değiştirilir. `webapp/` yoksa (build edilmemiş dev klonu) uygulama uyarı
verir ve eski davranışla — kodu sunucudan yükleyerek — çalışır.

## Paketleme

```bash
npm run dist
```

`dist` öncesinde pinned paket otomatik yeniden üretilir (`predist` →
`web:embed`).

Çıktı `dist/` altındadır: **AppImage + deb** (x64, Linux). Yerel
`npm run dist` yalnız Linux üretir; **Windows (nsis kurulum exe)** ve
**macOS (dmg, x64 + arm64)** paketleri CI'dan gelir — `desktop-v*` tag'i
[release workflow](.github/workflows/desktop-release.yml)'unu tetikler,
çıktılar GitHub Release'e yüklenir.

## İçerik yapısı

```
├── scripts/embed-web.sh  # pinned web bundle üretici (klon + build + manifest)
├── src/main.js       # ana süreç (Electron main)
├── src/picker.html   # ekran paylaşımı kaynak seçici sayfası
├── src/preload.cjs   # yalnız kaynak seçici için IPC köprüsü
├── build/icon.png    # uygulama ikonu
└── webapp/           # gömülü web paketi + manifest (web:embed üretir, git'e girmez)
```

## Bilinen sınırlar

- Ekran paylaşımı sesi yalnız **Windows**'ta taşınır (loopback — tüm sistem
  sesi paylaşılır); Linux/macOS'ta görüntü paylaşılır, sistem sesi
  paylaşılamaz (Chromium'da Linux loopback implementasyonu yok).
- **macOS paketi imzasız** — ilk açılışta Gatekeeper engeller; elle geçilir
  (uygulamaya Sağ tık → Aç veya Sistem Ayarları → Gizlilik ve Güvenlik).
- **Windows paketi imzasız** — kurulumda SmartScreen uyarısı görünebilir
  ("Yine de çalıştır" ile geçilir).
- **Otomatik güncelleme** — `electron-updater` bu deponun Releases'ine
  bağlanır; `desktop-v*` etiketli sürümler oradan gelir.
  Uygulama içinden: tepsi → Güncellemeleri denetle.
- **Web bundle sürüm kayması** — gömülü web paketi, gömüldüğü andaki web
  kodunu taşır; sunucu API sürümünün gerisine düşebilir. API uyumluluk
  penceresi geniş tutulur; web kodu değişince yeni uygulama sürümü
  (`desktop-v*` etiketi) gerekir.

## Gizlilik notu

Masaüstü kabuğu mesaj içeriğine **dokunmaz**; E2EE tarayıcıdakiyle aynı
koddur — pakete gömülü, sha256 ile doğrulanan aynı web paketi çalışır.
Kabuğun eklediği şey yalnızca yukarıdaki masaüstü kolaylıklarıdır;
şifreleme, anahtar türetimi ve anahtar saklama tamamen web uygulamasındaki
mantıkla, sabitlenmiş paketteki kodda gerçekleşir. Sunucu ele geçse bile
masaüstü istemcisinin çalıştırdığı JS değişemez (bkz. "Sabitlenmiş web
paketi"); tarayıcı istemcisi için aynı güvence yoktur — bkz. ana depodaki
[JS integrity doğrulaması](https://github.com/yucOx/postacim).
