$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectDir '.tmp'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir 'server-supervisor.log'
Set-Location -LiteralPath $projectDir

try {
  $docker = (Get-Command docker -ErrorAction Stop).Source
  $compose = Start-Process -FilePath $docker -ArgumentList @('compose', 'up', '-d', '--wait') `
    -WorkingDirectory $projectDir -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'docker-compose.out.log') `
    -RedirectStandardError (Join-Path $logDir 'docker-compose.err.log')
  if ($compose.ExitCode -ne 0) { throw 'Docker Compose chưa sẵn sàng.' }
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$(Get-Date -Format o) Docker Compose ready."
} catch {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$(Get-Date -Format o) $($_.Exception.Message)"
  throw
}
