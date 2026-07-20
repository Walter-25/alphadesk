#requires -version 5.1
# ─── AlphaDesk Watcher ────────────────────────────────────────────────────────
# Monitora una cartella per export CSV DeepCharts e li importa automaticamente
# in AlphaDesk tramite l'endpoint /api/ingest-csv.

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ScriptDir 'AlphaDeskWatcher.config.json'

# $global: perche' viene letta anche dagli script block registrati con
# Register-ObjectEvent, che girano in uno scope figlio dello scope globale
# e NON vedono le variabili/funzioni definite nello scope dello script.
$global:AlphaDeskLogPath = Join-Path $ScriptDir 'AlphaDeskWatcher.log'

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
        apiKey      = ''
        account     = ''
        watchFolder = ''
        apiUrl      = 'https://alphadesk-ecru.vercel.app/api/ingest-csv'
    }
    $defaultConfig | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
    Write-Host ''
    Write-Host 'Configurazione mancante: creato AlphaDeskWatcher.config.json' -ForegroundColor Yellow
    Write-Host "Percorso: $ConfigPath" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Compila i seguenti campi prima di riavviare lo script:' -ForegroundColor Yellow
    Write-Host '  - apiKey      : la tua chiave API AlphaDesk (Eseguiti -> Sync -> NinjaTrader)' -ForegroundColor Yellow
    Write-Host '  - account     : nome del conto su cui importare i trade' -ForegroundColor Yellow
    Write-Host '  - watchFolder : cartella da monitorare (vuoto = cartella Download)' -ForegroundColor Yellow
    Write-Host '  - apiUrl      : lascia il valore di default salvo indicazioni diverse' -ForegroundColor Yellow
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
if ([string]::IsNullOrWhiteSpace($apiUrl)) { $apiUrl = 'https://alphadesk-ecru.vercel.app/api/ingest-csv' }

$watchFolder = [string]$config.watchFolder
if ([string]::IsNullOrWhiteSpace($watchFolder)) {
    $watchFolder = Join-Path $env:USERPROFILE 'Downloads'
}

if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($account)) {
    Write-Failure 'Configurazione incompleta: compila apiKey e account in AlphaDeskWatcher.config.json'
    Write-Host "Percorso: $ConfigPath" -ForegroundColor Yellow
    Read-Host 'Premi INVIO per chiudere'
    exit
}

if (-not (Test-Path $watchFolder)) {
    Write-Failure "La cartella da monitorare non esiste: $watchFolder"
    Read-Host 'Premi INVIO per chiudere'
    exit
}

$importedFolder = Join-Path $watchFolder 'AlphaDesk_importati'
if (-not (Test-Path $importedFolder)) {
    New-Item -ItemType Directory -Path $importedFolder -Force | Out-Null
}

# Esposte in global scope: servono allo script block registrato con Register-ObjectEvent,
# che gira in uno scope separato e non ha accesso alle variabili locali di questo script.
$global:AlphaDeskApiKey         = $apiKey
$global:AlphaDeskAccount        = $account
$global:AlphaDeskApiUrl         = $apiUrl
$global:AlphaDeskImportedFolder = $importedFolder

# ── Import di un singolo file ───────────────────────────────────────────────
function global:Import-AlphaDeskCsvFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) { return }

    Start-Sleep -Seconds 2 # attende che il file finisca di essere scritto

    $content = $null
    $attempts = 0
    while ($attempts -lt 3 -and $null -eq $content) {
        $attempts++
        try {
            $content = Get-Content -Path $FilePath -Raw -Encoding UTF8 -ErrorAction Stop
        } catch {
            if ($attempts -ge 3) {
                Write-Failure "Impossibile leggere il file (lockato): $FilePath"
                Write-Log "ERRORE lettura file dopo $attempts tentativi: $FilePath - $($_.Exception.Message)"
                return
            }
            Start-Sleep -Seconds 2
        }
    }

    if ([string]::IsNullOrWhiteSpace($content)) {
        Write-Host "File vuoto, ignorato: $FilePath" -ForegroundColor DarkGray
        Write-Log "IGNORATO (vuoto): $FilePath"
        return
    }

    $firstLine = ($content -split "`r`n|`n" | Select-Object -First 1)
    if ($firstLine -notmatch '(?i)Symbol;DT;') {
        Write-Host "File non riconosciuto come export DeepCharts, ignorato: $FilePath" -ForegroundColor DarkGray
        Write-Log "IGNORATO (formato non riconosciuto): $FilePath"
        return
    }

    $payload = @{
        apiKey  = $global:AlphaDeskApiKey
        account = $global:AlphaDeskAccount
        csv     = $content
        source  = 'DeepCharts-Watcher'
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $global:AlphaDeskApiUrl -Method Post -Body $payload -ContentType 'application/json; charset=utf-8' -TimeoutSec 30

        $fileName = Split-Path -Leaf $FilePath
        $destPath = Join-Path $global:AlphaDeskImportedFolder $fileName
        if (Test-Path $destPath) {
            $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
            $ext  = [System.IO.Path]::GetExtension($fileName)
            $base = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
            $destPath = Join-Path $global:AlphaDeskImportedFolder "$base`_$timestamp$ext"
        }
        Move-Item -Path $FilePath -Destination $destPath -Force

        Write-Success "importati $($response.imported) trade, saltati $($response.skipped)"
        Write-Log "OK $fileName - importati=$($response.imported) saltati=$($response.skipped) parsed=$($response.parsed)"
    } catch {
        $errMsg = $_.Exception.Message
        Write-Failure "Errore durante l'invio di $FilePath : $errMsg"
        Write-Log "ERRORE invio $FilePath - $errMsg"
    }
}

# ── Riepilogo avvio ────────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== AlphaDesk Watcher ===' -ForegroundColor Cyan
Write-Host "Cartella monitorata : $watchFolder"
Write-Host "Conto                : $account"
Write-Host "Endpoint             : $apiUrl"
Write-Host 'In ascolto... (CTRL+C per interrompere)'
Write-Host ''
Write-Log "AVVIO watcher - cartella=$watchFolder account=$account endpoint=$apiUrl"

# ── FileSystemWatcher ──────────────────────────────────────────────────────
$fsw = New-Object System.IO.FileSystemWatcher
$fsw.Path = $watchFolder
$fsw.Filter = '*.csv'
$fsw.IncludeSubdirectories = $false
$fsw.EnableRaisingEvents = $true

$action = {
    $path = $Event.SourceEventArgs.FullPath
    Import-AlphaDeskCsvFile -FilePath $path
}

$handlers = @()
$handlers += Register-ObjectEvent -InputObject $fsw -EventName Created -Action $action
$handlers += Register-ObjectEvent -InputObject $fsw -EventName Renamed -Action $action

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    $handlers | Unregister-Event -ErrorAction SilentlyContinue
    $fsw.Dispose()
}
