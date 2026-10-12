/**
 * High-Precision Telemetry & Electrical Physics Engine.
 * Accurately models every component affecting PC power draw:
 *  - NVIDIA GPU: Direct hardware shunt reading (Total Board Power via NVML)
 *  - CPU: Multi-core load (%) + dynamic voltage/frequency boost curve
 *  - Monitor: Scales with panel size, resolution, and Refresh Rate (60Hz -> 360Hz)
 *  - RAM: DDR4/DDR5 sticks with EXPO/XMP voltage
 *  - Storage: PCIe 4.0/5.0 NVMe SSDs & mechanical HDDs
 *  - Cooling: Case fans, AIO liquid pump, and RGB controller
 *  - Power Supply: Real non-linear 80 PLUS efficiency load curve (Bronze/Gold/Platinum/Titanium)
 *  - Session Averages: Real-time calculation of Average Watts and Average Cost/Hour
 */

const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { estimateGpuTdp } = require('./hardwareDetector');

class TelemetryEngine {
    constructor(config) {
        this.config = config;

        // CPU Setup
        this.cpuModel = (os.cpus()[0]?.model || 'Multi-Core Processor').trim();
        this.prevCpus = os.cpus();
        this._lastCpuLoad = 10;

        // Cumulative Session Counters
        this.sessionCost = Number(config.session_cost) || 0.0;
        this.sessionKwh = Number(config.session_kwh) || 0.0;
        this.sessionSeconds = Number(config.session_seconds) || 0;

        // Last Sample Time
        this.lastSampleTime = Date.now();

        // Cached GPU & fallback
        this._cachedSmiCmd = null;
        this._fallbackGpuDetected = false;
        this._fallbackGpuName = null;
        this.cachedGpu = {
            watts: 15.0,
            load: 5,
            temp: 40,
            name: 'Detecting GPU...',
            available: true,
            is_estimated: false
        };
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    resetSession() {
        this.sessionCost = 0.0;
        this.sessionKwh = 0.0;
        this.sessionSeconds = 0;
    }

    _getCpuLoad() {
        const currentCpus = os.cpus();
        let idleDiff = 0;
        let totalDiff = 0;

        for (let i = 0; i < currentCpus.length; i++) {
            const prev = this.prevCpus[i].times;
            const curr = currentCpus[i].times;
            const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
            const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
            idleDiff += (curr.idle - prev.idle);
            totalDiff += (currTotal - prevTotal);
        }

        this.prevCpus = currentCpus;
        if (totalDiff <= 0) return 0;
        return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 1000) / 10));
    }

    _getNvidiaSmiCmd() {
        if (this._cachedSmiCmd) return this._cachedSmiCmd;
        const candidates = [
            'C:\\Windows\\System32\\nvidia-smi.exe',
            'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
            process.env.WINDIR ? path.join(process.env.WINDIR, 'System32', 'nvidia-smi.exe') : null,
            process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe') : null,
            process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe') : null
        ].filter(Boolean);

        for (const c of candidates) {
            try {
                if (fs.existsSync(c)) {
                    this._cachedSmiCmd = `"${c}"`;
                    return this._cachedSmiCmd;
                }
            } catch (_) {}
        }

        // Modern Windows 10/11 DCH DriverStore search
        try {
            const windir = process.env.WINDIR || 'C:\\Windows';
            const driverStore = path.join(windir, 'System32', 'DriverStore', 'FileRepository');
            if (fs.existsSync(driverStore)) {
                const subdirs = fs.readdirSync(driverStore);
                for (const d of subdirs) {
                    if (d.toLowerCase().startsWith('nv')) {
                        const candidate = path.join(driverStore, d, 'nvidia-smi.exe');
                        if (fs.existsSync(candidate)) {
                            this._cachedSmiCmd = `"${candidate}"`;
                            return this._cachedSmiCmd;
                        }
                    }
                }
            }
        } catch (_) {}

        this._cachedSmiCmd = 'nvidia-smi';
        return this._cachedSmiCmd;
    }

    _queryGpu() {
        return new Promise((resolve) => {
            const smiCmd = this._getNvidiaSmiCmd();
            exec(
                `${smiCmd} --query-gpu=power.draw,utilization.gpu,temperature.gpu,name --format=csv,noheader,nounits`,
                { timeout: 900 },
                (err, stdout) => {
                    if (err || !stdout) {
                        return this._queryGpuFallback(resolve);
                    }
                    try {
                        const parts = stdout.trim().split(',').map(s => s.trim());
                        if (parts.length >= 4) {
                            const rawWatts = parseFloat(parts[0]);
                            const load = parseInt(parts[1], 10) || 0;
                            const temp = parseInt(parts[2], 10) || 0;
                            const name = parts[3] || 'NVIDIA Graphics Card';

                            let watts = 0;
                            let isEstimated = false;

                            // If hardware shunt power reporting is supported and valid:
                            if (!isNaN(rawWatts) && rawWatts > 0) {
                                watts = rawWatts;
                            } else {
                                // Fallback: Hardware power sensor is [Not Supported] on this GPU
                                // Calculate realistic power based on GPU Load (%) and Model TDP!
                                isEstimated = true;
                                const tdp = this.config.gpu_tdp_watts || estimateGpuTdp(name);
                                const idle = Math.max(10.0, tdp * 0.12);
                                const loadRatio = Math.max(0, Math.min(100, load)) / 100.0;
                                watts = idle + (tdp - idle) * Math.pow(loadRatio, 1.2);
                            }

                            this.cachedGpu = {
                                watts: Math.round(watts * 10) / 10,
                                load: Math.max(0, Math.min(100, load)),
                                temp: Math.max(0, temp),
                                name: name,
                                available: true,
                                is_estimated: isEstimated
                            };
                            return resolve(this.cachedGpu);
                        }
                    } catch (e) {
                        // ignore and use fallback
                    }
                    this._queryGpuFallback(resolve);
                }
            );
        });
    }

    _queryGpuFallback(resolve) {
        if (this._fallbackGpuDetected) {
            const tdp = this.config.gpu_tdp_watts || estimateGpuTdp(this._fallbackGpuName);
            const load = Math.max(5, Math.min(100, Math.round(this._lastCpuLoad * 0.75)));
            const idle = Math.max(10.0, tdp * 0.12);
            const watts = idle + (tdp - idle) * (load / 100.0);
            return resolve({
                watts: Math.round(watts * 10) / 10,
                load: load,
                temp: 42,
                name: this._fallbackGpuName,
                available: true,
                is_estimated: true
            });
        }

        // Discrete GPU prioritization: sort by AdapterRAM descending
        exec(
            'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1).Name"',
            { timeout: 1500 },
            (err, stdout) => {
                const name = (stdout && !err) ? stdout.trim() : (this.config.gpu_name || 'NVIDIA Graphics Card');
                this._fallbackGpuName = name || 'NVIDIA Graphics Card';
                this._fallbackGpuDetected = true;
                const tdp = this.config.gpu_tdp_watts || estimateGpuTdp(this._fallbackGpuName);
                const idle = Math.max(10.0, tdp * 0.12);
                this.cachedGpu = {
                    watts: Math.round(idle * 10) / 10,
                    load: 5,
                    temp: 40,
                    name: this._fallbackGpuName,
                    available: true,
                    is_estimated: true
                };
                resolve(this.cachedGpu);
            }
        );
    }

    /**
     * Calculates realistic non-linear PSU Efficiency based on 80 PLUS rating and load ratio.
     * Efficiency curve dips at low load (<15%), peaks at 50% load, and slightly drops at 100%.
     */
    _getPsuEfficiency(internalDcWatts, psuRatedWatts, cert) {
        const loadRatio = Math.max(0.05, Math.min(1.0, internalDcWatts / Math.max(300, psuRatedWatts)));
        
        // Base peak efficiency at 50% load
        let peakEff = 0.90; // Gold
        if (cert === 'bronze') peakEff = 0.85;
        else if (cert === 'silver') peakEff = 0.88;
        else if (cert === 'platinum') peakEff = 0.92;
        else if (cert === 'titanium') peakEff = 0.94;

        // Quadratic curve matching 80 PLUS specifications
        // Drop at 10% load is ~5-8%, drop at 100% load is ~2-3%
        let eff;
        if (loadRatio < 0.5) {
            // Low-load curve: falls from peak down to ~80-84% at low idle
            const delta = (0.5 - loadRatio) / 0.5;
            eff = peakEff - (delta * delta * 0.08);
        } else {
            // High-load curve: slight drop of ~2%
            const delta = (loadRatio - 0.5) / 0.5;
            eff = peakEff - (delta * 0.02);
        }

        return Math.max(0.60, Math.min(0.96, eff));
    }

    /**
     * Calculates Monitor Power based on panel preset and Refresh Rate (Hz).
     * High refresh rates (144Hz, 240Hz, 360Hz) require more processing power from the monitor scaler.
     */
    _calculateMonitorWatts() {
        const hz = Number(this.config.monitor_hz) || 144;
        const preset = this.config.monitor_preset || 'gaming_27_32'; // 'std_24', 'gaming_27_32', 'ultrawide_oled'

        let baseWatts = 32.0;
        if (preset === 'std_24') baseWatts = 22.0;
        else if (preset === 'gaming_27_32') baseWatts = 38.0;
        else if (preset === 'ultrawide_oled') baseWatts = 58.0;

        // Scaling factor: each 100Hz above 60Hz adds ~18% power to the monitor scaler & panel
        const hzMultiplier = 1.0 + Math.max(0, (hz - 60)) * 0.0018;
        return baseWatts * hzMultiplier;
    }

    /**
     * Calculates auxiliary motherboard & peripheral power:
     * RAM + NVMe/HDD + Fans + AIO Pump + RGB.
     */
    _calculatePeripheralsWatts() {
        const ramSticks = Number(this.config.ram_sticks) || 2;
        const nvmeCount = Number(this.config.nvme_drives) || 2;
        const hddCount = Number(this.config.hdd_drives) || 0;
        const caseFans = Number(this.config.case_fans) || 4;
        const cooling = this.config.cooling_type || 'aio'; // 'air' or 'aio'
        const hasRgb = this.config.rgb_lighting !== false;

        // RAM: ~4.5W per DDR4/DDR5 module
        const ramWatts = ramSticks * 4.5;
        // Storage: ~4W active NVMe, ~8W spinning HDD
        const storageWatts = (nvmeCount * 4.0) + (hddCount * 8.0);
        // Cooling: Fans (~2.5W each) + AIO pump (~10W) or Air cooler fan (~3W)
        const fanWatts = caseFans * 2.5;
        const pumpWatts = cooling === 'aio' ? 10.0 : 3.0;
        // RGB Lighting controller: ~6W
        const rgbWatts = hasRgb ? 6.0 : 0.0;
        // Motherboard Chipset & VRM baseline: ~15W
        const moboWatts = 15.0;

        return ramWatts + storageWatts + fanWatts + pumpWatts + rgbWatts + moboWatts;
    }

    async getSample() {
        const now = Date.now();
        const dtSeconds = Math.max(0.2, Math.min(3.0, (now - this.lastSampleTime) / 1000.0));
        this.lastSampleTime = now;

        // 1. GPU Telemetry
        const gpu = await this._queryGpu();

        // 2. CPU Telemetry with Dynamic Boost Curve
        const cpuLoad = this._getCpuLoad();
        this._lastCpuLoad = cpuLoad;
        const cpuTdp = Number(this.config.cpu_tdp_watts) || 120.0;
        const idlePower = Math.max(15.0, cpuTdp * 0.15);
        const loadRatio = Math.max(0.0, Math.min(1.0, cpuLoad / 100.0));
        const boostCurve = 0.85 * loadRatio + 0.15 * Math.pow(loadRatio, 1.8);
        const cpuWatts = idlePower + (cpuTdp - idlePower) * boostCurve;

        // 3. Fine-grained Peripherals & Motherboard Draw
        const peripheralsWatts = this._calculatePeripheralsWatts();

        // 4. Power Supply non-linear efficiency curve
        const psuRatedWatts = Number(this.config.psu_rated_watts) || 850;
        const psuCert = this.config.psu_cert || 'gold';
        const internalPcDcWatts = gpu.watts + cpuWatts + peripheralsWatts;
        const psuEff = this._getPsuEfficiency(internalPcDcWatts, psuRatedWatts, psuCert);

        // AC power from the wall socket for the system unit
        const pcWallWatts = internalPcDcWatts / psuEff;

        // 5. Monitor Draw based on Hz & Panel
        const monitorWatts = this._calculateMonitorWatts();

        // 6. Total System Wall Power (AC)
        const totalWatts = pcWallWatts + monitorWatts;
        const totalBaseWatts = (peripheralsWatts / psuEff) + monitorWatts;

        // 7. Financial Calculations & Accumulation
        const tariff = Number(this.config.tariff_per_kwh) || 0.28;
        const costPerHour = (totalWatts / 1000.0) * tariff;

        const deltaKwh = (totalWatts / 1000.0) * (dtSeconds / 3600.0);
        this.sessionKwh += deltaKwh;
        this.sessionCost += deltaKwh * tariff;
        this.sessionSeconds += Math.round(dtSeconds);

        // 8. Session Averages & Custom Rate Window
        const sessionHours = Math.max(1 / 3600, this.sessionSeconds / 3600.0);
        const avgWatts = (this.sessionKwh * 1000.0) / sessionHours;
        const avgCostPerHour = this.sessionCost / sessionHours;

        // Custom Rate Interval (60 min = 1 hr, 30 min, 15 min, etc.)
        const rateMinutes = Math.max(1, Number(this.config.rate_interval_minutes) || 60);
        const rateMultiplier = rateMinutes / 60.0;
        const rateCost = costPerHour * rateMultiplier;
        const rateAvgCost = avgCostPerHour * rateMultiplier;

        return {
            gpu_watts: Math.round(gpu.watts * 10) / 10,
            gpu_load_pct: gpu.load,
            gpu_temp_c: gpu.temp,
            gpu_name: gpu.name,
            gpu_available: gpu.available,
            gpu_is_estimated: gpu.is_estimated || false,

            cpu_watts: Math.round(cpuWatts * 10) / 10,
            cpu_load_pct: cpuLoad,
            cpu_name: this.cpuModel,

            monitor_watts: Math.round(monitorWatts * 10) / 10,
            monitor_hz: Number(this.config.monitor_hz) || 144,
            monitor_preset: this.config.monitor_preset || 'gaming_27_32',

            peripherals_watts: Math.round(peripheralsWatts * 10) / 10,
            ram_watts: Math.round((Number(this.config.ram_sticks || 2) * 4.5) * 10) / 10,
            storage_watts: Math.round(((Number(this.config.nvme_drives || 2) * 4.0) + (Number(this.config.hdd_drives || 0) * 8.0)) * 10) / 10,
            cooling_watts: Math.round(((Number(this.config.case_fans || 4) * 2.5) + (this.config.cooling_type === 'air' ? 3.0 : 10.0)) * 10) / 10,
            rgb_watts: this.config.rgb_lighting !== false ? 6.0 : 0.0,
            mobo_watts: 15.0,

            internal_dc_watts: Math.round(internalPcDcWatts * 10) / 10,
            pc_wall_watts: Math.round(pcWallWatts * 10) / 10,
            psu_efficiency_pct: Math.round(psuEff * 1000) / 10,
            psu_rated_watts: psuRatedWatts,
            psu_cert: psuCert,

            total_base_watts: Math.round(totalBaseWatts * 10) / 10,
            total_watts: Math.round(totalWatts * 10) / 10,

            cost_per_hour: costPerHour,
            rate_cost: rateCost,
            rate_avg_cost: rateAvgCost,
            rate_minutes: rateMinutes,

            // Average Hourly Metrics
            avg_watts: Math.round(avgWatts * 10) / 10,
            avg_cost_per_hour: avgCostPerHour,

            session_cost: this.sessionCost,
            session_kwh: this.sessionKwh,
            session_duration_sec: this.sessionSeconds,

            timestamp: now
        };
    }
}

module.exports = TelemetryEngine;
