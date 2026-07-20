#requires -version 5.1
# ─── AlphaDesk Screenshot ─────────────────────────────────────────────────────
# Hotkey globali (Ctrl+Shift+1 / Ctrl+Shift+2) per catturare lo schermo e
# agganciare l'immagine all'ultimo trade tramite l'endpoint /api/screenshot.

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ScriptDir 'AlphaDeskScreenshot.config.json'

# $global: perche' viene letta anche dagli script block registrati con
# Register-ObjectEvent, che girano in uno scope figlio dello scope globale
# e NON vedono le variabili/funzioni definite nello scope dello script.
$global:AlphaDeskLogPath = Join-Path $ScriptDir 'AlphaDeskScreenshot.log'

function global:Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $global:AlphaDeskLogPath -Value $line -Encoding UTF8
}

function global:Write-Success { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function global:Write-Failure { param([string]$Message) Write-Host $Message -ForegroundColor Red }

# ── Config ────────────────────────────────────────────────────────────────────
if (-not (Test-Path $ConfigPath)) {
    $defaultConfig = [ordered]@{
        apiKey             = ''
        account            = ''
        apiUrl             = 'https://alphadesk-ecru.vercel.app/api/screenshot'
        captureAllMonitors = $false
        jpegQuality        = 85
    }
    $defaultConfig | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
    Write-Host ''
    Write-Host 'Configurazione mancante: creato AlphaDeskScreenshot.config.json' -ForegroundColor Yellow
    Write-Host "Percorso: $ConfigPath" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Compila i seguenti campi prima di riavviare lo script:' -ForegroundColor Yellow
    Write-Host '  - apiKey             : la tua chiave API AlphaDesk (Eseguiti -> Sync -> NinjaTrader)' -ForegroundColor Yellow
    Write-Host '  - account            : opzionale — se vuoto aggancia allultimo trade su qualsiasi conto' -ForegroundColor Yellow
    Write-Host '  - apiUrl             : lascia il valore di default salvo indicazioni diverse' -ForegroundColor Yellow
    Write-Host '  - captureAllMonitors : true per catturare tutti i monitor, false solo quello col mouse' -ForegroundColor Yellow
    Write-Host '  - jpegQuality        : qualita JPEG 1-100 (default 85)' -ForegroundColor Yellow
    Write-Host ''
    Read-Host 'Premi INVIO per chiudere'
    exit
}

try {
    $config = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Failure "Errore nella lettura del file di configurazione: $($_.Exception.Message)"
    Read-Host 'Premi INVIO per chiudere'
    exit
}

$apiKey  = [string]$config.apiKey
$account = [string]$config.account
$apiUrl  = [string]$config.apiUrl
if ([string]::IsNullOrWhiteSpace($apiUrl)) { $apiUrl = 'https://alphadesk-ecru.vercel.app/api/screenshot' }

$captureAllMonitors = $false
if ($config.captureAllMonitors -eq $true) { $captureAllMonitors = $true }

$jpegQuality = 85
if ($config.jpegQuality) {
    $parsedQuality = 0
    if ([int]::TryParse([string]$config.jpegQuality, [ref]$parsedQuality) -and $parsedQuality -ge 1 -and $parsedQuality -le 100) {
        $jpegQuality = $parsedQuality
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Failure 'Configurazione incompleta: compila apiKey in AlphaDeskScreenshot.config.json'
    Write-Host "Percorso: $ConfigPath" -ForegroundColor Yellow
    Read-Host 'Premi INVIO per chiudere'
    exit
}

# Esposte in global scope: servono agli script block registrati con Register-ObjectEvent
# e alle funzioni richiamate dall'handler dell'hotkey, che girano fuori dallo scope dello script.
$global:AlphaDeskApiKey             = $apiKey
$global:AlphaDeskAccount            = $account
$global:AlphaDeskApiUrl             = $apiUrl
$global:AlphaDeskCaptureAllMonitors = $captureAllMonitors
$global:AlphaDeskJpegQuality        = $jpegQuality

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Classe C# per gli hotkey globali (RegisterHotKey + message loop) ──────────
$hotkeySource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public class HotkeyEventArgs : EventArgs {
    public int Id;
    public HotkeyEventArgs(int id) { Id = id; }
}

public class AlphaDeskHotkeyListener {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    private const uint MOD_CONTROL  = 0x0002;
    private const uint MOD_SHIFT    = 0x0004;
    private const uint MOD_NOREPEAT = 0x4000;
    private const uint WM_HOTKEY    = 0x0312;

    public event EventHandler<HotkeyEventArgs> HotkeyPressed;

    private class Entry { public int Id; public uint PrimaryVk; public uint FallbackVk; }
    private List<Entry> _entries = new List<Entry>();
    private ManualResetEvent _ready = new ManualResetEvent(false);
    private Thread _thread;

    // 0 = nessuna combinazione registrata, 1 = combinazione primaria, 2 = fallback
    public Dictionary<int, int> Results = new Dictionary<int, int>();

    public void AddHotkey(int id, uint primaryVk, uint fallbackVk) {
        _entries.Add(new Entry { Id = id, PrimaryVk = primaryVk, FallbackVk = fallbackVk });
    }

    public void Start() {
        _thread = new Thread(Run);
        _thread.IsBackground = true;
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.WaitOne();
    }

    private void Run() {
        foreach (var e in _entries) {
            if (RegisterHotKey(IntPtr.Zero, e.Id, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, e.PrimaryVk)) {
                Results[e.Id] = 1;
            } else if (RegisterHotKey(IntPtr.Zero, e.Id, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, e.FallbackVk)) {
                Results[e.Id] = 2;
            } else {
                Results[e.Id] = 0;
            }
        }
        _ready.Set();

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0) {
            if (msg.message == WM_HOTKEY) {
                var handler = HotkeyPressed;
                if (handler != null) handler(this, new HotkeyEventArgs(msg.wParam.ToInt32()));
            }
        }
    }
}
'@
Add-Type -TypeDefinition $hotkeySource -Language CSharp

# ── Cattura schermo ────────────────────────────────────────────────────────────
function global:Invoke-AlphaDeskCapture {
    param([int]$Slot)

    try {
        if ($global:AlphaDeskCaptureAllMonitors) {
            $screens = [System.Windows.Forms.Screen]::AllScreens
            $minX = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
            $minY = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
            $maxX = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
            $maxY = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
            $bounds = New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX), ($maxY - $minY))
        } else {
            $bounds = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).Bounds
        }

        $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
        $graphics.Dispose()

        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$global:AlphaDeskJpegQuality)

        $ms = New-Object System.IO.MemoryStream
        $bitmap.Save($ms, $jpegCodec, $encParams)
        $base64 = [Convert]::ToBase64String($ms.ToArray())

        $graphics = $null
        $bitmap.Dispose()
        $ms.Dispose()

        Send-AlphaDeskScreenshot -Slot $Slot -Base64 $base64
    } catch {
        Write-Failure "Errore durante la cattura (slot $Slot): $($_.Exception.Message)"
        Write-Log "ERRORE cattura slot $Slot - $($_.Exception.Message)"
    }
}

# ── Invio al server ────────────────────────────────────────────────────────────
function global:Send-AlphaDeskScreenshot {
    param([int]$Slot, [string]$Base64)

    # Ogni valore stringa nel payload va forzato con interpolazione "$var": stringhe che
    # arrivano da cmdlet (es. Get-Content) in PS 5.1 portano proprieta' ETS extra e
    # ConvertTo-Json le serializza come oggetto invece che come stringa pura.
    $payloadObj = [ordered]@{
        apiKey      = "$($global:AlphaDeskApiKey)"
        slot        = $Slot
        imageBase64 = "$Base64"
    }
    if (-not [string]::IsNullOrWhiteSpace($global:AlphaDeskAccount)) {
        $payloadObj['account'] = "$($global:AlphaDeskAccount)"
    }
    $payload = $payloadObj | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $global:AlphaDeskApiUrl -Method Post -Body $payload -ContentType 'application/json; charset=utf-8' -TimeoutSec 30

        $entryDate = "$($response.trade.entry_time)"
        try { $entryDate = ([datetime]$response.trade.entry_time).ToString('dd/MM') } catch {}

        $msg = "✓ Screenshot slot $Slot → $($response.trade.instrument) · $($response.trade.account) · $entryDate"
        Write-Success $msg
        Write-Log "OK slot=$Slot instrument=$($response.trade.instrument) account=$($response.trade.account) entry=$($response.trade.entry_time)"
    } catch {
        $errMsg = $_.Exception.Message
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd() | ConvertFrom-Json
            if ($errBody.error) { $errMsg = $errBody.error }
        } catch {}
        Write-Failure "Errore slot $Slot`: $errMsg"
        Write-Log "ERRORE slot $Slot - $errMsg"
    }
}

# ── Registrazione hotkey ───────────────────────────────────────────────────────
$listener = New-Object AlphaDeskHotkeyListener
$listener.AddHotkey(1, 0x31, 0x70) # slot 1: Ctrl+Shift+1, fallback Ctrl+Shift+F1
$listener.AddHotkey(2, 0x32, 0x71) # slot 2: Ctrl+Shift+2, fallback Ctrl+Shift+F2
$listener.Start()

$hotkeyLabels = @{}
foreach ($slotId in 1, 2) {
    $result = $listener.Results[$slotId]
    $primaryLabel = "Ctrl+Shift+$slotId"
    $fallbackLabel = if ($slotId -eq 1) { 'Ctrl+Shift+F1' } else { 'Ctrl+Shift+F2' }
    if ($result -eq 1) {
        $hotkeyLabels[$slotId] = $primaryLabel
    } elseif ($result -eq 2) {
        Write-Failure "$primaryLabel gia' occupata da un'altra applicazione — uso $fallbackLabel per lo slot $slotId."
        $hotkeyLabels[$slotId] = $fallbackLabel
    } else {
        Write-Failure "Impossibile registrare un hotkey per lo slot $slotId (ne' $primaryLabel ne' $fallbackLabel disponibili)."
        $hotkeyLabels[$slotId] = 'NON DISPONIBILE'
    }
}

$action = {
    $slotId = $Event.SourceEventArgs.Id
    Invoke-AlphaDeskCapture -Slot $slotId
}
$handler = Register-ObjectEvent -InputObject $listener -EventName HotkeyPressed -Action $action

# ── Riepilogo avvio ────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== AlphaDesk Screenshot ===' -ForegroundColor Cyan
Write-Host "Conto                : $(if ([string]::IsNullOrWhiteSpace($account)) { 'qualsiasi (ultimo trade)' } else { $account })"
Write-Host "Endpoint             : $apiUrl"
Write-Host "Tutti i monitor      : $captureAllMonitors"
Write-Host "Qualita' JPEG        : $jpegQuality"
Write-Host "Hotkey slot 1        : $($hotkeyLabels[1])"
Write-Host "Hotkey slot 2        : $($hotkeyLabels[2])"
Write-Host 'In ascolto... (CTRL+C per interrompere)'
Write-Host ''
Write-Log "AVVIO screenshot utility - account=$account endpoint=$apiUrl hotkey1=$($hotkeyLabels[1]) hotkey2=$($hotkeyLabels[2])"

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    $handler | Unregister-Event -ErrorAction SilentlyContinue
}
