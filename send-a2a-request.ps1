param(
  [string]$RemoteHost = '192.168.225.101',
  [int]$Port = 5000,
  [string]$Pan = '0000950000000000',
  [string]$ProcessingCode = '280000',
  [string]$Amount = '000015600000',
  [string]$SettlementAmount,
  [string]$BillingAmount,
  [string]$CounterpartAccount = '2001070006085',
  [string]$AdditionalInfo = '    TWHAT_TRX  TIBFTA2A',
  [string]$MerchantType = '6013',
  [string]$EntryMode = '012',
  [string]$AcquirerId = '000015',
  [string]$TerminalId = '90200151',
  [string]$CardAcceptorId = 'AL-ARAFAH BANK ',
  [string]$CardAcceptorName = 'aibl i-banking           DHAKA        BD',
  [string]$CurrencyCode = '050',
  [string]$Stan,
  [string]$Rrn
)

function New-Stan {
  "{0:D6}" -f (Get-Random -Minimum 0 -Maximum 1000000)
}

function New-Rrn {
  param(
    [string]$StanValue
  )
  $now = [DateTime]::UtcNow
  $mm = "{0:D2}" -f $now.Month
  $dd = "{0:D2}" -f $now.Day
  $hh = "{0:D2}" -f $now.Hour
  $mi = "{0:D2}" -f $now.Minute
  $ss = "{0:D2}" -f $now.Second
  $raw = $mm + $dd + $hh + $mi + $ss + $StanValue
  if ($raw.Length -lt 12) {
    $raw = $raw.PadRight(12, '0')
  }
  $raw.Substring(0,12)
}

if (-not $Stan) {
  $Stan = New-Stan
}

if (-not $Rrn) {
  $Rrn = New-Rrn -StanValue $Stan
}

$settlement = if ($SettlementAmount) { $SettlementAmount } else { $Amount }
$billing = if ($BillingAmount) { $BillingAmount } else { $Amount }

$scriptPath = Join-Path -Path $PSScriptRoot -ChildPath 'scripts\send-a2a-request.js'
if (-not (Test-Path $scriptPath)) {
  Write-Error "Cannot locate scripts\send-a2a-request.js (expected at $scriptPath)."
  exit 1
}

function Escape-Argument {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  '"' + ($Value -replace '"', '\"') + '"'
}

$arguments = @(
  $scriptPath,
  '--host', "$RemoteHost",
  '--port', "$Port",
  '--pan', $Pan,
  '--procCode', $ProcessingCode,
  '--amount', $Amount,
  '--settlementAmount', $settlement,
  '--billingAmount', $billing,
  '--stan', $Stan,
  '--rrn', $Rrn,
  '--merchantType', $MerchantType,
  '--entryMode', $EntryMode,
  '--acquirerId', $AcquirerId,
  '--terminalId', $TerminalId,
  '--cardAcceptorId', $CardAcceptorId,
  '--cardAcceptorName', $CardAcceptorName,
  '--counterpart', $CounterpartAccount,
  '--additionalInfo', $AdditionalInfo,
  '--currency', $CurrencyCode
)

Write-Host "Executing Node CLI to send A2A credit request..."
Write-Host ("node {0}" -f (($arguments | ForEach-Object { Escape-Argument $_ }) -join ' '))

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = 'node'
$processInfo.Arguments = ($arguments | ForEach-Object { Escape-Argument $_ }) -join ' '
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.UseShellExecute = $false

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $processInfo
$null = $process.Start()

$stdOut = $process.StandardOutput.ReadToEnd()
$stdErr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

if ($stdOut) {
  Write-Host $stdOut
}

if ($stdErr) {
  Write-Error $stdErr
}

if ($process.ExitCode -ne 0) {
  Write-Error ("send-a2a-request failed with exit code {0}" -f $process.ExitCode)
  exit $process.ExitCode
}

Write-Host "A2A credit request completed successfully."
# PowerShell script to trigger sending 0100 account-to-account credit request to connected client
# Usage: .\send-a2a-request.ps1 [connectionId]

param(
    [string]$ConnectionId = ""
)

$triggerFile = "send-a2a-request.trigger"

# Create trigger file
New-Item -Path $triggerFile -ItemType File -Force | Out-Null

Write-Host "Trigger file created: $triggerFile" -ForegroundColor Green
Write-Host "Server will send 0100 account-to-account credit request to connected client..." -ForegroundColor Cyan
Write-Host "Waiting for server to process..." -ForegroundColor Yellow

# Wait a moment for the server to process
Start-Sleep -Seconds 2

# Check if trigger file was removed (server processed it)
if (Test-Path $triggerFile) {
    Write-Host "Warning: Trigger file still exists. Server may not be running or no clients connected." -ForegroundColor Yellow
} else {
    Write-Host "Trigger file processed. Request sent!" -ForegroundColor Green
}

