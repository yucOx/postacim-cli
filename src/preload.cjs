// Yalnız ekran paylaşımı kaynak seçici sayfası kullanır (yüklenen web
// uygulaması değil): postacim.onSources / pick / cancelShare. Ana pencere
// hiçbir köprü kullanmaz — yüklenen koda yüzey açılmaz.
// .cjs: package "type":"module" altında CommonJS kalmalı (preload ESM'siz).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postacim', {
  onSources: (cb) => ipcRenderer.on('postacim:sources', (_e, list) => cb(list)),
  pick: (id) => ipcRenderer.invoke('postacim:pick-source', id),
  cancelShare: () => ipcRenderer.invoke('postacim:cancel-share'),
});
