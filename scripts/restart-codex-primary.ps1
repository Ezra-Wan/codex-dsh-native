param([Parameter(Mandatory=$true)][string]$Manifest,[switch]$CheckOnly,[ValidateRange(0,60)][int]$DelaySeconds=20)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath $Manifest -Encoding UTF8 -Raw | ConvertFrom-Json
$statePath=Join-Path (Split-Path -Parent $Manifest) 'restart-state.json'
function Save-State([string]$phase,[string]$detail='',[int]$newPid=0) {
  @{Phase=$phase;Detail=$detail;OldPrimaryPid=$plan.PrimaryPid;NewPrimaryPid=$newPid;IsolatedPid=$plan.IsolatedPid;
    At=(Get-Date).ToString('o');ModelCalls=0} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
try {
  Save-State 'scheduled' 'Primary app restart requested by user; waiting for the current reply.'
  if(-not $CheckOnly){Start-Sleep -Seconds $DelaySeconds}
  # Re-check durable bridge work immediately before closing the application.
  foreach($directory in @((Join-Path $plan.BridgeRoot 'tasks'),(Join-Path $plan.BridgeRoot 'worker-tasks'))) {
    foreach($file in @(Get-ChildItem -LiteralPath $directory -File -Filter '*.json' -ErrorAction SilentlyContinue)) {
      if($file.BaseName -notmatch '^[a-f0-9-]{36}$'){continue}
      try{$record=Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Raw | ConvertFrom-Json}catch{throw 'A task state file is unreadable UTF-8 JSON; restart cancelled.'}
      if($record.status -in @('starting','running','stopping','unknown')){throw 'A bridge task became active or uncertain; restart cancelled.'}
    }
  }
  if($CheckOnly){Save-State 'checked' 'UTF-8 task-state preflight passed; no process was stopped or launched.';exit 0}
  $target=Get-CimInstance Win32_Process -Filter "ProcessId=$($plan.PrimaryPid)"
  if($target){
    if($target.Name -ne 'ChatGPT.exe' -or $target.CommandLine -match '--type=|--user-data-dir|codex-dev-instance' -or $target.ExecutablePath -ne $plan.Binary){throw 'Primary process identity changed; refusing to close it.'}
    $primary=Get-Process -Id $plan.PrimaryPid
    if($primary.StartTime.ToUniversalTime().Ticks -ne [long]$plan.StartTicks){throw 'Primary PID was reused; restart cancelled.'}
    Save-State 'closing' 'Closing the verified primary app; isolated instance is untouched.'
    [void]$primary.CloseMainWindow()
    if(-not $primary.WaitForExit(8000)){Stop-Process -Id $plan.PrimaryPid -Force;Wait-Process -Id $plan.PrimaryPid -Timeout 10 -ErrorAction SilentlyContinue}
  }
  $existing=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type=|--user-data-dir'})
  if($existing.Count){Save-State 'already-running' 'A primary instance is already running; no duplicate launched.' $existing[0].ProcessId;exit 0}
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$plan.Binary
  $start.WorkingDirectory=Split-Path -Parent $plan.CodexHome
  $start.UseShellExecute=$false
  $start.EnvironmentVariables['CODEX_HOME']=$plan.CodexHome
  if($start.EnvironmentVariables['CODEX_ELECTRON_USER_DATA_PATH'] -like '*codex-dev-instance*'){
    $start.EnvironmentVariables.Remove('CODEX_ELECTRON_USER_DATA_PATH')
  }
  $child=[Diagnostics.Process]::Start($start)
  Start-Sleep -Seconds 4
  $running=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)"
  if(-not $running -or $running.Name -ne 'ChatGPT.exe' -or $running.CommandLine -match '--type=|--user-data-dir'){throw 'Primary relaunch could not be confirmed.'}
  Save-State 'restarted' 'New primary process is running; actual MCP host acceptance remains pending.' $child.Id
} catch {
  Save-State 'failed' $_.Exception.Message
  exit 1
}
