# Load-test API instance.
#
# The dev server on :4000 is left exactly as it is. This starts an additional instance with the
# two variables the lab path needs, so the load test measures the production-shaped request path
# instead of the disabled-by-default development one.
#
#   PORT                 4001 by default; pass -Port to run a cluster (see below).
#   TRUSTED_PROXY_IPS=127.0.0.1,::1   the load generator plays the part of Nginx. Without
#                                    this, clientIp() ignores X-Forwarded-For entirely and
#                                    every request reports the socket address, so the CIDR
#                                    allowlist and the device binding would both be measuring
#                                    the same loopback address thousands of times.
#   LAB_IP_RANGES=10.20.0.0/16        the fake lab network the generated client IPs live in.
#                                    Empty = restriction disabled, which is the dev default.
#
# SEB_KEYS stays empty on purpose: an empty list bypasses the Safe Exam Browser check outside
# production, so the load test does NOT exercise the SEB hash path. See the Limitations section of
# the runbook -- SEB on real hardware is still deferred (spec 6.2, phase 6).
#
# WHY A CLUSTER IS NEEDED, which is the whole point of -Instances:
#
# bcryptjs is pure JavaScript, so every bcrypt.compare runs on the Node MAIN THREAD and blocks
# the event loop for its full duration. Measured on this machine at cost 10: one compare is
# ~91 ms, and therefore exactly ONE login can be completed per 91 ms per process -- no matter how
# many cores are present. The login p95 across the ramp was linear in VU count (100 VU -> 8.2 s,
# 200 -> 18.1 s, 267 successful of 400 -> 25.8 s), which is the signature of a strictly serialised
# queue rather than saturation.
#
# So capacity scales with PROCESS COUNT, not core count. The cluster run in results/ measures four
# processes against one, and that ratio is the number the deployment plan is built on.
[CmdletBinding()]
param(
  [int]$Port = 4001,
  [ValidateRange(1, 16)]
  [int]$Instances = 1,
  # Seconds between instance starts. Without a gap they all boot, warm their Prisma pool and JIT
  # the same code at the same instant, and the first second of the run measures the boot storm
  # rather than the steady state.
  [int]$StaggerSeconds = 3,
  # Prisma's default pool is 2 * cores + 1. On a 20-thread box that is 41 connections PER
  # PROCESS, so four processes ask for 164 and this Postgres has max_connections = 100. The
  # overflow surfaces as "too many clients already" under load rather than at boot, which makes it
  # look like a load problem instead of a configuration one. Each instance gets an explicit share
  # instead: Instances * ConnectionLimit must stay under max_connections (or under the PgBouncer
  # pool size in the deployed topology).
  [int]$ConnectionLimit = 10
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root
$apiDir = Join-Path $root 'apps\api'

# Read the real DATABASE_URL out of apps/api/.env rather than assuming one: connection_limit has
# to be appended to whatever credentials the cluster is actually configured with. dotenv does not
# overwrite a variable that is already set, so exporting it here is enough to win.
$envFile = Join-Path $apiDir '.env'
$dbLine = (Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL=' } | Select-Object -First 1)
if (-not $dbLine) { throw "No DATABASE_URL in $envFile" }
$baseUrl = ($dbLine -replace '^\s*DATABASE_URL=', '').Trim().Trim('"')

for ($i = 0; $i -lt $Instances; $i++) {
  $p = $Port + $i
  try {
    $existing = Invoke-RestMethod -Uri "http://localhost:$p/api/v1/health" -TimeoutSec 2
    Write-Host "already listening on $p (database=$($existing.database)) - leaving it alone"
    continue
  } catch { }

  $env:PORT = "$p"
  $env:TRUSTED_PROXY_IPS = '127.0.0.1,::1'
  $env:LAB_IP_RANGES = '10.20.0.0/16'
  $env:NODE_ENV = 'development'
  $env:DATABASE_URL = "$baseUrl`?connection_limit=$ConnectionLimit"

  # Start-Process -WindowStyle Hidden with its own redirected handles, never -Wait and never
  # -NoNewWindow. The postmaster lesson from scripts/dev-db-up.ps1 applies with more force here:
  # a child that inherits the caller's console holds the caller's stdout pipe open, so anything
  # that captures this script's output blocks until the API exits. -Wait would block forever for
  # the same reason.
  $out = Join-Path $env:TEMP "lt-api-$p.out.log"
  $err = Join-Path $env:TEMP "lt-api-$p.err.log"
  Start-Process -FilePath 'node' `
    -ArgumentList @("$root\node_modules\tsx\dist\cli.mjs", 'src/index.ts') `
    -WorkingDirectory $apiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null

  Write-Host "started api on :$p  connection_limit=$ConnectionLimit  (logs: $out / $err)"
  if ($i -lt ($Instances - 1)) { Start-Sleep -Seconds $StaggerSeconds }
}

# Report only what actually answers, not what was requested.
$up = 0
for ($i = 0; $i -lt $Instances; $i++) {
  $p = $Port + $i
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      $h = Invoke-RestMethod -Uri "http://localhost:$p/api/v1/health" -TimeoutSec 3
      if ($h.database -eq 'connected') { Write-Host "  :$p ok  database=connected"; $up++; break }
    } catch { }
    if ($attempt -eq 30) { Write-Warning "  :$p never answered" }
    Start-Sleep -Seconds 1
  }
}
Write-Host "$up/$Instances instance(s) ready on $Port..$($Port + $Instances - 1)"
