/**
 * Comprehensive Hardware Auto-Detector for Power Cost Monitor.
 * Queries Windows WMI/CIM subsystem to discover:
 *  - CPU (Name, Cores, Threads, and accurate TDP profile)
 *  - GPU (Name, discrete card prioritization, VRAM, and TDP profile)
 *  - RAM (Stick count, total GB, DDR generation, speed)
 *  - Storage (NVMe/SSD drives count and mechanical HDD count)
 *  - Display (Refresh rate in Hz, resolution, and monitor size preset)
 *  - Motherboard (Manufacturer and Model)
 *  - Power Supply (Calculated optimal recommended wattage)
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function estimateCpuTdp(cpuName, cores = 8) {
    if (!cpuName) return 105;
    const n = cpuName.toUpperCase();

    // Intel Flagship / K-series
    if (n.includes('14900') || n.includes('13900') || n.includes('12900')) return 253;
    if (n.includes('14700') || n.includes('13700')) return 253;
    if (n.includes('12700')) return 190;
    if (n.includes('14600') || n.includes('13600')) return 181;
    if (n.includes('12600')) return 150;
    if (n.includes('14400') || n.includes('13400') || n.includes('12400')) return 65;
    if (n.includes('14100') || n.includes('13100') || n.includes('12100')) return 60;
    if (n.includes('CORE ULTRA 9')) return 250;
    if (n.includes('CORE ULTRA 7')) return 180;
    if (n.includes('CORE ULTRA 5')) return 125;

    // AMD Ryzen 9000 & 7000
    if (n.includes('9950') || n.includes('9900') || n.includes('7950') || n.includes('7900')) return 170;
    if (n.includes('9800X3D') || n.includes('7800X3D')) return 120;
    if (n.includes('9700X') || n.includes('7700X')) return 105;
    if (n.includes('9600X') || n.includes('7600X')) return 105;
    if (n.includes('7700') || n.includes('7600')) return 65;

    // AMD Ryzen 5000 & 3000
    if (n.includes('5950') || n.includes('5900') || n.includes('3950') || n.includes('3900')) return 105;
    if (n.includes('5800X3D') || n.includes('5800X') || n.includes('3800X') || n.includes('3700X')) return 105;
    if (n.includes('5700') || n.includes('5600') || n.includes('3600')) return 65;

    // Laptop CPUs
    if (n.includes('HX')) return 55;
    if (n.includes('HS') || n.includes(' H ') || n.endsWith('H')) return 45;
    if (n.includes(' U ') || n.endsWith('U')) return 28;

    // Core count fallback
    if (cores >= 16) return 170;
    if (cores >= 12) return 140;
    if (cores >= 8) return 105;
    if (cores >= 6) return 65;
    return 65;
}

function estimateGpuTdp(gpuName) {
    if (!gpuName) return 150.0;
    const n = gpuName.toUpperCase();

    // NVIDIA GeForce RTX 40 series
    if (n.includes('4090')) return 450.0;
    if (n.includes('4080 SUPER') || n.includes('4080')) return 320.0;
    if (n.includes('4070 TI SUPER') || n.includes('4070 TI')) return 285.0;
    if (n.includes('4070 SUPER')) return 220.0;
    if (n.includes('4070')) return 200.0;
    if (n.includes('4060 TI')) return 160.0;
    if (n.includes('4060')) return 115.0;

    // NVIDIA GeForce RTX 30 series
    if (n.includes('3090 TI')) return 450.0;
    if (n.includes('3090')) return 350.0;
    if (n.includes('3080 TI')) return 350.0;
    if (n.includes('3080')) return 320.0;
    if (n.includes('3070 TI')) return 290.0;
    if (n.includes('3070')) return 220.0;
    if (n.includes('3060 TI')) return 200.0;
    if (n.includes('3060')) return 170.0;
    if (n.includes('3050')) return 130.0;

    // NVIDIA RTX 20 & GTX 16/10
    if (n.includes('2080 TI')) return 250.0;
    if (n.includes('2080')) return 215.0;
    if (n.includes('2070')) return 175.0;
    if (n.includes('2060')) return 160.0;
    if (n.includes('1660 TI') || n.includes('1660 SUPER')) return 125.0;
    if (n.includes('1660')) return 120.0;
    if (n.includes('1650 SUPER')) return 100.0;
    if (n.includes('1650')) return 75.0;
    if (n.includes('1080 TI')) return 250.0;
    if (n.includes('1080')) return 180.0;
    if (n.includes('1070 TI') || n.includes('1070')) return 150.0;
    if (n.includes('1060')) return 120.0;
    if (n.includes('1050 TI') || n.includes('1050')) return 75.0;
    if (n.includes('1030')) return 30.0;
    if (n.includes('750 TI') || n.includes('750')) return 60.0;

    // AMD Radeon RX series
    if (n.includes('7900 XTX')) return 355.0;
    if (n.includes('7900 XT')) return 315.0;
    if (n.includes('7900 GRE')) return 260.0;
    if (n.includes('7800 XT')) return 263.0;
    if (n.includes('7700 XT')) return 245.0;
    if (n.includes('7600 XT') || n.includes('7600')) return 165.0;
    if (n.includes('6950 XT') || n.includes('6900 XT')) return 335.0;
    if (n.includes('6800 XT')) return 300.0;
    if (n.includes('6800')) return 250.0;
    if (n.includes('6700 XT') || n.includes('6750 XT')) return 230.0;
    if (n.includes('6600 XT') || n.includes('6650 XT')) return 160.0;
    if (n.includes('6600')) return 132.0;

    // Intel Arc
    if (n.includes('A770') || n.includes('A750')) return 225.0;
    if (n.includes('B580') || n.includes('B570')) return 190.0;
    if (n.includes('A580')) return 185.0;
    if (n.includes('A380')) return 75.0;

    if (n.includes('LAPTOP') || n.includes('MOBILE') || n.includes('MAX-Q')) return 85.0;
    return 150.0;
}

function detectHardware() {
    return new Promise((resolve) => {
        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors
$gpus = Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending
$gpu = $gpus | Select-Object -First 1 Name, AdapterRAM, CurrentRefreshRate, VideoModeDescription
$maxHz = ($gpus | Measure-Object -Property CurrentRefreshRate -Maximum).Maximum
$ram = Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity, Speed, SMBIOSMemoryType
$mobo = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer, Product
$disks = Get-CimInstance Win32_DiskDrive | Select-Object Model, MediaType, Size, InterfaceType

[PSCustomObject]@{
    CPU = $cpu
    GPU = $gpu
    MaxHz = $maxHz
    RAM = @($ram)
    Mobo = $mobo
    Disks = @($disks)
} | ConvertTo-Json -Depth 3
`;

        const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
        exec(
            `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`,
            { timeout: 10000 },
            (err, stdout) => {
                if (err || !stdout || !stdout.trim()) {
                    console.warn('Hardware detection fallback used:', err ? err.message : 'empty output');
                    return resolve(getFallbackSpecs());
                }

                try {
                    const data = JSON.parse(stdout.trim());
                    const specs = parseSpecs(data);
                    return resolve(specs);
                } catch (pe) {
                    console.warn('Failed to parse hardware detection json, using fallback:', pe.message);
                    return resolve(getFallbackSpecs());
                }
            }
        );
    });
}

function parseSpecs(data) {
    // 1. CPU
    const cpuName = (data.CPU?.Name || 'Multi-Core Processor').replace(/\s+/g, ' ').trim();
    const cpuCores = parseInt(data.CPU?.NumberOfCores, 10) || 8;
    const cpuThreads = parseInt(data.CPU?.NumberOfLogicalProcessors, 10) || cpuCores * 2;
    const cpuTdp = estimateCpuTdp(cpuName, cpuCores);

    // 2. GPU
    const gpuName = (data.GPU?.Name || 'NVIDIA Graphics Card').replace(/\s+/g, ' ').trim();
    const rawVram = parseInt(data.GPU?.AdapterRAM, 10) || 0;
    const vramGb = rawVram > 0 ? Math.round(rawVram / (1024 * 1024 * 1024)) : 8;
    const gpuTdp = estimateGpuTdp(gpuName);

    // 3. Monitor
    let hz = parseInt(data.MaxHz || data.GPU?.CurrentRefreshRate, 10) || 60;
    if (hz <= 0 || isNaN(hz)) hz = 144;
    const modeDesc = (data.GPU?.VideoModeDescription || '').toLowerCase();

    let preset = 'gaming_27_32';
    if (modeDesc.includes('3840') || modeDesc.includes('3440') || modeDesc.includes('4k')) {
        preset = 'ultrawide_oled';
    } else if (modeDesc.includes('2560') || modeDesc.includes('1440')) {
        preset = 'gaming_27_32';
    } else if (modeDesc.includes('1920') || modeDesc.includes('1080')) {
        preset = (hz >= 144) ? 'gaming_27_32' : 'std_24';
    }

    // 4. RAM
    const ramArr = Array.isArray(data.RAM) ? data.RAM : (data.RAM ? [data.RAM] : []);
    const sticks = Math.max(1, ramArr.length || 2);
    let totalBytes = 0;
    let maxSpeed = 3200;
    let memType = 'DDR4';

    ramArr.forEach(r => {
        totalBytes += (parseInt(r.Capacity, 10) || 0);
        if (r.Speed) maxSpeed = Math.max(maxSpeed, parseInt(r.Speed, 10));
        if (r.SMBIOSMemoryType === 34 || (r.Speed && r.Speed >= 4800)) {
            memType = 'DDR5';
        }
    });
    const totalRamGb = totalBytes > 0 ? Math.round(totalBytes / (1024 * 1024 * 1024)) : (sticks * 8);

    // 5. Storage (NVMe / SSD vs HDD)
    let nvmeDrives = 0;
    let hddDrives = 0;

    const pDisks = Array.isArray(data.PDisks) ? data.PDisks : (data.PDisks ? [data.PDisks] : []);
    if (pDisks.length > 0) {
        pDisks.forEach(d => {
            const bus = (d.BusType || '').toString().toLowerCase();
            const med = (d.MediaType || '').toString().toLowerCase();
            if (bus.includes('nvme') || med.includes('ssd')) {
                nvmeDrives++;
            } else if (med.includes('hdd')) {
                hddDrives++;
            } else {
                nvmeDrives++;
            }
        });
    } else {
        const disks = Array.isArray(data.Disks) ? data.Disks : (data.Disks ? [data.Disks] : []);
        disks.forEach(d => {
            const m = (d.Model || '').toLowerCase();
            if (m.includes('nvme') || m.includes('ssd') || m.includes('snv') || m.includes('sabrent') || m.includes('samsung') || m.includes('kingston')) {
                nvmeDrives++;
            } else {
                hddDrives++;
            }
        });
    }

    if (nvmeDrives === 0 && hddDrives === 0) {
        nvmeDrives = 2;
        hddDrives = 0;
    }

    // 6. Motherboard
    const moboMfg = (data.Mobo?.Manufacturer || 'System').replace(/\s+/g, ' ').trim();
    const moboModel = (data.Mobo?.Product || 'Motherboard').replace(/\s+/g, ' ').trim();

    // 7. Recommended PSU calculation
    // Base load: CPU TDP + GPU TDP + RAM (5W per stick) + Storage (5W per drive) + Mobo/Fans (50W)
    const baseDcWatts = cpuTdp + gpuTdp + (sticks * 5) + (nvmeDrives * 5) + (hddDrives * 10) + 50;
    // 50% extra headroom for transient spikes & optimal 80 PLUS efficiency curve
    const recommendedPsu = Math.min(1300, Math.max(500, Math.ceil((baseDcWatts * 1.45) / 50) * 50));

    return {
        cpu: {
            name: cpuName,
            cores: cpuCores,
            threads: cpuThreads,
            tdp_watts: cpuTdp
        },
        gpu: {
            name: gpuName,
            vram_gb: vramGb,
            tdp_watts: gpuTdp
        },
        monitor: {
            hz: hz,
            preset: preset,
            mode_description: data.GPU?.VideoModeDescription || `${hz}Hz Display`
        },
        ram: {
            sticks: sticks,
            total_gb: totalRamGb,
            speed_mhz: maxSpeed,
            type: memType
        },
        storage: {
            nvme_drives: nvmeDrives,
            hdd_drives: hddDrives
        },
        motherboard: {
            manufacturer: moboMfg,
            model: moboModel
        },
        psu_suggested_watts: recommendedPsu
    };
}

function getFallbackSpecs() {
    return {
        cpu: { name: 'AMD / Intel Multi-Core CPU', cores: 8, threads: 16, tdp_watts: 120 },
        gpu: { name: 'NVIDIA GeForce RTX Graphics', vram_gb: 8, tdp_watts: 200 },
        monitor: { hz: 144, preset: 'gaming_27_32', mode_description: '144Hz Gaming Monitor' },
        ram: { sticks: 2, total_gb: 16, speed_mhz: 3200, type: 'DDR4' },
        storage: { nvme_drives: 2, hdd_drives: 0 },
        motherboard: { manufacturer: 'PC', model: 'Motherboard' },
        psu_suggested_watts: 750
    };
}

module.exports = {
    detectHardware,
    estimateCpuTdp,
    estimateGpuTdp,
    getFallbackSpecs
};
