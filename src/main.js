// postacim masaüstü — Electron sarmalayıcı.
//
// Model: ince istemci + pinned web bundle. Web uygulaması pakete gömülü
// olarak gelir ve sha256 manifest'le doğrulanarak yüklenir (aynı E2EE
// kodu, aynı oturum); bu kabuğun işi tarayıcının yapamadıkları:
//  - sunucu adresi yapılandırması (ilk açılışta sor, userData'ya kaydet)
//  - http (LAN) dağıtımlarında secure-context muafiyeti → mikrofon/kamera/
//    bildirim/pencere-içi-pencere tarayıcı kısıtı olmadan çalışır
//  - ekran paylaşımı: getDisplayMedia için yerel kaynak seçimi
//  - tepsi: kapatınca tepsiye gizlenir; okunmamış sayacı rozet + ipucu
//  - her sunucu kendi kalıcı partition'ında → oturum/E2EE anahtarları karışmaz
//
// Discord ile aynı tercih: Electron + sabit Chromium. Tauri/WebKitGTK
// yolunda WebRTC (LiveKit) güvenilir değil.
import { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import updaterPkg from 'electron-updater';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const SMOKE = process.argv.includes('--smoke');

/** Sabit dağıtım adresi — bu uygulama postacim'e özeldir: sunucu adresi
 *  sorulmaz, girilemez, doğrudan buraya bağlanır (Discord modeli). Başka
 *  sunucu yalnız geliştiricide bu sabit elle değiştirilerek test edilir. */
const PROD_SERVER = 'https://postacim.dev';

// smoke test gerçek kullanıcı yapılandırmasını kirletmesin — config okumadan ÖNCE
if (SMOKE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'postacim-smoke'));
}

// ---------- yapılandırma ----------

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = { ...loadConfig(), ...patch };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
}

/** "sunucu" → "https://sunucu"; şema yoksa https varsay. Geçersizse ''. */
function normalizeServer(raw) {
  let s = (raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return '';
    return u.origin;
  } catch {
    return '';
  }
}

function originOf(serverUrl) {
  return new URL(serverUrl).origin;
}

// Sunucu adresi tek kaynaktan gelir (PROD_SERVER) — harici giriş yolu yok.
// Secure-context muafiyeti switch'i app ready'den ÖNCE yazılmalı → senkron.
const initialConfig = loadConfig();
const serverUrl = normalizeServer(PROD_SERVER);

// LAN http dağıtımı: Chromium bu kaynağı güvenli sayar → getUserMedia,
// Notification, Document PiP açılır. Muafiyet yalnız kendi sunucu kaynağına.
if (serverUrl.startsWith('http://')) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', originOf(serverUrl));
}

// her sunucu kendi kalıcı partition'ında → oturum/E2EE anahtarları karışmaz;
// pinned https kesmesi de bu partition'ın oturumuna kurulur (aşağıda)
const PARTITION = `persist:${originOf(serverUrl).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

// ---------- pinned web bundle ----------
//
// postacim.dev'in SAYFA varlıkları (index.html, JS, CSS, font…) paket
// içinden: webapp/ + manifest.json (npm run web:embed üretir). Sunucudan
// yalnız /api, /ws, /livekit gider — ele geçen sunucu masaüstü istemcisine
// değiştirilmiş JS basamaz. Manifest'te olmayan varlık 403; disk üstünde
// değişmiş dosya sha256 uyuşmazlığından 500. webapp/ yoksa (build
// edilmemiş dev klonu) kesme kurulmaz, yükleme eskisi gibi sunucudan.
const WEBAPP = path.join(__dirname, '..', 'webapp');
const MANIFEST = fs.existsSync(path.join(WEBAPP, 'manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(WEBAPP, 'manifest.json'), 'utf8'))
  : null;
/** veri/sinyal yolları — bunlar gerçek ağa iner */
const PINNED_PASS = ['/api', '/ws', '/livekit'];
/** index.html'e eklenen CSP — web'in nginx conf'undaki politikanın masaüstü
 *  uyarlaması (wss + sabit sunucu adresi). wasm-unsafe-eval şart: hash-wasm
 *  (Argon2id) ve libsodium tarayıcıda WASM derliyor (bkz. web/src/csp.test.ts);
 *  Turnstile origin'leri de nginx'teki gibi önceden açık. */
const PINNED_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:; " +
  "worker-src 'self' blob:; " +
  "connect-src 'self' wss: https://postacim.dev https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; " +
  "require-trusted-types-for 'script'; trusted-types e2ee-worker";
/** dist içinde çıkan uzantılar → content-type (net.fetch yerine kendimiz
 *  sarmaladığımız için manuel; bilinmeyen uzantı octet-stream düşer) */
const PINNED_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

/** paket dosyasını sha256 ile doğrulayıp döndür — dosyalar küçük, her
 *  istekte hash'lemek kabul. Disk değişmişse 500 + log. */
function servePinnedFile(entry) {
  const file = path.join(WEBAPP, entry.path.slice(1));
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    console.error(`[pinned] okunamadı: ${entry.path}`);
    return new Response('pinned varlığı okunamadı', { status: 500 });
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== entry.sha256) {
    console.error(`[pinned] sha256 uyuşmazlığı (disk değişmiş?): ${entry.path}`);
    return new Response('pinned varlık doğrulanamadı', { status: 500 });
  }
  const headers = {
    'Content-Type': PINNED_MIME[path.extname(entry.path).toLowerCase()] ?? 'application/octet-stream',
  };
  if (entry.path === '/index.html') headers['Content-Security-Policy'] = PINNED_CSP;
  return new Response(buf, { headers });
}

/** https kesmesi — pencerenin oturumuna kurulur (global protocol.handle
 *  custom partition'ları kapsamaz; pencere PARTITION ile açılır). Varlık
 *  istekleri webapp/'ten; /api, /ws, /livekit ve öteki https trafiği gerçek
 *  ağa. net/ses.fetch protocol handler'lardan geçmez + bypass bayrağı →
 *  özyineleme yok. */
function wirePinnedWeb(ses) {
  const pinnedHost = new URL(serverUrl).hostname;
  const deniedLogged = new Set();
  ses.protocol.handle('https', (req) => {
    let u;
    try {
      u = new URL(req.url);
    } catch {
      return ses.fetch(req, { bypassCustomProtocolHandlers: true, duplex: 'half' });
    }
    if (u.hostname === pinnedHost && !PINNED_PASS.some((p) => u.pathname.startsWith(p))) {
      const rel = u.pathname === '/' ? '/index.html' : u.pathname;
      const entry = MANIFEST.files.find((f) => f.path === rel);
      if (!entry) {
        if (!deniedLogged.has(rel)) {
          deniedLogged.add(rel);
          console.warn(`[pinned] 403 (manifest dışı varlık): ${rel}`);
        }
        return new Response('engellendi: pinned manifest dışı varlık', { status: 403 });
      }
      return servePinnedFile(entry);
    }
    return ses.fetch(req, { bypassCustomProtocolHandlers: true, duplex: 'half' });
  });
  console.log(`[pinned] web bundle aktif: ${MANIFEST.files.length} dosya, host ${pinnedHost}`);
}

// ---------- tek örnek ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void bootstrap();
}

let win = null;
let tray = null;
let quitting = false;

// ---------- ekran paylaşımı kaynak seçici ----------

let pickerWin = null;
/** bekleyen getDisplayMedia isteği: { callback, byId } — cevaplanınca biter */
let pendingShare = null;

function openSourcePicker(sources, callback) {
  // yeni istek eskiyi iptal eder
  if (pickerWin) {
    try {
      pickerWin.destroy();
    } catch {
      /* zaten kapalı */
    }
    pickerWin = null;
  }
  const byId = new Map(sources.map((s) => [s.id, s]));
  pendingShare = { callback, byId };

  pickerWin = new BrowserWindow({
    width: 720,
    height: 560,
    show: false,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    icon: ICON,
    parent: win ?? undefined,
    modal: !!win,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pickerWin.removeMenu();
  pickerWin.on('closed', () => {
    pickerWin = null;
    finishShare(null); // iptal / pencere kapandı
  });
  pickerWin.once('ready-to-show', () => {
    if (!pickerWin) return;
    pickerWin.show();
    pickerWin.webContents.send(
      'postacim:sources',
      sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumb: s.thumbnail.toDataURL(),
      })),
    );
  });
  void pickerWin.loadFile(path.join(__dirname, 'picker.html'));
}

function finishShare(source) {
  if (!pendingShare) return;
  const { callback } = pendingShare;
  pendingShare = null;
  try {
    callback(source ? { video: source, ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) } : null);
  } catch {
    /* renderer gitti — yapacak bir şey yok */
  }
}

ipcMain.handle('postacim:pick-source', (_e, id) => {
  const src = pendingShare?.byId.get(id) ?? null;
  finishShare(src);
  if (pickerWin) pickerWin.close();
  return !!src;
});

ipcMain.handle('postacim:cancel-share', () => {
  finishShare(null);
  if (pickerWin) pickerWin.close();
  return true;
});

// ---------- otomatik güncelleme ----------
// Akış: açılışta + 4 saatte bir sessiz denetim → yeni sürüm varsa arka
// planda indirilir → inince "yeniden başlat" diyaloğu. Tepsideki
// "Güncellemeleri denetle" aynı akışı anında tetikler ve sonucu söyler.

let autoUpdater = null;
/** elle denetim mi → sonucu (güncel/yeni/hata) diyalogla söyle */
let manualCheck = false;

function wireUpdater() {
  if (!app.isPackaged) return;
  autoUpdater = updaterPkg.autoUpdater;
  autoUpdater.autoDownload = true;

  const say = (type, message, detail) => {
    void dialog.showMessageBox(win ?? null, { type, message, detail, buttons: ['Tamam'] });
  };

  autoUpdater.on('error', (err) => {
    if (manualCheck) {
      manualCheck = false;
      say('error', 'Güncelleme denetlenemedi', String(err?.message ?? err));
    }
    /* otomatik denetimde (ağ yok / releases yok) sessiz kal */
  });
  autoUpdater.on('update-available', (info) => {
    if (manualCheck) {
      manualCheck = false;
      say('info', `Yeni sürüm: ${info.version}`, 'Arka planda indiriliyor — tamamlanınca yeniden başlatma sorulacak.');
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      manualCheck = false;
      say('info', 'postacim güncel', `Sürüm ${app.getVersion()}`);
    }
  });
  autoUpdater.on('download-progress', (p) => {
    // ilerleme tepsi ipucunda — pencere açmaya değmez
    if (tray) tray.setToolTip(`postacim — güncelleme indiriliyor ${Math.floor(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (tray) tray.setToolTip('postacim');
    const r = await dialog.showMessageBox(win ?? null, {
      type: 'info',
      buttons: ['Yeniden başlat', 'Sonra'],
      defaultId: 0,
      message: 'postacim güncellemesi indirildi',
      detail: `Sürüm ${info.version} kurulmaya hazır — yeniden başlatılsın mı?`,
    });
    if (r.response === 0) {
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  void autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => void checkForUpdates(false), 4 * 60 * 60 * 1000);
}

async function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) {
      void dialog.showMessageBox(win ?? null, {
        type: 'info',
        message: 'Geliştirme modu',
        detail: 'Güncelleme denetimi yalnızca kurulu uygulamada çalışır (npm run dist çıktısı).',
        buttons: ['Tamam'],
      });
    }
    return;
  }
  manualCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    manualCheck = false;
    if (manual) {
      void dialog.showMessageBox(win ?? null, {
        type: 'error',
        message: 'Güncelleme denetlenemedi',
        detail: String(err?.message ?? err),
        buttons: ['Tamam'],
      });
    }
  }
}

async function bootstrap() {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  // Discord görünümü: menü çubuğu yok (F12/Ctrl+R kısayolları aşağıda elle bağlı)
  Menu.setApplicationMenu(null);

  await app.whenReady();

  // pinned mod: https kesmesi pencere açılmadan ÖNCE oturuma kurulur.
  // webapp/ yoksa kesme yok — dev klonunda yükleme eskisi gibi sunucudan.
  if (MANIFEST) {
    wirePinnedWeb(session.fromPartition(PARTITION));
  } else {
    console.warn('[pinned] webapp/ yok — pinned mod kapalı (npm run web:embed)');
  }

  if (!serverUrl) {
    // PROD_SERVER boş/bozuk — yanlış yapılandırma: kullanıcıya söyle, çık
    await dialog.showMessageBox({
      type: 'error',
      message: 'postacim yapılandırma hatası',
      detail: 'Sabit sunucu adresi (PROD_SERVER) tanımsız — uygulama güncellenmeli.',
      buttons: ['Tamam'],
    });
    app.quit();
    return;
  }
  createMainWindow();

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    // tepsiye gizlenme close handler'da; pencereler kapandıysa (tepsi yoksa) çık
    if (!tray || quitting) app.quit();
  });
}

// ---------- ana pencere ----------

function createMainWindow() {
  const bounds = initialConfig.bounds ?? { width: 1280, height: 800 };
  const origin = originOf(serverUrl); // izin/dış bağlantı denetimlerinde

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0e13', // ilk boyama öncesi beyaz flaş olmasın
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // her sunucu kendi kalıcı partition'ında — oturum çerezi + E2EE
      // localStorage farklı sunucular arasında asla karışmaz
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.removeMenu();

  win.once('ready-to-show', () => {
    if (win) win.show();
    smokeDone();
  });
  // smoke modunda sunucuya ulaşılamasa bile (did-fail-load) ilerle
  win.webContents.on('did-fail-load', () => smokeDone());
  void win.loadURL(serverUrl);

  wireSession(win.webContents.session, origin);
  wireWindowEvents();
  createTray();
  wireUpdater();
}

/** izinler + ekran paylaşımı + dış bağlantı — yalnız kendi sunucu kaynağına */
function wireSession(ses, origin) {
  const ALLOWED = new Set(['media', 'fullscreen', 'notifications', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    try {
      callback(new URL(wc.getURL()).origin === origin && ALLOWED.has(permission));
    } catch {
      callback(false);
    }
  });
  ses.setPermissionCheckHandler((wc, permission, requestingUrl) => {
    try {
      return new URL(requestingUrl || wc.getURL()).origin === origin && ALLOWED.has(permission);
    } catch {
      return false;
    }
  });

  // ekran paylaşımı: kaynak seçici. Tek kaynak varsa seçiciyi boş yere
  // açmadan direkt ver; birden fazlaysa picker.html küçük resimli liste.
  // Ekran sesi loopback yalnız Windows'ta (tüm sistem sesi).
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });
      if (!sources.length) {
        callback(null);
        return;
      }
      if (sources.length === 1) {
        callback({ video: sources[0], ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) });
        return;
      }
      openSourcePicker(sources, callback);
    } catch {
      callback(null);
    }
  });

  // dış bağlantılar sistem tarayıcısında; uygulama penceresi kendi sunucusunda kalır
  const wc = win?.webContents;
  if (wc) {
    wc.setWindowOpenHandler(({ url: target }) => {
      try {
        if (new URL(target).origin !== origin) void shell.openExternal(target);
      } catch {
        /* hatalı hedef — yoksay */
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, target) => {
      try {
        if (new URL(target).origin !== origin) {
          e.preventDefault();
          void shell.openExternal(target);
        }
      } catch {
        e.preventDefault();
      }
    });
  }
}

function wireWindowEvents() {
  if (!win) return;

  // okunmamış sayacı: web "(N) postacim" başlığı yazar → rozet + tepsi ipucu
  win.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title);
    const n = m ? Number(m[1]) : 0;
    try {
      app.setBadgeCount(n);
    } catch {
      // Unity/dock dışı ortamlar — önemsiz
    }
    if (tray) tray.setToolTip(n > 0 ? `postacim — ${n} okunmadı` : 'postacim');
  });

  // kapat → tepsiye gizle (Discord, tercihe bağlı; tepsi menüsünden kapatılır).
  // Tepsi yoksa (WM desteklemiyorsa) normal kapat.
  win.on('close', (e) => {
    if (!win) return;
    saveConfig({ bounds: win.getBounds() });
    if (!quitting && tray && loadConfig().hideOnClose !== false) {
      e.preventDefault();
      win.hide();
    }
  });

  // menü yok → kısayollar elle
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win?.webContents.toggleDevTools();
    else if (input.key === 'r' && (input.control || input.meta)) win?.webContents.reload();
  });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(icon);
    tray.setToolTip('postacim');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Göster', click: () => { if (win) { win.show(); win.focus(); } } },
        { label: 'Güncellemeleri denetle', click: () => void checkForUpdates(true) },
        { type: 'separator' },
        {
          label: 'Kapatınca tepsiye gizlen',
          type: 'checkbox',
          checked: loadConfig().hideOnClose !== false,
          click: (mi) => saveConfig({ hideOnClose: mi.checked }),
        },
        {
          label: 'Sistemle başlat',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }),
        },
        { type: 'separator' },
        {
          label: 'Çıkış',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    // sol tık: göster/gizle (KDE/GNOME alışkanlığı)
    tray.on('click', () => {
      if (win?.isVisible()) win.hide();
      else win?.show();
    });
  } catch {
    // tepsi desteklemeyen ortam — pencere davranışı normal kalır
    tray = null;
  }
}

// ---------- smoke test (--smoke): boots, pencere açılır, çık ----------

let smokeReported = false;
function smokeDone() {
  if (!SMOKE || smokeReported) return;
  smokeReported = true;
  console.log('[smoke] ok');
  setTimeout(() => app.quit(), 200);
}
if (SMOKE) {
  // güvence: herhangi bir takılmada 8 sn içinde kesin çık
  setTimeout(() => {
    if (!smokeReported) {
      console.log('[smoke] timeout');
      app.quit();
    }
  }, 8000);
}
