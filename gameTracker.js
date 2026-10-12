/**
 * GameTracker: Automated Game Session & Power Analytics Engine.
 * 
 * Accurately detects active 3D games (Steam, Epic, Ubisoft, Riot, Lesta, Roblox, etc.),
 * tracks gaming duration, electricity kWh consumed, exact money spent,
 * and records dedicated GPU graphics load and power draw during each gaming session.
 */

const { exec } = require('child_process');
const path = require('path');

// Friendly names dictionary for top games
const KNOWN_GAME_NAMES = {
    'robloxplayerbeta.exe': 'Roblox',
    'watchdogs2.exe': 'Watch Dogs 2',
    'watchdogs.exe': 'Watch Dogs',
    'watchdogslegion.exe': 'Watch Dogs: Legion',
    'cyberpunk2077.exe': 'Cyberpunk 2077',
    'gta5.exe': 'Grand Theft Auto V',
    'gtaiv.exe': 'Grand Theft Auto IV',
    'cs2.exe': 'Counter-Strike 2',
    'csgo.exe': 'Counter-Strike: Global Offensive',
    'dota2.exe': 'Dota 2',
    'valorant-win64-shipping.exe': 'Valorant',
    'valorant.exe': 'Valorant',
    'fortniteclient-win64-shipping.exe': 'Fortnite',
    'fortnite.exe': 'Fortnite',
    'r5apex.exe': 'Apex Legends',
    'minecraft.exe': 'Minecraft',
    'javaw.exe': 'Minecraft (Java)',
    'worldoftanks.exe': 'World of Tanks (Мир Танков)',
    'worldofwarships.exe': 'World of Warships (Мир Кораблей)',
    'warthunder.exe': 'War Thunder',
    'witcher3.exe': 'The Witcher 3: Wild Hunt',
    'eldenring.exe': 'Elden Ring',
    'darksoulsiii.exe': 'Dark Souls III',
    'forzahorizon5.exe': 'Forza Horizon 5',
    'forzahorizon4.exe': 'Forza Horizon 4',
    'starfield.exe': 'Starfield',
    'genshinimpact.exe': 'Genshin Impact',
    'honkaistarrail.exe': 'Honkai: Star Rail',
    'zenlesszonezero.exe': 'Zenless Zone Zero',
    'rustclient.exe': 'Rust',
    'rust.exe': 'Rust',
    'escapefromtarkov.exe': 'Escape from Tarkov',
    'destiny2.exe': 'Destiny 2',
    'overwatch.exe': 'Overwatch 2',
    'cod.exe': 'Call of Duty',
    'eurotrucks2.exe': 'Euro Truck Simulator 2',
    'beamng.drive.x64.exe': 'BeamNG.drive',
    'pubg.exe': 'PUBG: BATTLEGROUNDS',
    'tslgame.exe': 'PUBG: BATTLEGROUNDS',
    'helldivers2.exe': 'HELLDIVERS 2',
    'baldursgate3.exe': "Baldur's Gate 3",
    'bg3.exe': "Baldur's Gate 3",
    'bg3_dx11.exe': "Baldur's Gate 3 (DX11)",
    'palworld-win64-shipping.exe': 'Palworld',
    'rocketleague.exe': 'Rocket League',
    'deadbydaylight.exe': 'Dead by Daylight',
    'warframe.x64.exe': 'Warframe',
    'rdr2.exe': 'Red Dead Redemption 2',
    'assassinscreed_valhalla.exe': "Assassin's Creed Valhalla",
    'fifa23.exe': 'EA SPORTS FIFA 23',
    'fc24.exe': 'EA SPORTS FC 24',
    'fc25.exe': 'EA SPORTS FC 25',
    'blackmythwukong.exe': 'Black Myth: Wukong',
    'space_marine2.exe': 'Space Marine 2',
    'marvelsspiderman.exe': "Marvel's Spider-Man",
    'godofwar.exe': 'God of War'
};

class GameTracker {
    constructor(config, onSessionSaved) {
        this.config = config;
        this.onSessionSaved = onSessionSaved;
        this.currentGame = null;
        this.gameSessions = Array.isArray(config.game_sessions) ? config.game_sessions : [];
        this.isScanning = false;
        this.lastScanTime = 0;
        this.scanIntervalMs = 3000; // scan running processes every 3s
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        if (Array.isArray(newConfig.game_sessions)) {
            this.gameSessions = newConfig.game_sessions;
        }
    }

    /**
     * Resolves human-readable game title from exe name and install path
     */
    _resolveGameTitle(exeName, exePath) {
        if (!exePath) exePath = '';
        const lowerExe = (exeName || '').toLowerCase();
        if (KNOWN_GAME_NAMES[lowerExe]) {
            return KNOWN_GAME_NAMES[lowerExe];
        }

        // Check Steam directory: ...\steamapps\common\<GameFolder>\...
        const steamMatch = exePath.match(/steamapps[\\/]common[\\/]([^\\/]+)/i);
        if (steamMatch && steamMatch[1]) {
            return this._formatDirectoryName(steamMatch[1]);
        }

        // Check Epic Games directory: ...\Epic Games\<GameFolder>\...
        const epicMatch = exePath.match(/Epic Games[\\/]([^\\/]+)/i);
        if (epicMatch && epicMatch[1]) {
            return this._formatDirectoryName(epicMatch[1]);
        }

        // Check generic Games directory: ...\Games\<GameFolder>\...
        const gamesMatch = exePath.match(/[\\/]Games[\\/]([^\\/]+)/i);
        if (gamesMatch && gamesMatch[1]) {
            return this._formatDirectoryName(gamesMatch[1]);
        }

        // Check Ubisoft directory: ...\Ubisoft Game Launcher[\\/]games[\\/]([^\\/]+)/i
        const ubiMatch = exePath.match(/Ubisoft Game Launcher[\\/]games[\\/]([^\\/]+)/i);
        if (ubiMatch && ubiMatch[1]) {
            return this._formatDirectoryName(ubiMatch[1]);
        }

        // Fallback: clean exe name
        let clean = exeName.replace(/\.exe$/i, '');
        clean = clean.replace(/[-_]?(win64|win32|shipping|steam|retail|x64|x86)$/i, '');
        clean = clean.replace(/[-_]/g, ' ');
        return clean.trim();
    }

    _formatDirectoryName(dirName) {
        let name = dirName.replace(/[_-]/g, ' ');
        // Insert space before camel-case capital letters if needed
        name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
        return name.trim();
    }

    _isBackgroundDaemon(p) {
        if (!p) return true;
        const cmd = (p.CommandLine || '').toLowerCase();
        const name = (p.Name || '').toLowerCase();
        const wsBytes = Number(p.WorkingSetSize) || 0;
        const wsMb = wsBytes / (1024 * 1024);

        // 1. Roblox specific logic:
        if (name.includes('robloxplayerbeta')) {
            // Active 3D gameplay uses > 250MB (600MB - 1.5GB); idle tray stub or closed uses ~180MB
            return wsMb < 250;
        }

        // 2. Roblox CrashHandler or Studio
        if (name.includes('robloxcrashhandler') || name.includes('robloxstudio')) {
            return true;
        }

        // 3. Launchers and background helpers (Ubisoft, Lesta, Steam, Riot, Epic, EA, etc.)
        if (name.includes('lgc') || name.includes('renderer') || name.includes('errormonitor') ||
            name.includes('lestaerror') || name.includes('crashhandler') || name.includes('crashreport') ||
            name.includes('webhelper') || name.includes('installer') || name.includes('updater') ||
            name.includes('launcher') || name.includes('service') || name.includes('overlay') ||
            name.includes('uplay') || name.includes('upc') || name.includes('ubisoft') ||
            name.includes('eadesktop') || name.includes('origin') || name.includes('battlenet')) {
            return true;
        }

        // 4. Generic background / tray / silent flags across apps (if memory is low < 300MB)
        if (wsMb < 300) {
            if (cmd.includes('--launch-to-tray') || cmd.includes('--tray') || cmd.includes('-tray') ||
                cmd.includes('/tray') || cmd.includes('--background') || cmd.includes('-silent') ||
                cmd.includes('--silent') || cmd.includes('--autostart') || cmd.includes('--startup') ||
                cmd.includes('--no-startup-window') || cmd.includes('--hidden')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Scans for running game processes via fast in-memory query with foreground window priority
     */
    async scanProcesses() {
        if (this.isScanning) return;
        this.isScanning = true;

        try {
            const psCmd = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class WinApi {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  }
"@
$hwnd = [WinApi]::GetForegroundWindow()
$fgPid = 0
[WinApi]::GetWindowThreadProcessId($hwnd, [ref]$fgPid) | Out-Null

$knownList = '(?i)^(watchdogs|watchdogs2|watchdogslegion|cyberpunk2077|cs2|csgo|dota2|valorant|fortnite|r5apex|minecraft|worldoftanks|worldofwarships|warthunder|witcher3|eldenring|darksouls|forza|starfield|genshin|honkai|zenless|rust|tarkov|destiny2|overwatch|cod|eurotrucks2|beamng|pubg|tslgame|helldivers2|bg3|palworld|rocketleague|deadbydaylight|warframe|rdr2|assassinscreed|fifa|fc24|fc25|blackmyth|robloxplayerbeta)'

$procs = Get-CimInstance Win32_Process | Where-Object {
    $n = $_.Name
    $p = $_.ExecutablePath
    $ws = [double]$_.WorkingSetSize
    
    $isExcl = ($n -match '(?i)uplay|upc|ubisoft(game)?launcher|ubisoftconnect|steam(webhelper|service)?\.exe|epic(games)?(launcher|webhelper)|riotclient|lgc(\.exe|_renderer)|lestaerror|battle\.net|crashhandler|helper|antigravity|discord|chrome|msedge|spotify|installer|setup|eadesktop|origin') -or ($p -match '(?i)c:\\\\windows')
    
    (-not $isExcl) -and (
        ($n -match $knownList) -or
        ($p -and ($p -match 'steamapps[\\\\/]common|\\\\Games[\\\\/]|\\\\Epic Games|Ubisoft|Riot Games|Lesta|Roblox|Battle\.net|GOG Galaxy')) -or
        ($ws -gt 500000000 -and ($n -match '(?i)game|shipping|win64|dx11|dx12|d3d'))
    )
} | Select-Object ProcessId, Name, ExecutablePath, CommandLine, WorkingSetSize

[PSCustomObject]@{
    ForegroundPid = $fgPid
    Processes = @($procs)
} | ConvertTo-Json -Depth 3
`;

            const b64 = Buffer.from(psCmd, 'utf16le').toString('base64');
            const stdout = await new Promise((resolve) => {
                exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, { timeout: 3500 }, (err, out) => {
                    if (err || !out) return resolve('');
                    resolve(out.trim());
                });
            });

            if (!stdout) {
                return;
            }

            let parsed = null;
            try {
                parsed = JSON.parse(stdout);
            } catch (_) {
                return;
            }

            const rawList = Array.isArray(parsed.Processes) ? parsed.Processes : (parsed.Processes ? [parsed.Processes] : []);
            const valid = rawList.filter(p => p && p.Name && !this._isBackgroundDaemon(p));

            // If currently tracking a game that has now closed or lost validity, end it immediately
            if (this.currentGame && !valid.some(p => p.ProcessId === this.currentGame.pid)) {
                this._endCurrentGame();
            }

            if (valid.length === 0) {
                // No active game process detected
                if (this.currentGame) {
                    this._endCurrentGame();
                }
                return;
            }

            const fgPid = parsed.ForegroundPid || 0;
            // Prioritize the process that currently has the foreground active window
            const topProc = valid.find(p => p.ProcessId === fgPid) || valid[0];
            const title = this._resolveGameTitle(topProc.Name, topProc.ExecutablePath);

            if (!this.currentGame) {
                // New game session started
                this.currentGame = {
                    pid: topProc.ProcessId,
                    name: title,
                    exe: topProc.Name,
                    path: topProc.ExecutablePath || '',
                    startTime: Date.now(),
                    duration_sec: 0,
                    kwh: 0,
                    cost: 0,
                    watts_samples: [],
                    gpu_watts_samples: [],
                    gpu_load_samples: [],
                    avg_watts: 0,
                    avg_gpu_watts: 0,
                    avg_gpu_load: 0,
                    lastGpuTemp: 0
                };
            } else if (this.currentGame.pid !== topProc.ProcessId && this.currentGame.name !== title) {
                // Switched to another game
                this._endCurrentGame();
                this.currentGame = {
                    pid: topProc.ProcessId,
                    name: title,
                    exe: topProc.Name,
                    path: topProc.ExecutablePath || '',
                    startTime: Date.now(),
                    duration_sec: 0,
                    kwh: 0,
                    cost: 0,
                    watts_samples: [],
                    gpu_watts_samples: [],
                    gpu_load_samples: [],
                    avg_watts: 0,
                    avg_gpu_watts: 0,
                    avg_gpu_load: 0,
                    lastGpuTemp: 0
                };
            }
        } catch (e) {
            console.error('GameTracker scan error:', e);
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Called on each 1-second telemetry sample to accumulate electricity usage
     */
    onTelemetryTick(sample, dtSeconds, tariff) {
        const now = Date.now();
        if (now - this.lastScanTime > this.scanIntervalMs) {
            this.lastScanTime = now;
            this.scanProcesses();
        }

        if (!this.currentGame) {
            return null;
        }

        const totalWatts = sample.total_watts || 0;
        const gpuWatts = sample.gpu_watts || 0;
        const gpuLoad = sample.gpu_load_pct || 0;
        this.currentGame.lastGpuTemp = sample.gpu_temp_c || 0;

        this.currentGame.duration_sec += dtSeconds;
        const deltaKwh = (totalWatts / 1000.0) * (dtSeconds / 3600.0);
        this.currentGame.kwh += deltaKwh;
        this.currentGame.cost += deltaKwh * tariff;

        this.currentGame.watts_samples.push(totalWatts);
        this.currentGame.gpu_watts_samples.push(gpuWatts);
        this.currentGame.gpu_load_samples.push(gpuLoad);

        // Keep maximum 300 samples for moving calculation
        if (this.currentGame.watts_samples.length > 300) {
            this.currentGame.watts_samples.shift();
            this.currentGame.gpu_watts_samples.shift();
            this.currentGame.gpu_load_samples.shift();
        }

        const sumW = this.currentGame.watts_samples.reduce((a, b) => a + b, 0);
        const sumGpuW = this.currentGame.gpu_watts_samples.reduce((a, b) => a + b, 0);
        const sumLoad = this.currentGame.gpu_load_samples.reduce((a, b) => a + b, 0);
        const count = this.currentGame.watts_samples.length;

        this.currentGame.avg_watts = Math.round((sumW / count) * 10) / 10;
        this.currentGame.avg_gpu_watts = Math.round((sumGpuW / count) * 10) / 10;
        this.currentGame.avg_gpu_load = Math.round(sumLoad / count);

        return {
            is_active: true,
            name: this.currentGame.name,
            exe: this.currentGame.exe,
            duration_sec: Math.round(this.currentGame.duration_sec),
            kwh: this.currentGame.kwh,
            cost: this.currentGame.cost,
            current_watts: totalWatts,
            avg_watts: this.currentGame.avg_watts,
            gpu_watts: gpuWatts,
            avg_gpu_watts: this.currentGame.avg_gpu_watts,
            gpu_load_pct: gpuLoad,
            avg_gpu_load_pct: this.currentGame.avg_gpu_load,
            gpu_temp_c: this.currentGame.lastGpuTemp
        };
    }

    _endCurrentGame() {
        if (!this.currentGame) return;

        const dur = Math.round(this.currentGame.duration_sec);
        // Only record sessions that lasted at least 20 seconds
        if (dur >= 20) {
            const entry = {
                id: Date.now(),
                name: this.currentGame.name,
                exe: this.currentGame.exe,
                date: new Date().toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                duration_sec: dur,
                kwh: Number(this.currentGame.kwh.toFixed(4)),
                cost: Number(this.currentGame.cost.toFixed(3)),
                avg_watts: Math.round(this.currentGame.avg_watts),
                avg_gpu_watts: Math.round(this.currentGame.avg_gpu_watts),
                avg_gpu_load: Math.round(this.currentGame.avg_gpu_load)
            };

            this.gameSessions.unshift(entry);
            if (this.gameSessions.length > 60) {
                this.gameSessions = this.gameSessions.slice(0, 60);
            }

            if (typeof this.onSessionSaved === 'function') {
                this.onSessionSaved(this.gameSessions);
            }
        }

        this.currentGame = null;
    }

    clearHistory() {
        this.gameSessions = [];
        if (typeof this.onSessionSaved === 'function') {
            this.onSessionSaved(this.gameSessions);
        }
        return true;
    }

    getHistory() {
        return this.gameSessions;
    }

    getActiveGameSnapshot() {
        if (!this.currentGame) return null;
        return {
            is_active: true,
            name: this.currentGame.name,
            exe: this.currentGame.exe,
            duration_sec: Math.round(this.currentGame.duration_sec),
            kwh: this.currentGame.kwh,
            cost: this.currentGame.cost,
            avg_watts: this.currentGame.avg_watts,
            avg_gpu_watts: this.currentGame.avg_gpu_watts,
            avg_gpu_load_pct: this.currentGame.avg_gpu_load,
            gpu_temp_c: this.currentGame.lastGpuTemp
        };
    }
}

module.exports = GameTracker;
