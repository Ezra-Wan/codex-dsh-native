param([Parameter(Mandatory=$true)][string]$IsolatedRoot, [Parameter(Mandatory=$true)][string]$FloatHome, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$experimentPath = [IO.Path]::GetFullPath($IsolatedRoot)
$floatPath = [IO.Path]::GetFullPath($FloatHome)
if (!$floatPath.StartsWith($experimentPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Float must stay inside the explicitly selected isolated instance.' }
$receipt = Get-Content -LiteralPath (Join-Path $floatPath 'receipt.json') -Raw | ConvertFrom-Json
if ($receipt.data -ne (Join-Path $floatPath 'data') -or $receipt.code -ne (Join-Path $floatPath 'code') -or $receipt.codexHome -ne (Join-Path $experimentPath 'codex-home')) { throw 'Unexpected isolated float receipt.' }
$launch = Get-Content -LiteralPath (Join-Path $experimentPath 'launch.json') -Raw | ConvertFrom-Json
if (!$Stop) {
  $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($launch.ExperimentPid)"
  if (!$hostProcess -or $hostProcess.Name -ne 'ChatGPT.exe' -or $hostProcess.CommandLine -match '--type=' -or !$hostProcess.CommandLine.Contains((Join-Path $experimentPath 'user-data'))) { throw 'The exact isolated Codex root process must be running.' }
  if (!(Test-Path -LiteralPath (Join-Path $receipt.data 'desktop-runtime/node_modules/electron/dist/electron.exe'))) { throw 'Install the isolated desktop runtime first.' }
  if (!$env:DEEPSEEK_API_KEY) { throw 'DEEPSEEK_API_KEY must be available in this process; no credential is copied into settings.' }
  $statePath = Join-Path $receipt.data 'supervisor-state.json'
  if (Test-Path -LiteralPath $statePath) { throw 'Existing supervisor state: inspect it and stop the isolated companion before relaunching.' }
}
$launcher = [Diagnostics.ProcessStartInfo]::new()
$launcher.FileName = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$scriptPath = Join-Path $receipt.code 'desktop/supervisor.ps1'
foreach ($candidate in @($scriptPath,$receipt.data)) { if ($candidate.Contains('"')) { throw 'Unexpected quote in launcher path.' } }
$launcher.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -DataDir "' + $receipt.data + '"'
if ($Stop) { $launcher.Arguments += ' -Stop' }
$launcher.UseShellExecute = $false
$launcher.CreateNoWindow = $true
$launcher.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$launcher.WorkingDirectory = $receipt.code
$launcher.EnvironmentVariables['WHALE_HOME'] = $receipt.data
$launcher.EnvironmentVariables['CODEX_HOME'] = $receipt.codexHome
$launcher.EnvironmentVariables['CODEX_DSH_WHALE_TARGET_PID'] = [string]$launch.ExperimentPid
$supervisor = [Diagnostics.Process]::Start($launcher)
if ($Stop) { $supervisor.WaitForExit(); if ($supervisor.ExitCode -ne 0) { throw 'Isolated stop signal failed.' }; return }
@{SupervisorPid=$supervisor.Id;TargetCodexPid=$launch.ExperimentPid;StartedAt=(Get-Date).ToString('o');AutoStartInstalled=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $floatPath 'launch.json') -Encoding UTF8
[pscustomobject]@{SupervisorPid=$supervisor.Id;TargetCodexPid=$launch.ExperimentPid;AutoStartInstalled=$false} | ConvertTo-Json
