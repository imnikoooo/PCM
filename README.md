# ⚡ Power Cost Monitor

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.0.0-10B981?style=for-the-badge&logo=electron" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-38BDF8?style=for-the-badge&logo=windows" alt="Platform Windows" />
  <img src="https://img.shields.io/badge/UI-Google%20Material%203-A78BFA?style=for-the-badge" alt="Material 3" />
  <img src="https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/Author-notniko-EC4899?style=for-the-badge&logo=github" alt="Author notniko" />
</p>

<p align="center">
  <strong>Real-time PC electricity cost and AC wall power draw monitor with an in-game HUD overlay for Windows.</strong><br>
  Accurately calculates what your gaming rig costs to run per hour, per session, and per game down to the fraction of a cent.
</p>

<p align="center">
  <a href="https://notniko.com">Website: notniko.com</a> •
  <a href="https://github.com/imnikoooo/PCM">GitHub: @imnikoooo/PCM</a> •
  <a href="https://github.com/imnikoooo/PCM/releases">Download Latest Installer</a>
</p>

---

## 🌟 Why Power Cost Monitor?

Most hardware monitors tell you temperatures and percentages, but never answer the real-world question: **how much money is this PC consuming from the electrical outlet right now?**

**Power Cost Monitor** simulates a physical socket power meter (*Kill-A-Watt*) with high accuracy by combining:
1. Direct GPU telemetry (NVIDIA NVML / SMI board power sensors).
2. Dynamic CPU scaling based on architecture and load.
3. Peripheral physics (DDR4/DDR5 sticks, NVMe Gen4/Gen5 SSDs, AIO liquid pump vs air cooler, case fans, RGB lighting, and monitor refresh rate up to 360 Hz).
4. Non-linear **80 PLUS PSU efficiency curves** (Bronze, Silver, Gold, Platinum, Titanium) accounting for internal DC-to-AC conversion heat loss.

---

## ✨ Features

### 🎮 Dual-Mode Gaming HUD Overlay
- **Standard Pill HUD (Full Mode)**: Elegantly floats above your desktop or games, showing real-time **Watts**, **Rate/hr**, **Average/hr**, **Session Total**, and **Active Game badge**.
- **Mini Cube HUD (Compact Mode)**: Ultra-compact (118×84 px) high-contrast widget designed for competitive esports gamers who need zero distraction.
- **Click-Through Mode (`Ctrl + Shift + X`)**: Makes the HUD completely transparent to mouse clicks so your cursor and crosshair interact directly with your game.
- **Adjustable Opacity**: Smoothly tune HUD transparency from 20% to 100%.

### 🕹️ Intelligent 3D Game Cost Tracker
- **Automatic Game Detection**: Instantly recognizes 3D titles across Steam, Epic Games, Ubisoft Connect, EA App, Riot Games, and Battle.net (*Cyberpunk 2077, Watch Dogs 2, Roblox, GTA V, Counter-Strike 2, Apex Legends, etc.*).
- **Anti-Cheat & Launcher Filter**: Eliminates false positives by filtering out background web helpers and crash monitors (e.g. correctly detects *Watch Dogs 2* instead of `UplayWebCore`).
- **Roblox Memory-Aware Tracking**: Distinguishes between Roblox sitting minimized in the tray (~180 MB) and active gameplay (>1.2 GB RAM).
- **Instant Session Lifecycle**: Automatically starts recording when you boot a game and ends instantly the second you quit.
- **Historical Records**: Logs every session's playtime, total kWh, money spent, and average GPU load.

### 🔍 1-Click Automated Hardware Detection
- Uses fast, safe in-memory WMI/CIM queries (runs in ~1.3s with zero temporary files).
- Auto-detects your **CPU**, **GPU**, **VRAM**, **RAM sticks**, **NVMe SSDs**, **HDDs**, and **Monitor Refresh Rate (Hz)**, then automatically calculates your recommended 80 PLUS PSU wattage.

### 🎨 Google Material You (Material 3) Design
- Crafted according to official Google Material 3 design guidelines: tonal surface containers, pill-shaped navigation segments, authentic animated switches, and clean typography.

### 🌐 Trilingual Interface (English, Russian & Spanish)
- **English by default** with a 1-click runtime language toggle to Russian and Spanish in the title bar or settings.
- All windows (HUD Overlay, Dashboard, System Tray, and Setup Wizard) seamlessly switch languages and units on the fly.

### 🧙 Single-Run Setup Wizard
- Welcomes new users on first startup to choose their preferred HUD mode (Standard Pill vs Mini Cube), regional utility tariff preset, and cooling system.
- Automatically marks initial setup as completed so it never interrupts subsequent launches (can be reopened anytime from Settings).

---

## ⌨️ Global Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Ctrl + Shift + P`** | **Toggle HUD Visibility** | Instantly hide or show the floating overlay |
| **`Ctrl + Shift + M`** | **Switch HUD Mode** | Toggle between **Standard Pill** and **Mini Cube** |
| **`Ctrl + Shift + X`** | **Click-Through Mode** | Toggle click-through (pass mouse clicks directly to game) |
| **`Ctrl + Shift + D`** | **Open Dashboard** | Open or bring the settings & telemetry window to focus |

---

## 💡 Gaming Overlay Tip (DirectX & Vulkan)

Some exclusive fullscreen games (like *Watch Dogs 2*, *Rainbow Six Siege*, or older DirectX 11 titles) take direct exclusive control over the monitor output and may hide desktop overlays.

> [!TIP]
> In your game's display/graphics settings, set the **Display Mode** to **Borderless Fullscreen** (or *Windowed Fullscreen*).
> - Input lag and FPS remain identical to exclusive fullscreen on Windows 10/11.
> - The Power Cost Monitor HUD will float seamlessly on top of the game with full click-through support!

---

## 🚀 Getting Started

### Option 1: Prebuilt Installer (Recommended)
1. Download the latest `Power Cost Monitor Setup.exe` from the [Releases](https://github.com/imnikoooo/power-cost-monitor/releases) page.
2. Run the installer. It will automatically create desktop and Start Menu shortcuts.
3. Complete the quick 3-step setup wizard and enjoy!

### Option 2: Run from Source

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- Windows 10 or Windows 11

```bash
# 1. Clone the repository
git clone https://github.com/imnikoooo/PCM.git
cd PCM

# 2. Install dependencies
npm install

# 3. Start the application
npm start
```

### Packaging / Building Binary
To generate an NSIS installer or portable executable:
```bash
# Build NSIS Setup Installer (.exe)
npm run dist:nsis

# Build Portable standalone executable (.exe)
npm run dist:portable
```
The output binaries will be placed in the `dist/` directory.

---

## 📁 Project Architecture

```
power-cost-monitor/
├── main.js                 # Electron main process, window management, tray & IPC
├── preload.js              # Context-isolated secure IPC bridge
├── telemetry.js            # AC wall draw physics engine & 80 PLUS PSU curves
├── hardwareDetector.js     # PowerShell WMI/CIM hardware detection module
├── gameTracker.js          # Process monitor, game detection & history logger
├── hud.html                # Floating HUD overlay (Standard Pill & Mini Cube)
├── dashboard.html          # Material 3 telemetry dashboard, history & settings
├── onboarding.html         # First-run setup wizard
├── styles.css              # Shared styles, glassmorphism & typography
├── package.json            # Application metadata & build configuration
└── README.md               # Documentation
```

---

## 📊 Electricity Tariffs & Regional Presets

Built-in electricity tariffs (based on US EIA 2026 data and regional utility rates):
- **US National Average**: $0.183 / kWh
- **California (PG&E / SCE)**: $0.336 / kWh
- **New York City (ConEdison)**: $0.338 / kWh
- **Texas (ERCOT)**: $0.159 / kWh
- **Washington State (Hydro)**: $0.115 / kWh
- **Hawaii (HECO)**: $0.440 / kWh
- **United Kingdom (Ofgem Cap)**: £0.265 / kWh
- **Germany (EU Average)**: €0.395 / kWh
- **Spain (Madrid / PVPC)**: €0.198 / kWh
- **Russia (Moscow / Regional)**: 6.50 ₽ / 2.20 ₽ per kWh
- **Kazakhstan (Almaty)**: 28.00 ₸ / kWh
- *Custom currency and custom rate support for any region in the world.*

---

## 👤 Author & Credits

Created by **notniko**:
- **Website**: [notniko.com](https://notniko.com)
- **GitHub**: [@imnikoooo](https://github.com/imnikoooo)
- **Repository**: [imnikoooo/PCM](https://github.com/imnikoooo/PCM)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Feel free to fork, customize, and contribute!
