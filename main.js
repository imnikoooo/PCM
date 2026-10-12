

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const TelemetryEngine = require('./telemetry');
const { detectHardware, getFallbackSpecs } = require('./hardwareDetector');
const GameTracker = require('./gameTracker');

// Elevate process priority to Above Normal on Windows for smooth, zero-stutter telemetry in heavy 3D games
try {
    if (os.constants?.priority?.PRIORITY_ABOVE_NORMAL !== undefined) {
        os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
    }
} catch (_) {}

// Configuration File Path (UserData isolated for packaging & clean multi-user support)
function getConfigPath() {
    try {
        const userData = app.getPath('userData');
        if (!fs.existsSync(userData)) {
            fs.mkdirSync(userData, { recursive: true });
        }
        return path.join(userData, 'config.json');
    } catch (_) {
        return path.join(__dirname, 'config.json');
    }
}

const DEFAULT_CONFIG = {
    first_run: true,
    language: 'en',
    currency_symbol: '$',
    custom_currency: '',
    tariff_per_kwh: 0.28,
    rate_interval_minutes: 60,
    smooth_numbers: false,
    cpu_tdp_watts: 120.0,
    gpu_tdp_watts: 200.0,
    gpu_name: '',
    monitor_hz: 144,
    monitor_preset: 'gaming_27_32',
    ram_sticks: 2,
    nvme_drives: 2,
    hdd_drives: 0,
    cooling_type: 'aio',
    case_fans: 4,
    rgb_lighting: true,
    psu_rated_watts: 850,
    psu_cert: 'gold',
    hud_mode: 'normal',
    hud_show_power: true,
    hud_show_rate: true,
    hud_show_avg: false,
    hud_show_session: true,
    hud_interval_sec: 2,
    hud_always_on_top: true,
    hud_opacity: 100, // 20% to 100%
    hud_click_through: false,
    autostart: true,
    hud_on_startup: true,
    hud_pos_x: 40,
    hud_pos_y: 40,
    session_cost: 0.0,
    session_kwh: 0.0,
    session_seconds: 0,
    game_sessions: []
};

function loadConfig() {
    try {
        const userCfgPath = getConfigPath();
        const localCfgPath = path.join(__dirname, 'config.json');
        if (fs.existsSync(userCfgPath)) {
            const raw = fs.readFileSync(userCfgPath, 'utf-8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } else if (fs.existsSync(localCfgPath)) {
            const raw = fs.readFileSync(localCfgPath, 'utf-8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        }
    } catch (e) {
        console.error('Error loading config:', e);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
    try {
        const userCfgPath = getConfigPath();
        fs.writeFileSync(userCfgPath, JSON.stringify(cfg, null, 4), 'utf-8');
    } catch (e) {
        console.error('Error saving config:', e);
    }
}

let config = loadConfig();
const telemetry = new TelemetryEngine(config);

let hudWindow = null;
let dashboardWindow = null;
let onboardingWindow = null;
let tray = null;
let telemetryTimer = null;
let lastGameTitle = null;

// Game Auto-Tracker Instance
const gameTracker = new GameTracker(config, (sessions) => {
    config.game_sessions = sessions;
    saveConfig(config);
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('game:history-updated', sessions);
    }
    updateTrayMenu();
});

// Configure Windows Autostart in Background
function applyAutostart(enabled) {
    try {
        const exePath = app.getPath('exe');
        app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true,
            path: exePath,
            args: ['--hidden']
        });

        if (process.platform === 'win32') {
            if (enabled) {
                const cmd = `powershell -NoProfile -Command "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'PowerCostMonitor' -Value '\\\"${exePath}\\\" --hidden'"`;
                exec(cmd, () => {});
            } else {
                const cmd = `powershell -NoProfile -Command "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'PowerCostMonitor' -ErrorAction SilentlyContinue"`;
                exec(cmd, () => {});
            }
        }
    } catch (e) {
        console.error('Error applying autostart:', e);
    }
}

// Get dynamic HUD dimensions with strict widths to eliminate stretching
function getHudDimensions(cfg) {
    if (cfg.hud_mode === 'mini') {
        return { width: 118, height: 84 };
    }
    // 3 columns = 280px, 4 columns (with avg) = 360px
    const width = (cfg.hud_show_avg === true) ? 360 : 280;
    return { width, height: 104 };
}

function applyHudWindowDimensions(cfg) {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const dims = getHudDimensions(cfg);
    hudWindow.setResizable(true);
    hudWindow.setSize(dims.width, dims.height);
    hudWindow.setResizable(false);
}

// Create Native Crisp Tray Icon
function createTrayIcon() {
    const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="28" height="28" rx="7" fill="#0B0F17" stroke="#10B981" stroke-width="2"/>
        <polygon points="17 5 7 19 15 19 14 27 24 13 16 13 17 5" fill="#10B981"/>
    </svg>`;
    return nativeImage.createFromBuffer(Buffer.from(svg));
}

// Toggle Click-Through Mode (pass clicks through to games)
function toggleClickThrough() {
    config.hud_click_through = !config.hud_click_through;
    saveConfig(config);

    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.setIgnoreMouseEvents(config.hud_click_through === true, { forward: true });
        hudWindow.webContents.send('hud:click-through-toggled', config.hud_click_through);
    }
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('config:changed', config);
    }
    updateTrayMenu();
}

// 1. Create Floating HUD Overlay Window (Optimized for Games like Watch Dogs 2)
function createHudWindow(startHidden = false) {
    const dims = getHudDimensions(config);
    let x = parseInt(config.hud_pos_x, 10);
    let y = parseInt(config.hud_pos_y, 10);

    // Validate saved position across all currently connected displays (including negative coordinates on secondary monitors)
    const allDisplays = screen.getAllDisplays();
    const isVisible = allDisplays.some(d => {
        const b = d.bounds;
        return x >= b.x - dims.width + 20 && x <= b.x + b.width - 20 &&
               y >= b.y - dims.height + 20 && y <= b.y + b.height - 20;
    });

    if (!isVisible || isNaN(x) || isNaN(y)) {
        const primary = screen.getPrimaryDisplay();
        x = primary.bounds.x + 40;
        y = primary.bounds.y + 40;
        config.hud_pos_x = x;
        config.hud_pos_y = y;
    }

    hudWindow = new BrowserWindow({
        width: dims.width,
        height: dims.height,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: config.hud_always_on_top ?? true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        show: !startHidden,
        focusable: false, // Prevents taking focus away from games, avoiding game minimization
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Highest top-most level for gaming overlay compatibility without D3D device reset
    if (config.hud_always_on_top ?? true) {
        hudWindow.setAlwaysOnTop(true, 'screen-saver');
        hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    // Apply Opacity
    const opacityPct = Math.max(20, Math.min(100, Number(config.hud_opacity) || 100));
    hudWindow.setOpacity(opacityPct / 100.0);

    // Apply Click-Through
    if (config.hud_click_through) {
        hudWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    hudWindow.loadFile('hud.html');

    // Save position upon window move (works seamlessly on any monitor)
    hudWindow.on('moved', () => {
        if (!hudWindow || hudWindow.isDestroyed()) return;
        const [curX, curY] = hudWindow.getPosition();
        config.hud_pos_x = curX;
        config.hud_pos_y = curY;
        saveConfig(config);
    });

    hudWindow.on('closed', () => {
        hudWindow = null;
    });
}

// 2. Create Expanded Dashboard Window
function createDashboardWindow(showImmediately = false) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: sW, height: sH } = primaryDisplay.workAreaSize;

    dashboardWindow = new BrowserWindow({
        width: 630,
        height: 750,
        x: Math.round((sW - 630) / 2),
        y: Math.round((sH - 750) / 2),
        frame: false,
        transparent: true,
        resizable: false,
        hasShadow: false,
        show: showImmediately,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    dashboardWindow.loadFile('dashboard.html');

    dashboardWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            dashboardWindow.hide();
        }
    });
}

// 3. Create Welcome Onboarding Window
function createOnboardingWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: sW, height: sH } = primaryDisplay.workAreaSize;

    onboardingWindow = new BrowserWindow({
        width: 520,
        height: 610,
        x: Math.round((sW - 520) / 2),
        y: Math.round((sH - 610) / 2),
        frame: false,
        transparent: true,
        resizable: false,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    onboardingWindow.loadFile('onboarding.html');
}

// 4. Setup Dynamic System Tray
function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;

    const lang = config.language || 'en';
    const curSym = config.currency_symbol || '$';
    const activeGame = gameTracker.getActiveGameSnapshot();

    let gameLabel = '🎮 Game Tracker: Waiting for game...';
    if (activeGame) {
        if (lang === 'ru') gameLabel = `🎮 В игре: ${activeGame.name} (${curSym}${activeGame.cost.toFixed(2)})`;
        else if (lang === 'es') gameLabel = `🎮 En juego: ${activeGame.name} (${curSym}${activeGame.cost.toFixed(2)})`;
        else gameLabel = `🎮 In-game: ${activeGame.name} (${curSym}${activeGame.cost.toFixed(2)})`;
    } else {
        if (lang === 'ru') gameLabel = '🎮 Игровой трекер: Ожидание игры...';
        else if (lang === 'es') gameLabel = '🎮 Seguimiento: Esperando juego...';
        else gameLabel = '🎮 Game Tracker: Waiting for game...';
    }

    let clickThroughLabel = '🖱️ Click-Through Mode: [OFF] (Ctrl+Shift+X)';
    if (config.hud_click_through) {
        if (lang === 'ru') clickThroughLabel = '🖱️ Сквозные клики (Click-Through): [✓ ВКЛ] (Ctrl+Shift+X)';
        else if (lang === 'es') clickThroughLabel = '🖱️ Modo Clics Transparentes: [✓ ACT] (Ctrl+Shift+X)';
        else clickThroughLabel = '🖱️ Click-Through Mode: [✓ ON] (Ctrl+Shift+X)';
    } else {
        if (lang === 'ru') clickThroughLabel = '🖱️ Сквозные клики (Click-Through): [ВЫКЛ] (Ctrl+Shift+X)';
        else if (lang === 'es') clickThroughLabel = '🖱️ Modo Clics Transparentes: [DES] (Ctrl+Shift+X)';
        else clickThroughLabel = '🖱️ Click-Through Mode: [OFF] (Ctrl+Shift+X)';
    }

    const isHudVis = hudWindow && hudWindow.isVisible();
    let hudVisibleLabel = isHudVis ? '👁️ Hide HUD Overlay (Ctrl+Shift+P)' : '👁️ Show HUD Overlay (Ctrl+Shift+P)';
    if (isHudVis) {
        if (lang === 'ru') hudVisibleLabel = '👁️ Скрыть виджет HUD (Ctrl+Shift+P)';
        else if (lang === 'es') hudVisibleLabel = '👁️ Ocultar widget HUD (Ctrl+Shift+P)';
    } else {
        if (lang === 'ru') hudVisibleLabel = '👁️ Показать виджет HUD (Ctrl+Shift+P)';
        else if (lang === 'es') hudVisibleLabel = '👁️ Mostrar widget HUD (Ctrl+Shift+P)';
    }

    let modeLabel = (config.hud_mode === 'mini') ? '⛶ Widget Mode: Mini ➔ Full (Ctrl+Shift+M)' : '⛶ Widget Mode: Full ➔ Mini (Ctrl+Shift+M)';
    if (config.hud_mode === 'mini') {
        if (lang === 'ru') modeLabel = '⛶ Режим виджета: Mini ➔ Full (Ctrl+Shift+M)';
        else if (lang === 'es') modeLabel = '⛶ Modo widget: Mini ➔ Completo (Ctrl+Shift+M)';
    } else {
        if (lang === 'ru') modeLabel = '⛶ Режим виджета: Full ➔ Mini (Ctrl+Shift+M)';
        else if (lang === 'es') modeLabel = '⛶ Modo widget: Completo ➔ Mini (Ctrl+Shift+M)';
    }

    let openDashboardLabel = '⚡ Open Dashboard (Ctrl+Shift+D)';
    if (lang === 'ru') openDashboardLabel = '⚡ Открыть дашборд (Ctrl+Shift+D)';
    else if (lang === 'es') openDashboardLabel = '⚡ Abrir panel de control (Ctrl+Shift+D)';

    let resetSessionLabel = '↺ Reset Current Session';
    if (lang === 'ru') resetSessionLabel = '↺ Сбросить текущую сессию';
    else if (lang === 'es') resetSessionLabel = '↺ Reiniciar sesión actual';

    let quitLabel = '❌ Quit';
    if (lang === 'ru') quitLabel = '❌ Выход';
    else if (lang === 'es') quitLabel = '❌ Salir';

    const contextMenu = Menu.buildFromTemplate([
        {
            label: gameLabel,
            enabled: false
        },
        { type: 'separator' },
        {
            label: openDashboardLabel,
            click: () => {
                if (dashboardWindow) {
                    dashboardWindow.show();
                    dashboardWindow.focus();
                }
            }
        },
        {
            label: hudVisibleLabel,
            click: () => {
                if (!hudWindow) return;
                if (hudWindow.isVisible()) {
                    hudWindow.hide();
                } else {
                    hudWindow.show();
                }
                updateTrayMenu();
            }
        },
        {
            label: modeLabel,
            click: () => {
                config.hud_mode = (config.hud_mode === 'mini') ? 'normal' : 'mini';
                saveConfig(config);
                if (hudWindow && !hudWindow.isDestroyed()) {
                    applyHudWindowDimensions(config);
                    hudWindow.webContents.send('config:changed', config);
                }
                updateTrayMenu();
            }
        },
        {
            label: clickThroughLabel,
            click: () => {
                toggleClickThrough();
            }
        },
        { type: 'separator' },
        {
            label: resetSessionLabel,
            click: () => {
                telemetry.resetSession();
                config.session_cost = 0;
                config.session_kwh = 0;
                config.session_seconds = 0;
                saveConfig(config);
            }
        },
        { type: 'separator' },
        {
            label: quitLabel,
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    let tipText = 'Power Cost Monitor • Real-time PC Power & Electricity Cost Tracker';
    if (lang === 'ru') tipText = 'Power Cost Monitor • Расчёт стоимости электроэнергии и игровой трекер';
    else if (lang === 'es') tipText = 'Power Cost Monitor • Control de consumo de PC y coste eléctrico';
    tray.setToolTip(tipText);

    tray.setContextMenu(contextMenu);
}

function setupTray() {
    tray = new Tray(createTrayIcon());
    let tipText = 'Power Cost Monitor • Real-time PC Power & Electricity Cost Tracker';
    if (config.language === 'ru') tipText = 'Power Cost Monitor • Расчёт стоимости электроэнергии и игровой трекер';
    else if (config.language === 'es') tipText = 'Power Cost Monitor • Control de consumo de PC y coste eléctrico';
    tray.setToolTip(tipText);
    updateTrayMenu();

    tray.on('click', () => {
        if (dashboardWindow) {
            if (dashboardWindow.isVisible()) {
                dashboardWindow.hide();
            } else {
                dashboardWindow.show();
                dashboardWindow.focus();
            }
        }
    });
}

// 5. Register Global Shortcuts for In-Game Convenience
function registerGlobalShortcuts() {
    try {
        globalShortcut.unregisterAll();

        // Ctrl+Shift+X: Toggle Click-Through
        globalShortcut.register('CommandOrControl+Shift+X', () => {
            toggleClickThrough();
        });

        // Ctrl+Shift+P: Toggle HUD visibility
        globalShortcut.register('CommandOrControl+Shift+P', () => {
            if (!hudWindow || hudWindow.isDestroyed()) return;
            if (hudWindow.isVisible()) {
                hudWindow.hide();
            } else {
                hudWindow.show();
            }
            updateTrayMenu();
        });

        // Ctrl+Shift+M: Toggle Full/Mini mode
        globalShortcut.register('CommandOrControl+Shift+M', () => {
            config.hud_mode = (config.hud_mode === 'mini') ? 'normal' : 'mini';
            saveConfig(config);
            if (hudWindow && !hudWindow.isDestroyed()) {
                applyHudWindowDimensions(config);
                hudWindow.webContents.send('config:changed', config);
            }
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                dashboardWindow.webContents.send('config:changed', config);
            }
            updateTrayMenu();
        });

        // Ctrl+Shift+D: Toggle Dashboard
        globalShortcut.register('CommandOrControl+Shift+D', () => {
            if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
            if (dashboardWindow.isVisible()) {
                dashboardWindow.hide();
            } else {
                dashboardWindow.show();
                dashboardWindow.focus();
            }
        });
    } catch (err) {
        console.warn('Global shortcuts registration error:', err);
    }
}

// 6. IPC Handlers
ipcMain.handle('config:get', () => config);

ipcMain.handle('config:update', (_event, newConfig) => {
    config = { ...config, ...newConfig };
    saveConfig(config);
    telemetry.updateConfig(config);
    gameTracker.updateConfig(config);

    if (newConfig.autostart !== undefined) {
        applyAutostart(newConfig.autostart);
    }

    // Update HUD Always On Top flag, opacity, click-through & dimensions dynamically
    if (hudWindow && !hudWindow.isDestroyed()) {
        if (newConfig.hud_always_on_top !== undefined) {
            hudWindow.setAlwaysOnTop(newConfig.hud_always_on_top, 'screen-saver');
        }
        if (newConfig.hud_opacity !== undefined) {
            const op = Math.max(20, Math.min(100, Number(newConfig.hud_opacity) || 100));
            hudWindow.setOpacity(op / 100.0);
        }
        if (newConfig.hud_click_through !== undefined) {
            hudWindow.setIgnoreMouseEvents(newConfig.hud_click_through === true, { forward: true });
        }
        applyHudWindowDimensions(config);
        hudWindow.webContents.send('config:changed', config);
    }

    updateTrayMenu();
    return config;
});

ipcMain.handle('hardware:autodetect', async () => {
    try {
        const specs = await detectHardware();
        return { success: true, specs: specs || getFallbackSpecs() };
    } catch (e) {
        console.error('Auto detect error:', e);
        return { success: true, specs: getFallbackSpecs() };
    }
});

ipcMain.handle('hud:toggle-mode', () => {
    config.hud_mode = (config.hud_mode === 'mini') ? 'normal' : 'mini';
    saveConfig(config);
    if (hudWindow && !hudWindow.isDestroyed()) {
        applyHudWindowDimensions(config);
        hudWindow.webContents.send('config:changed', config);
    }
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('config:changed', config);
    }
    updateTrayMenu();
    return config.hud_mode;
});

ipcMain.handle('session:reset', () => {
    telemetry.resetSession();
    config.session_cost = 0;
    config.session_kwh = 0;
    config.session_seconds = 0;
    saveConfig(config);
    return true;
});

ipcMain.handle('game:get-history', () => {
    return gameTracker.getHistory();
});

ipcMain.handle('game:clear-history', () => {
    return gameTracker.clearHistory();
});

ipcMain.handle('window:minimize', () => {
    if (dashboardWindow) dashboardWindow.minimize();
});

ipcMain.handle('window:close', () => {
    if (dashboardWindow) dashboardWindow.hide();
});

ipcMain.handle('window:toggle-dashboard', () => {
    if (!dashboardWindow) return;
    if (dashboardWindow.isVisible()) {
        dashboardWindow.hide();
    } else {
        dashboardWindow.webContents.send('dashboard:reset-apply');
        dashboardWindow.webContents.send('config:changed', config);
        dashboardWindow.show();
        dashboardWindow.focus();
    }
});

ipcMain.handle('window:toggle-hud', () => {
    if (!hudWindow) return;
    if (hudWindow.isVisible()) {
        hudWindow.hide();
    } else {
        hudWindow.show();
    }
    updateTrayMenu();
});

ipcMain.handle('onboarding:launch', () => {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.show();
        onboardingWindow.focus();
    } else {
        createOnboardingWindow();
    }
});

ipcMain.handle('open:external', (_event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        shell.openExternal(url);
    }
});

ipcMain.handle('onboarding:complete', async (_event, answers) => {
    if (answers && typeof answers === 'object') {
        if (answers.currency_symbol) config.currency_symbol = answers.currency_symbol;
        if (answers.tariff_per_kwh !== undefined) config.tariff_per_kwh = Number(answers.tariff_per_kwh);
        if (answers.smooth_numbers !== undefined) config.smooth_numbers = Boolean(answers.smooth_numbers);
        if (answers.cooling_type) config.cooling_type = answers.cooling_type;
        if (answers.hud_mode) config.hud_mode = answers.hud_mode;
        if (answers.language) config.language = answers.language;
    }
    config.first_run = false;
    saveConfig(config);

    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.close();
        onboardingWindow = null;
    }

    // Auto-detect hardware in background to populate CPU/GPU/RAM/PSU/monitor accurately
    try {
        const specs = await detectHardware();
        if (specs) {
            if (specs.cpu?.tdp_watts) config.cpu_tdp_watts = specs.cpu.tdp_watts;
            if (specs.gpu?.name) config.gpu_name = specs.gpu.name;
            if (specs.gpu?.tdp_watts) config.gpu_tdp_watts = specs.gpu.tdp_watts;
            if (specs.monitor?.hz) config.monitor_hz = specs.monitor.hz;
            if (specs.monitor?.preset) config.monitor_preset = specs.monitor.preset;
            if (specs.ram?.sticks) config.ram_sticks = specs.ram.sticks;
            if (specs.storage?.nvme_drives !== undefined) config.nvme_drives = specs.storage.nvme_drives;
            if (specs.storage?.hdd_drives !== undefined) config.hdd_drives = specs.storage.hdd_drives;
            if (specs.psu_suggested_watts) config.psu_rated_watts = specs.psu_suggested_watts;
            saveConfig(config);
        }
    } catch (e) {
        console.warn('Background auto-detect during onboarding error:', e);
    }

    if (!hudWindow || hudWindow.isDestroyed()) {
        createHudWindow(false);
    } else {
        applyHudWindowDimensions(config);
        hudWindow.webContents.send('config:changed', config);
        hudWindow.show();
    }

    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        createDashboardWindow(true);
    } else {
        dashboardWindow.webContents.send('dashboard:reset-apply');
        dashboardWindow.webContents.send('config:changed', config);
        dashboardWindow.show();
        dashboardWindow.focus();
    }
});

// App Lifecycle
app.whenReady().then(() => {
    setupTray();
    registerGlobalShortcuts();

    if (config.autostart) {
        applyAutostart(true);
    }

    const isHiddenLaunch = process.argv.includes('--hidden') || process.argv.includes('--autostart');

    if (config.first_run) {
        createOnboardingWindow();
    } else {
        // If launched via Windows startup, honor hud_on_startup setting
        const shouldHideHud = isHiddenLaunch && config.hud_on_startup === false;
        createHudWindow(shouldHideHud);
        createDashboardWindow(!isHiddenLaunch);
    }

    // Start 1Hz Telemetry Loop with Integrated Game Tracking
    telemetryTimer = setInterval(async () => {
        try {
            const sample = await telemetry.getSample();
            const tariff = Number(config.tariff_per_kwh) || 0.28;
            
            // Real-time Game Tracking tick
            const gameSnapshot = gameTracker.onTelemetryTick(sample, 1.0, tariff);
            sample.active_game = gameSnapshot;

            const currentTitle = gameSnapshot ? gameSnapshot.name : null;
            if (currentTitle !== lastGameTitle) {
                lastGameTitle = currentTitle;
                updateTrayMenu();
            }

            if (hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible()) {
                hudWindow.webContents.send('telemetry:update', sample);
            }

            if (dashboardWindow && !dashboardWindow.isDestroyed() && dashboardWindow.isVisible()) {
                dashboardWindow.webContents.send('telemetry:update', sample);
            }
        } catch (e) {
            console.error('Telemetry tick error:', e);
        }
    }, 1000);
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (telemetryTimer) clearInterval(telemetryTimer);

    // End active game session cleanly if any
    if (gameTracker.currentGame) {
        gameTracker._endCurrentGame();
    }

    // Save final stats
    config.session_cost = telemetry.sessionCost;
    config.session_kwh = telemetry.sessionKwh;
    config.session_seconds = telemetry.sessionSeconds;

    if (hudWindow && !hudWindow.isDestroyed()) {
        const [x, y] = hudWindow.getPosition();
        config.hud_pos_x = x;
        config.hud_pos_y = y;
    }

    saveConfig(config);
});

app.on('window-all-closed', (e) => {
    // Keep app alive in background / system tray
    e.preventDefault();
});
