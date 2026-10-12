// postacim masaüstü — Electron sarmalayıcı.
//
// Model: ince istemci. Web uygulaması sunucudan yüklenir (aynı E2EE kodu,
// aynı oturum); bu kabuğun işi tarayıcının yapamadıkları:
//  - sunucu adresi yapılandırması (ilk açılışta sor, userData'ya kaydet)
//  - http (LAN) dağıtımlarında secure-context muafiyeti → mikrofon/kamera/
//    bildirim/pencere-içi-pencere tarayıcı kısıtı olmadan çalışır
//  - ekran paylaşımı: getDisplayMedia için yerel kaynak seçimi
//  - tepsi: kapatınca tepsiye gizlenir; okunmamış sayacı rozet + ipucu
//  - her sunucu kendi kalıcı partition'ında → oturum/E2EE anahtarları karışmaz
//
// Discord ile aynı tercih: Electron + sabit Chromium. Tauri/WebKitGTK
// yolunda WebRTC (LiveKit) güvenilir değil.
import { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, nativeImage, shell } from 'electron';
import updaterPkg from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const SMOKE = process.argv.includes('--smoke');

/** Sabit dağıtım adresi — Discord modeli: kullanıcıya sunucu sorulmaz,
 *  uygulama doğrudan buraya bağlanır. Yalnız geliştirme kısayolu:
 *  POSTACIM_URL ortam değişkeni veya --url= argümanı başka sunucuya yönelir. */
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

// Sabit adres önde; POSTACIM_URL / --url= yalnız geliştirme kısayolu.
// Secure-context muafiyeti switch'i app ready'den ÖNCE yazılmalı → senkron.
const argUrl = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? '';
const initialConfig = loadConfig();
const fromEnv = normalizeServer(process.env.POSTACIM_URL ?? '');
const fromArg = normalizeServer(argUrl);
const serverUrl = fromEnv || fromArg || normalizeServer(PROD_SERVER);

// LAN http dağıtımı: Chromium bu kaynağı güvenli sayar → getUserMedia,
// Notification, Document PiP açılır. Muafiyet yalnız kendi sunucu kaynağına.
if (serverUrl.startsWith('http://')) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', originOf(serverUrl));
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

  ipcMain.handle('postacim:save-server', (_e, raw) => {
    const u = normalizeServer(raw);
    if (!u) return { ok: false };
    saveConfig({ serverUrl: u });
    // secure-context switch'i ancak yeni süreçte etkili olur → relaunch
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 300);
    return { ok: true };
  });

  if (!serverUrl) createSetupWindow();
  else createMainWindow();

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    // tepsiye gizlenme close handler'da; pencereler kapandıysa (tepsi yoksa) çık
    if (!tray || quitting) app.quit();
  });
}

// ---------- ilk kurulum penceresi ----------

const SETUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b0e13;color:#e8e4d8;font-family:system-ui,sans-serif}
  .box{width:340px;padding:32px;border:1px solid #c9a45c66;border-radius:10px;background:#10151c}
  h1{font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#e8a33d;margin:0 0 6px}
  p{font-size:13px;color:#9aa3ad;margin:0 0 18px;line-height:1.5}
  input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #2b3644;
    border-radius:6px;background:#0b0e13;color:#e8e4d8;font-size:14px;outline:none}
  input:focus{border-color:#e8a33d}
  button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:6px;
    background:#e8a33d;color:#0b0e13;font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#e35d5d;font-size:12px;margin-top:8px;min-height:14px}
  .seal{display:block;margin:0 auto 14px;width:56px;height:56px}
</style></head><body><div class="box">
  <svg class="seal" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="6" fill="#0b0e13"/>
    <circle cx="16" cy="16" r="12.5" fill="none" stroke="#c9a45c" stroke-width="1.6"/>
    <path fill="#e8a33d" d="M25 10.4c-2.9-1.5-5.6-.9-7.5 1.2l-1.2 1.3-8-1.2-2.7 2.5 6.6 2.2-7.6 6.9 3.2 1 5.3-3.9 1.7 4.9 2.9-1.2-1.2-4.9 3.1-2.6c2.3-1.9 4.3-3.3 5.4-6.2z" transform="translate(1.5 -2) scale(0.92)"/>
  </svg>
  <h1>postacim</h1>
  <p>Sunucunun adresi ne? (ör. <b>https://posta.example</b> veya LAN'da <b>http://192.168.1.10</b>)</p>
  <input id="u" type="text" placeholder="https://sunucu-adresin" autofocus>
  <div class="err" id="e"></div>
  <button id="b">Bağlan</button>
</div><script>
  const go = async () => {
    const r = await window.postacim.saveServer(document.getElementById('u').value);
    if (!r.ok) { document.getElementById('e').textContent = 'geçersiz adres'; return; }
    document.getElementById('b').textContent = 'yeniden başlatılıyor…';
    document.getElementById('b').disabled = true;
  };
  document.getElementById('b').onclick = go;
  document.getElementById('u').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
</script></body></html>`;

function createSetupWindow() {
  const setup = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    show: false,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setup.removeMenu();
  setup.once('ready-to-show', () => {
    setup.show();
    smokeDone();
  });
  void setup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SETUP_HTML)}`);
}

// ---------- ana pencere ----------

function createMainWindow() {
  const bounds = initialConfig.bounds ?? { width: 1280, height: 800 };
  const origin = originOf(serverUrl);

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
      partition: `persist:${origin.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
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
