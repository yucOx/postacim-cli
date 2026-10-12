# postacim — Desktop (Electron)

[Türkçe](README.md)

The postacim desktop app: an **Electron wrapper**. It is a thin client —
the full app code does not ship inside the package; the web app is
**loaded from the server on every launch**. Same model as Discord's
desktop app: Electron + a fixed Chromium, giving a predictable, reliable
environment for LiveKit/WebRTC. The Tauri/WebKitGTK alternative was
deliberately not chosen because its WebRTC support is unreliable.

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

## Packaging

```bash
npm run dist
```

Output lands in `dist/`: **AppImage + deb** (x64, Linux). Local
`npm run dist` only produces Linux; the **Windows (nsis setup exe)** and
**macOS (dmg, x64 + arm64)** packages come from CI — a `desktop-v*` tag
triggers the [release workflow](.github/workflows/desktop-release.yml)
and uploads the artifacts to a GitHub Release.

## Layout

```
├── src/main.js       # main process (Electron main)
├── src/picker.html   # screen-share source picker page
├── src/preload.cjs   # IPC bridge for the source picker only
└── build/icon.png    # app icon
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

## Privacy note

The desktop shell **never touches message content**; E2EE is identical to
the browser — the same web code loaded from the server runs here. The
shell only adds the desktop conveniences above; encryption, key
derivation and key storage all happen in the web app's logic, in code
served from the server. If the server changes (the JS trust boundary),
the desktop client is exactly as affected as the browser — see the
[JS integrity verification](https://github.com/yucOx/postacim) in the
main repository.
