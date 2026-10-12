// İki yerelde sayfa kullanır (yüklenen web uygulaması değil):
//  - kurulum penceresi: postacim.saveServer(url)
//  - ekran paylaşımı seçici: postacim.onSources / pick / cancelShare
// Ana pencere bunları hiç kullanmaz — yüklenen koda köprü yok
// (yüklenen kod postacim'in kendi kodu olsa da yüzey küçük kalsın).
// .cjs: package "type":"module" altında CommonJS kalmalı (preload ESM'siz).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postacim', {
  saveServer: (url) => ipcRenderer.invoke('postacim:save-server', url),
  onSources: (cb) => ipcRenderer.on('postacim:sources', (_e, list) => cb(list)),
  pick: (id) => ipcRenderer.invoke('postacim:pick-source', id),
  cancelShare: () => ipcRenderer.invoke('postacim:cancel-share'),
});
