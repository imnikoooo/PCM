const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onTelemetry: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('telemetry:update', handler);
        return () => ipcRenderer.removeListener('telemetry:update', handler);
    },
    getConfig: () => ipcRenderer.invoke('config:get'),
    updateConfig: (newConfig) => ipcRenderer.invoke('config:update', newConfig),
    resetSession: () => ipcRenderer.invoke('session:reset'),
    toggleDashboard: () => ipcRenderer.invoke('window:toggle-dashboard'),
    toggleHud: () => ipcRenderer.invoke('window:toggle-hud'),
    toggleHudMode: () => ipcRenderer.invoke('hud:toggle-mode'),
    dockHud: () => {},
    undockHud: () => {},
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    completeOnboarding: (userData) => ipcRenderer.invoke('onboarding:complete', userData),
    launchOnboarding: () => ipcRenderer.invoke('onboarding:launch'),
    saveHudPosition: (x, y) => ipcRenderer.invoke('hud:save-position', { x, y }),
    autoDetectHardware: () => ipcRenderer.invoke('hardware:autodetect'),
    onResetApply: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('dashboard:reset-apply', handler);
        return () => ipcRenderer.removeListener('dashboard:reset-apply', handler);
    },
    onConfigChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('config:changed', handler);
        return () => ipcRenderer.removeListener('config:changed', handler);
    },
    getGameHistory: () => ipcRenderer.invoke('game:get-history'),
    clearGameHistory: () => ipcRenderer.invoke('game:clear-history'),
    onGameHistoryUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('game:history-updated', handler);
        return () => ipcRenderer.removeListener('game:history-updated', handler);
    },
    onClickThroughToggled: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('hud:click-through-toggled', handler);
        return () => ipcRenderer.removeListener('hud:click-through-toggled', handler);
    },
    openExternal: (url) => ipcRenderer.invoke('open:external', url)
});
