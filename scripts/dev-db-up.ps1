<#
.SYNOPSIS
  Brings the local development database up and verifies it, so a fresh session does not
  have to rediscover the setup. The API and web dev servers are deliberately NOT started
  here; see the note under .DESCRIPTION.

.DESCRIPTION
  This machine has no Docker and no usable WSL2 (sudo needs a password), so the database
  is PostgreSQL 16 from the EDB portable binaries. It runs as a NORMAL PROCESS, not a
  Windows service, so it does NOT survive a reboot and has to be started by hand each
  time. That is the single most common way a new session opens with a confusing
  "Environment variable not found: DATABASE_URL" or a connection error.

  HOW TO INVOKE IT, and why the exact calling style matters. This script starts a
  long-lived console process, so how you launch it decides whether the database survives:

    GOOD   powershell -ExecutionPolicy Bypass -File scripts\dev-db-up.ps1
    GOOD   powershell ... -File scripts\dev-db-up.ps1 -Quiet
    BAD    powershell ... -File scripts\dev-db-up.ps1 | Out-String
    BAD    $out = powershell ... -File scripts\dev-db-up.ps1

  The two BAD forms pipe the script's stdout, and the postmaster keeps that pipe's write
  end open for its whole life, so the read never completes. The command then has to be
  killed, and a killed launch takes the database down with it: the postmaster's backends
  die with STATUS_DLL_INIT_FAILED (0xC0000142) because their console is gone, and the
  cluster logs "shutting down due to startup process failure" and disappears. If you must
  capture the output, redirect to a file instead of piping it.

  That same reasoning is why the API and web servers are not started here. They are
  long-lived too, and the agent harness should own them so it can track and stop them;
  start those with `npm run dev:api` and `npm run dev:web` as background commands.

  The paths below are machine specific. If the project moves, edit them here rather than
  repeating the commands by hand.

.PARAMETER Quiet
  Only report status; never start anything.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-db-up.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-db-up.ps1 -Quiet
#>
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'

$PgBin     = 'C:\Users\user\pgsql16\pgsql\bin'
$PgData    = 'C:\Users\user\pgsql16\data'
$PgLog     = 'C:\Users\user\pgsql16\server.log'
$DbName    = 'exam_platform'
$DbUser    = 'postgres'
$HealthUrl = 'http://localhost:4000/api/v1/health'
$WebProxy  = 'http://localhost:5173/api/v1/health'

function Test-PortOpen([int]$Port, [int]$Retries = 0) {
  # Get-NetTCPConnection, not a hand-rolled TcpClient probe. Both failure modes of the
  # hand-rolled version were hit for real while writing this script:
  #   1. Address family. Vite binds to ::1 ONLY on this machine, while Postgres listens on
  #      127.0.0.1 and ::1 and the API listens on ::. An IPv4-only probe reports a healthy
  #      web dev server as "not running". Same IPv4/IPv6 split clientIp() must handle.
  #   2. Runtime. `powershell.exe` is 5.1 (.NET Framework), where `New-Object TcpClient`
  #      defaults to AddressFamily.InterNetwork, and TcpClient.BeginConnect has no
  #      IPEndPoint overload at all, so a "dual-stack" probe built from it reported every
  #      port as closed. Get-NetTCPConnection asks the OS, so it cannot get this wrong.
  for ($i = 0; $i -le $Retries; $i++) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
      return $true
    }
    if ($i -lt $Retries) { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

# Status is always reported: -Quiet means "change nothing", not "say nothing". Only the
# actions (starting the server) and the next-step advice are suppressed.
function Write-Status($msg) { Write-Host "    $msg" }
function Write-Step($msg) { if (-not $Quiet) { Write-Host "==> $msg" } }

# 1. The database process.
if (Test-PortOpen 5432) {
  Write-Status 'PostgreSQL is already listening on 5432.'
} else {
  if ($Quiet) {
    Write-Host 'PostgreSQL is NOT running (run without -Quiet to start it).'
  } else {
    if (-not (Test-Path $PgBin)) { throw "pg_ctl not found at $PgBin" }
    if (-not (Test-Path $PgData)) { throw "data directory not found at $PgData" }
    Write-Step 'Starting PostgreSQL...'

    # Four separate traps here, each of which was hit live while writing this script.
    #
    # 1. `-w` is the wait flag and takes NO argument. A trailing `start` is a syntax
    #    error: 'pg_ctl: too many command-line arguments (first is "start")'. That wrong
    #    form was the one recorded in AGENTS.md.
    #
    # 2. Launched as `& pg_ctl ...`, the postmaster inherits this script's stdout/stderr
    #    pipe. Anything reading that pipe (`| Out-String`, `$out = & ...`) then never
    #    finishes, because the postmaster holds the write end open for its whole life.
    #
    # 3. Do NOT pass -Wait. Start-Process -Wait waits for the entire process tree, and the
    #    postmaster never exits, so -Wait blocks forever.
    #
    # 4. Do NOT pass -NoNewWindow either. It makes the postmaster share THIS console,
    #    which is how it ends up holding the caller's pipe even when pg_ctl's own handles
    #    are redirected to files. -WindowStyle Hidden gives it a console of its own, which
    #    is what actually makes the caller's command return.
    #
    # Why this matters beyond convenience: if the launching command is killed rather than
    # allowed to exit, the postmaster's backends die with STATUS_DLL_INIT_FAILED
    # (0xC0000142) because their console is gone, and the server then reports "startup
    # process failure" and shuts the whole cluster down. That is the log signature to look
    # for if the database keeps vanishing.
    $pgOut = Join-Path $env:TEMP 'exam-dev-pgctl-out.txt'
    $pgErr = Join-Path $env:TEMP 'exam-dev-pgctl-err.txt'
    Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') `
      -ArgumentList @('start', '-D', $PgData, '-l', $PgLog, '-w') `
      -WindowStyle Hidden -RedirectStandardOutput $pgOut -RedirectStandardError $pgErr | Out-Null

    # Wait by polling the port instead of by waiting on the process. Section 2 below then
    # proves the server actually answers queries.
    if (-not (Test-PortOpen 5432 -Retries 60)) {
      $why = (Get-Content $pgOut, $pgErr -ErrorAction SilentlyContinue) -join ' '
      throw "PostgreSQL did not start listening on 5432. pg_ctl said: $why (see $PgLog)"
    }
    Write-Step "pg_ctl said: $((Get-Content $pgOut -ErrorAction SilentlyContinue) -join ' ')"
  }
}

# 2. Prove it actually accepts a connection, rather than trusting the port.
$env:PGPASSWORD = 'postgres'
$psql = Join-Path $PgBin 'psql.exe'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  if (Test-PortOpen 5432) {
    & $psql -h localhost -U $DbUser -d $DbName -tAc 'SELECT 1' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "PostgreSQL is not answering queries on $DbName after 15s." }
Write-Status "PostgreSQL is accepting queries on database '$DbName'."

# 3. Schema drift. A new migration that was written but never applied is the failure mode
#    that wastes the most time, because every query fails in a way that looks unrelated.
if ($Quiet) {
  Write-Status 'Schema drift NOT checked (-Quiet skips `prisma migrate status`).'
} else {
  Push-Location (Join-Path $PSScriptRoot '..\apps\api')
  try {
    # prisma writes progress to stderr, and with $ErrorActionPreference = 'Stop' a
    # redirected native-command stderr becomes a terminating error. Drop to 'Continue'
    # for this one call and trust $LASTEXITCODE instead.
    $ErrorActionPreference = 'Continue'
    $status = (& npx prisma migrate status 2>&1 | Out-String)
    $prismaExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $status -split "`r?`n" |
      Where-Object { $_ -notmatch 'CategoryInfo|FullyQualifiedErrorId|^\s*\+' } |
      Select-String -Pattern 'migrations found|up to date|pending|Error' |
      ForEach-Object { Write-Host "    $($_)" }
    if ($prismaExit -ne 0) { throw "prisma migrate status exited $prismaExit; the database may be unreachable or a migration is missing." }
  } finally {
    Pop-Location
  }
}

# 4. Servers. Reported, never started here. This is pure read-only status, so unlike the
#    advice below it is reported even under -Quiet.
Write-Host ''
if (Test-PortOpen 4000) {
  try {
    $h = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 8
    Write-Status "API: up ($($h.status) / database=$($h.database)) on 4000"
  } catch { Write-Status 'API: port 4000 is open but /health did not answer.' }
} else {
  Write-Status 'API: not running.'
}
if (Test-PortOpen 5173) {
  try {
    $h = Invoke-RestMethod -Uri $WebProxy -TimeoutSec 8
    Write-Status "Web: up on 5173, proxying /api ($($h.status) / database=$($h.database))"
  } catch { Write-Status 'Web: port 5173 is open but its /api proxy did not answer.' }
} else {
  Write-Status 'Web: not running.'
}

if (-not $Quiet) {
  Write-Host ''
  Write-Host 'Database ready. Start the servers from the repo root with:'
  Write-Host '    npm run dev:api     # tsx watch, port 4000'
  Write-Host '    npm run dev:web     # vite, port 5173, proxies /api to 4000'
}
