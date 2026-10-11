<#
Installs a Windows per-user scheduled task. It starts the independent OMS
DataDoc worker every time THIS Windows account signs in.
No administrator privileges or website tab are required.
Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install_autostart.ps1 -PythonExe "C:\Path\To\python.exe"
Never run as SYSTEM: the DataDoc Selenium browser needs the signed-in desktop.
#>
param([string]$PythonExe = "")
$ErrorActionPreference = 'Stop'
$taskName = 'PJS OMS DataDoc Worker'
$folder = (Resolve-Path $PSScriptRoot).Path
$worker = Join-Path $folder 'independent_worker.py'
$config = Join-Path $folder '.env'
if (-not (Test-Path $worker)) { throw "Worker script not found: $worker" }
if (-not (Test-Path $config)) { throw "Create worker\.env from .env.example first. Keep it secret." }
if (-not $PythonExe) {
  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $command) { throw 'Python not found. Supply -PythonExe with its absolute path.' }
  $PythonExe = $command.Source
}
if (-not (Test-Path $PythonExe)) { throw "Python executable does not exist: $PythonExe" }
& $PythonExe -c 'import supabase, dotenv, selenium'
if ($LASTEXITCODE -ne 0) { throw 'Required packages are not installed. Run: python -m pip install -r requirements.txt' }

$windowsUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $windowsUser -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $windowsUser
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument ('"{0}"' -f $worker) -WorkingDirectory $folder
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts PJS independent OMS DataDoc-only queue worker on Windows login.'
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

Write-Host ''
Write-Host "Installed $taskName for Windows user $windowsUser" -ForegroundColor Green
Write-Host 'It will start at your next Windows sign-in, even if the PJS website is not open.'
Write-Host 'First check: run .\independent_worker.py manually with LIVE=0; inspect logs\datadoc-worker.log.'
Write-Host 'Only after confirming one known sample: set PJS_ENABLE_LIVE_DATADOC=1 in worker\.env.'
Write-Host "Start manually now (if ready): Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove startup later: .\uninstall_autostart.ps1"
