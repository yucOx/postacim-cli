# postacim — Masaüstü (Electron)

postacim masaüstü uygulaması: **Electron sarmalayıcı**. İnce istemcidir —
tüm uygulama kodu paket içinde gelmez, web uygulaması her açılışta
**sunucudan yüklenir**. Discord'un masaüstü uygulaması ile aynı model:
Electron + sabit Chromium, LiveKit/WebRTC açısından öngörülebilir ve
güvenilir bir ortam verir. Tauri/WebKitGTK alternatifi WebRTC'de
güvenilmez olduğundan bilinçli olarak tercih edilmedi.

Masaüstü kabuğu kripto işine karışmaz; E2EE tarayıcıdakiyle birebir aynı
koddur (aynı web paketi, aynı libsodium zincirleri).

## Sürüm 0.2.0

- **Ekran/pencere kaynak seçici** — ekran paylaşımı başlatılırken uygulamanın
  kendi seçim penceresi açılır: ekranlar ve pencereler küçük resimli liste
  hâlinde sunulur, kaynak oradan seçilir.
- **Uygulama içinden güncelleme** — açılışta ve 4 saatte bir denetler; yeni
  sürümü arka planda indirip "yeniden başlat" diye sorar. Tepsi menüsündeki
  **Güncellemeleri denetle** anında tetikler (güncel/yeni/hata sonucunu
  söyler, indirme yüzdesi tepsi ipucunda). Kaynak: **yucOx/postacim-cli**
  Releases.
- **Sistemle başlatma** ve **"kapatınca tepsiye gizlen"** tercihleri — tepsi
  menüsünden açılıp kapatılır.
- **Release CI** — `desktop-v*` tag'i üç platformda (Linux/Windows/macOS)
  derleme yapıp GitHub Release'e yükler:
  [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).

## Ne getirir

- **Tepsiye gizlenme** — "kapatınca tepsiye gizlen" tercihi açıkken pencere
  kapatınca uygulama çıkmaz, sistem tepsisine gizlenir; tepsiden tekrar açılır
  (tercih tepsi menüsünden açılıp kapanır, 0.2.0).
- **Okunmamış sayacı** — uygulama rozeti + tepsi ipucu (tooltip) üzerinden
  okunmamış mesaj sayısı görünür.
- **Secure-context muafiyeti (http LAN)** — mikrofon, kamera, bildirim ve
  pencere-içi-pencere (PiP) özellikleri tarayıcıdaki "yalnız https" kısıtı
  olmadan çalışır. Muafiyet **yalnızca kendi sunucu kaynağına** uygulanır;
  uygulama rastgele sitelere ayrıcalık kazanmaz.
- **Ekran paylaşımı** — `getDisplayMedia` yerel kaynak seçici ile çağrılır;
  paylaşım başlatılırken uygulamanın kendi penceresi açılır, ekranlar ve
  pencereler küçük resimli listelenir (tarayıcı sekmesi yerine).
- **Sunucu başına kalıcı partition** — her sunucu adresi kendi Chromium
  partition'ında çalışır; farklı sunucuların oturumları ve E2EE anahtar
  depoları (IndexedDB/localStorage) **karışmaz**.
- **Tek örnek kilidi** — ikinci başlatma yeni pencere açmaz, mevcut örneği
  öne getirir.
- **Dış bağlantılar** — uygulama içindeki harici linkler sistem tarayıcısında
  açılır.

## Geliştirici kurulumu

```bash
cd desktop && npm install && npm start
```

Uygulama **doğrudan `https://postacim.dev`'e bağlanır** — sunucu adresi
sorulmaz (Discord modeli). Geliştirme sırasında başka sunucuya yönelmek için:

1. Ortam değişkeni: `POSTACIM_URL=https://sunucu npm start`
2. Argüman: `npm start -- --url=https://sunucu`

Pencere konumu gibi tercihler `~/.config/postacim/config.json` içinde
tutulur (paketlenmiş uygulamada `productName` dizindir; geliştirme modunda
`postacim-cli`). Sabit adres `src/main.js` içindeki `PROD_SERVER` sabitidir.

## Paketleme

```bash
npm run dist
```

Çıktı `desktop/dist/` altındadır: **AppImage + deb** (x64, Linux). Yerel
`npm run dist` yalnız Linux üretir; **Windows (nsis kurulum exe)** ve
**macOS (dmg, x64 + arm64)** paketleri CI'dan gelir — `desktop-v*` tag'i
[release workflow](../.github/workflows/desktop-release.yml)'unu tetikler,
çıktılar GitHub Release'e yüklenir.

## İçerik yapısı

```
desktop/
├── src/main.js       # ana süreç (Electron main)
 ├── src/preload.cjs   # kaynak seçici + (yedek) kurulum penceresi IPC köprüsü
└── build/icon.png    # uygulama ikonu
```

## Bilinen sınırlar

- Ekran paylaşımı sesi yalnız **Windows**'ta taşınır (loopback — tüm sistem
  sesi paylaşılır); Linux/macOS'ta görüntü paylaşılır, sistem sesi
  paylaşılamaz.
- **macOS paketi imzasız** — ilk açılışta Gatekeeper engeller; elle geçilir
  (uygulamaya Sağ tık → Aç veya Sistem Ayarları → Gizlilik ve Güvenlik).
- **Windows paketi imzasız** — kurulumda SmartScreen uyarısı görünebilir
  ("Yine de çalıştır" ile geçilir).
- **Otomatik güncelleme** — `electron-updater` `yucOx/postacim-cli`
  Releases'ine bağlanır; `desktop-v*` etiketli sürümler oradan gelir.
  Uygulama içinden: tepsi → Güncellemeleri denetle.

## Gizlilik notu

Masaüstü kabuğu mesaj içeriğine **dokunmaz**; E2EE tarayıcıdakiyle aynıdır —
sunucudan yüklenen aynı web kodu çalışır. Kabuğun eklediği şey yalnızca
yukarıdaki masaüstü kolaylıklarıdır; şifreleme, anahtar türetimi ve anahtar
saklama tamamen web uygulamasındaki mantıkla, sunucu kaynağından gelen
kodda gerçekleşir. Sunucu değişirse (JS trust sınırı) masaüstü istemcisi de
tarayıcı kadar etkilenir — bkz. kök README'deki
[JS integrity doğrulaması](../README.md#doğrulama-js-integrity-release-manifest).
