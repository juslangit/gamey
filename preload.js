const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('gamey', {
  app: { info: call('app:info') },
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    open: call('projects:open'),
    ideas: call('ideas'),
  },
  files: {
    list: call('files:list'),
    read: call('files:read'),
    write: call('files:write'),
    onChanged: on('files:changed'),
  },
  scene: {
    objects: call('scene:objects'),
    onOps: on('scene:ops'),
  },
  game: { onLog: on('game:log') },
  chat: {
    send: call('chat:send'),
    stop: call('chat:stop'),
    reset: call('chat:new'),
    loadHistory: call('chat:loadHistory'),
    saveHistory: call('chat:saveHistory'),
    onEvent: on('chat:event'),
  },
  history: {
    list: call('history:list'),
    undo: call('history:undo'),
    restore: call('history:restore'),
    onChanged: on('history:changed'),
  },
  usage: { onChanged: on('usage') },
  preview: { rect: call('preview:rect') },
  publish: {
    info: call('publish:info'),
    run: call('publish:run'),
    onProgress: on('publish:progress'),
  },
  shell: {
    openExternal: call('shell:openExternal'),
    openFolder: call('shell:openFolder'),
    openInBrowser: call('shell:openInBrowser'),
  },
});
