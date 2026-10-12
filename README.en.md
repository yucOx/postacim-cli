# postacim — Desktop (Electron)

[Türkçe](README.md)

The postacim desktop app: an **Electron wrapper**. It is a thin client —
the crypto and UI are the web app itself; but on the desktop the web code
is not downloaded from the server: it loads from a **pinned web bundle**
embedded in the package and verified against a sha256 manifest (see
below). Same model as Discord's desktop app: Electron + a fixed Chromium,
giving a predictable, reliable environment for LiveKit/WebRTC. The
Tauri/WebKitGTK alternative was deliberately not chosen because its
WebRTC support is unreliable.

The app is **exclusive to postacim**: the server address is never asked
for and cannot be entered — it connects directly to `https://postacim.dev`.

The desktop shell does not touch the crypto; E2EE is the exact same code
as in the browser (same web bundle, same libsodium chains).

## Highlights

- **Screen/window source picker** — when a screen share starts, the app
  opens its own picker window: screens and windows are listed with
  thumbnails; the source is picked there.
- **In-app updates** — checks on launch and every 4 hours; downloads new
  versions in the background and asks to restart. The tray's
  **Check for updates** triggers a check immediately (reports
  up-to-date/new/error; download percentage shows in the tray tooltip).
  Source: this repository's Releases.
- **Start with system** and **"hide to tray on close"** preferences —
  toggled from the tray menu.
- **Hide to tray** — with the preference on, closing the window does not
  quit; the app hides to the system tray and reopens from there.
- **Unread counter** — unread message count via the app badge and tray
  tooltip.
- **Secure-context exemption (http)** — microphone, camera, notifications
  and picture-in-picture work without the browser's "https-only"
  restriction. The exemption applies **only to the postacim.dev origin**;
  the app gains no privilege over arbitrary sites.
- **Screen sharing** — `getDisplayMedia` is served by the local source
  picker; screens and windows are listed with thumbnails (instead of a
  browser tab).
- **Single-instance lock** — a second launch opens no new window; it
  focuses the existing one.
- **External links** — links inside the app open in the system browser.

## Developer setup

```bash
npm install && npm start
```

There is **no server address input** — the app is bound to the
`PROD_SERVER` constant in `src/main.js` (`https://postacim.dev`). To test
against a different server while developing, edit that constant by hand.

Preferences such as window position are stored in
`~/.config/postacim/config.json` (`productName` directory in the packaged
app; `postacim-cli` in development mode).

## Pinned web bundle

The desktop app does not download postacim.dev's **page assets**
(index.html, JS, CSS, fonts, sounds) from the server: they are embedded in
the application package (`webapp/`), with every file's sha256 hash listed
in `webapp/manifest.json`. On launch `https://postacim.dev` still loads,
but asset requests are served from the local bundle:

- **`/api`, `/ws`, `/livekit`** calls go to the real network — data and
  signaling traffic always lives on the server.
- An asset not in the manifest is blocked with **403**; a file tampered
  with on disk fails its sha256 check and gets **500**.
- `index.html` gets a CSP header adapted from the web's nginx policy.

Security meaning: a compromised server **cannot push modified JS** to the
desktop client — the desktop-side closure of the "Web JS trust" boundary
in the main repository. The web (browser) client has no such protection;
there the manifest must be verified by hand.

Update flow: when the web code changes, a new desktop build is required —
a `desktop-v*` tag cuts the new package.

Producing it:

```bash
npm run web:embed   # clone + build from the postacim repo → webapp/ + manifest
```

By default the latest `v*` tag is embedded; `POSTACIM_REF=main npm run
web:embed` picks a branch/tag, `POSTACIM_GIT_URL` overrides the clone
URL. Without `webapp/` (a dev clone that never ran the embed) the app
warns and works the old way — loading its code from the server.

## Packaging

```bash
npm run dist
```

The pinned bundle is rebuilt automatically before `dist` (`predist` →
`web:embed`).

Output lands in `dist/`: **AppImage + deb** (x64, Linux). Local
`npm run dist` only produces Linux; the **Windows (nsis setup exe)** and
**macOS (dmg, x64 + arm64)** packages come from CI — a `desktop-v*` tag
triggers the [release workflow](.github/workflows/desktop-release.yml)
and uploads the artifacts to a GitHub Release.

## Layout

```
├── scripts/embed-web.sh  # pinned web bundle builder (clone + build + manifest)
├── src/main.js       # main process (Electron main)
├── src/picker.html   # screen-share source picker page
├── src/preload.cjs   # IPC bridge for the source picker only
├── build/icon.png    # app icon
└── webapp/           # embedded web bundle + manifest (built by web:embed; not in git)
```

## Known limitations

- Screen-share audio is carried on **Windows** only (loopback — the whole
  system audio is shared); on Linux/macOS video is shared but system audio
  is not (Chromium has no loopback implementation on Linux).
- **The macOS package is unsigned** — Gatekeeper blocks first launch;
  bypass manually (right-click the app → Open, or System Settings →
  Privacy & Security).
- **The Windows package is unsigned** — SmartScreen may warn during setup
  (choose "Run anyway").
- **Auto-update** — `electron-updater` points at this repository's
  Releases; `desktop-v*` tagged versions come from there. In-app: tray →
  Check for updates.
- **Web bundle drift** — the embedded web bundle carries the web code as
  of the moment it was embedded; it can lag behind the server's API
  version. The API compatibility window is kept wide; when the web code
  changes, a new app release (`desktop-v*` tag) is needed.

## Privacy note

The desktop shell **never touches message content**; E2EE is identical to
the browser — the same web bundle, embedded in the package and verified
with sha256, runs here. The shell only adds the desktop conveniences
above; encryption, key derivation and key storage all happen in the web
app's logic, in the code inside the pinned bundle. Even a compromised
server cannot change the JS the desktop client runs (see "Pinned web
bundle"); the browser client has no such guarantee — see the
[JS integrity verification](https://github.com/yucOx/postacim) in the
main repository.
