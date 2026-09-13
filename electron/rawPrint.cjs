// Raw ESC/POS printing to an installed printer (no native modules).
//
// Windows: writing to `\\localhost\PrinterName` (the local print share) fails
// with EPERM/access errors unless the printer is explicitly SHARED and SMB
// file & printer sharing is enabled. Instead we talk to the spooler directly
// through winspool.drv (OpenPrinter → StartDoc → StartPage → WritePrinter)
// via PowerShell's Add-Type — this works for ANY installed printer (USB or
// otherwise) with zero sharing/firewall setup.
//
// macOS/Linux: pipes the bytes through `lp -d <name> -o raw`.
//
// `rawPrint(printerName, buffer)` resolves `null` on success or an error
// message. Pure Node — no Electron APIs, testable with a plain `node` script.
//
// `rawPrintWithCut(printerName, buffer)` prints a payload that already
// contains the ESC/POS CUT command (`GS V 0`) right after the receipt raster
// and a generous paper feed. Because the cut is in the same byte stream, the
// printer executes it in order — after the receipt has fully printed and the
// paper has cleared the cutter — so the bill is cut automatically with no
// extra delay and the bottom of the bill is never clipped.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// PowerShell helper: the classic Microsoft "send raw data to a printer"
// sample (KB 322091), compiled on the fly. Takes the printer name and a
// temp file path containing the raw bytes.
const RAW_PRINT_PS1 = `param([string]$PrinterName, [string]$FilePath)
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static string SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        Int32 dwWritten = 0;
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Flex POS receipt";
        di.pDataType = "RAW";
        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            return "OpenPrinter failed (error " + Marshal.GetLastWin32Error() + "). Check the printer name, that it is installed, and that it is powered on and connected.";
        }
        try {
            if (!StartDocPrinter(hPrinter, 1, di)) {
                return "StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ").";
            }
            try {
                if (!StartPagePrinter(hPrinter)) {
                    return "StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ").";
                }
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten)) {
                        return "WritePrinter failed (error " + Marshal.GetLastWin32Error() + ").";
                    }
                    if (dwWritten != bytes.Length) {
                        return "WritePrinter wrote only " + dwWritten + " of " + bytes.Length + " bytes.";
                    }
                } finally {
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return null;
    }
}
'@
try {
    Add-Type -TypeDefinition $code
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $err = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
    if ($err) {
        Write-Output ("ERR: " + $err)
        exit 1
    }
    Write-Output "OK"
    exit 0
} catch {
    Write-Output ("ERR: " + $_.Exception.Message)
    exit 1
}
`;

/** Windows: raw print through the spooler via PowerShell/winspool.drv. */
async function rawPrintWindows(printerName, buffer) {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const tmpPath = path.join(os.tmpdir(), `flexpos-print-${id}.bin`);
  const psPath = path.join(os.tmpdir(), `flexpos-print-${id}.ps1`);
  try {
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.writeFile(psPath, RAW_PRINT_PS1);
  } catch (e) {
    return `Could not prepare the print data (${e.code || e.message})`;
  }
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psPath, printerName, tmpPath],
        { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, so, se) => {
          if (err) {
            const combined = `${so}\n${se}`.trim();
            reject(new Error(combined || err.message));
          } else {
            resolve({ stdout: so });
          }
        }
      );
    });
    const errLine = (stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('ERR:'));
    return errLine ? errLine.slice(4).trim() : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errLine = (msg || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('ERR:'));
    return errLine ? errLine.slice(4).trim() : `Could not print to "${printerName}" (${msg || e})`;
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {});
    fs.promises.unlink(psPath).catch(() => {});
  }
}

/** macOS/Linux: pipe the raw bytes through `lp -o raw`. */
function rawPrintLp(printerName, buffer) {
  return new Promise((resolve) => {
    const child = execFile('lp', ['-d', printerName, '-o', 'raw'], { timeout: 20000 }, (err, _stdout, stderr) => {
      resolve(err ? String(stderr || err.message || err) : null);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(buffer);
  });
}

/**
 * Send raw bytes to an installed printer. Resolves `null` on success or an
 * error message. Never throws.
 */
function rawPrint(printerName, buffer) {
  if (process.platform === 'win32') return rawPrintWindows(printerName, buffer);
  return rawPrintLp(printerName, buffer);
}

/**
 * Print a raw ESC/POS payload that already includes the trailing cut command.
 * The whole payload (receipt raster + paper feed + CUT) goes to the printer
 * as one job, so the printer's own command stream executes the cut in order
 * — right after the receipt prints. No polling, no extra delay.
 *
 * Resolves `null` on success or an error message. Never throws.
 */
async function rawPrintWithCut(printerName, buffer) {
  return rawPrint(printerName, buffer);
}

// Windows: read the printer's DEFAULT page size from the driver (hundredths
// of an inch) — for roll/thermal printers this is the paper width (e.g. an
// 80mm printer reports ~315 hundredths = 80mm). Returns the width in mm for
// roll-sized papers (30–120mm) or null otherwise (A4/Letter etc.).
const DETECT_WIDTH_PS1 = `param([string]$PrinterName)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Drawing
    $ps = New-Object System.Drawing.Printing.PrinterSettings
    $ps.PrinterName = $PrinterName
    if (-not $ps.IsValid) { Write-Output 'INVALID'; exit 1 }
    $w = $ps.DefaultPageSettings.PaperSize.Width
    Write-Output ("WIDTH:" + $w)
    exit 0
} catch {
    Write-Output ("ERR: " + $_.Exception.Message)
    exit 1
}
`;

/** Detect the paper width (mm) of an installed printer, or null. */
async function detectPrinterWidth(printerName) {
  if (process.platform !== 'win32') return null;
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const psPath = path.join(os.tmpdir(), `flexpos-width-${id}.ps1`);
  try {
    await fs.promises.writeFile(psPath, DETECT_WIDTH_PS1);
  } catch {
    return null;
  }
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psPath, printerName],
        { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, so, se) => (err ? reject(new Error(`${so}\n${se}`)) : resolve({ stdout: so }))
      );
    });
    const line = (stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('WIDTH:'));
    if (!line) return null;
    const hundredths = Number(line.slice(6).trim());
    if (!Number.isFinite(hundredths) || hundredths <= 0) return null;
    const mm = Math.round(hundredths * 0.254);
    // Only roll/thermal sizes (30–120mm) — A4/Letter etc. mean a normal printer.
    return mm >= 30 && mm <= 120 ? mm : null;
  } catch {
    return null;
  } finally {
    fs.promises.unlink(psPath).catch(() => {});
  }
}

module.exports = { rawPrint, rawPrintWithCut, detectPrinterWidth };
