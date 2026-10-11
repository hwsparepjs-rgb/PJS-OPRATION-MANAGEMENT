$ErrorActionPreference = 'Stop'
$taskName = 'PJS OMS DataDoc Worker'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host 'PJS DataDoc automatic startup disabled. Pending OMS jobs are preserved.'
} else {
  Write-Host 'No automatic startup task is registered.'
}
