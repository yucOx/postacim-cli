# postacim — Masaüstü (Electron)

[English](README.en.md)

postacim masaüstü uygulaması: **Electron sarmalayıcı**. İnce istemcidir —
tüm uygulama kodu paket içinde gelmez, web uygulaması her açılışta
**sunucudan yüklenir**. Discord'un masaüstü uygulaması ile aynı model:
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

## Paketleme

```bash
npm run dist
```

Çıktı `dist/` altındadır: **AppImage + deb** (x64, Linux). Yerel
`npm run dist` yalnız Linux üretir; **Windows (nsis kurulum exe)** ve
**macOS (dmg, x64 + arm64)** paketleri CI'dan gelir — `desktop-v*` tag'i
[release workflow](.github/workflows/desktop-release.yml)'unu tetikler,
çıktılar GitHub Release'e yüklenir.

## İçerik yapısı

```
├── src/main.js       # ana süreç (Electron main)
├── src/picker.html   # ekran paylaşımı kaynak seçici sayfası
├── src/preload.cjs   # yalnız kaynak seçici için IPC köprüsü
└── build/icon.png    # uygulama ikonu
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

## Gizlilik notu

Masaüstü kabuğu mesaj içeriğine **dokunmaz**; E2EE tarayıcıdakiyle aynıdır —
sunucudan yüklenen aynı web kodu çalışır. Kabuğun eklediği şey yalnızca
yukarıdaki masaüstü kolaylıklarıdır; şifreleme, anahtar türetimi ve anahtar
saklama tamamen web uygulamasındaki mantıkla, sunucu kaynağından gelen
kodda gerçekleşir. Sunucu değişirse (JS trust sınırı) masaüstü istemcisi de
tarayıcı kadar etkilenir — bkz. ana depodaki
[JS integrity doğrulaması](https://github.com/yucOx/postacim).
