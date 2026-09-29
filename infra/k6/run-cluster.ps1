<#
.SYNOPSIS
  Runs the student exam path load test across N API processes, one k6 process each.

.DESCRIPTION
  Why a cluster at all: bcryptjs is pure JavaScript, so every bcrypt.compare runs on the Node
  MAIN thread and blocks the event loop for its full duration. Measured here at cost 10, one
  compare is ~91 ms, so exactly one login completes per 91 ms per PROCESS -- core count is
  irrelevant. Capacity therefore scales with process count, and "how many students can we seat"
  is only answerable by running more than one process.

  One k6 process per API instance, each driving its own VU window. That is the honest way to do
  it: a single k6 process pointed at a load balancer would work too, but then k6 would be
  competing with Nginx for the same cores, and on a laptop that is a second variable nobody wants
  in the middle of a capacity measurement. The four legs are independent runs and each writes its
  own artefacts, so a leg that dies does not take the other three with it.

  Each leg gets a DISJOINT window of the seeded cohort (-StudentOffset + i * -VusPerProcess).
  A second attempt at an exam a student already sat answers 409 "already submitted", which reads
  as a capacity failure and is not one.

  The API instances are started by start-api.ps1, which is idempotent: ports already listening are
  left alone, so re-running this against a warm cluster is safe.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\run-cluster.ps1 -Processes 4 -VusPerProcess 100 -StudentOffset 1726 -Label thr

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\run-cluster.ps1 -Processes 4 -VusPerProcess 100 -StudentOffset 2126 -ExamSeconds 300 -RampSeconds 30 -Label sust2
#>
[CmdletBinding()]
param(
  [int]$Processes = 4,
  [int]$VusPerProcess = 100,
  [int]$StudentOffset = 0,
  [int]$ExamSeconds = 60,
  [int]$RampSeconds = 20,
  [int]$BasePort = 4001,
  [string]$Label = 'cluster',
  [int]$ConnectionLimit = 10
)

$ErrorActionPreference = 'Stop'
$k6Dir = $PSScriptRoot
$fixture = Join-Path $k6Dir 'seed\fixture.json'
if (-not (Test-Path $fixture)) { throw "No fixture. Run infra\k6\seed\seed.ps1 first: $fixture" }

Write-Host "==> ensuring $Processes API instance(s) on $BasePort..$($BasePort + $Processes - 1)"
& (Join-Path $k6Dir 'start-api.ps1') -Port $BasePort -Instances $Processes -ConnectionLimit $ConnectionLimit

$legs = @()
for ($i = 0; $i -lt $Processes; $i++) {
  $port = $BasePort + $i
  $offset = $StudentOffset + ($i * $VusPerProcess)
  $legLabel = "$Label-$i"
  $logDir = Join-Path $k6Dir "results\cluster"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $out = Join-Path $logDir "$legLabel-driver.log"
  $err = Join-Path $logDir "$legLabel-driver.err.log"

  $argList = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $k6Dir 'run.ps1'),
    '-Vus', "$VusPerProcess",
    '-StudentOffset', "$offset",
    '-ExamSeconds', "$ExamSeconds",
    '-RampSeconds', "$RampSeconds",
    '-ApiBase', "http://localhost:$port/api/v1",
    '-Label', $legLabel,
    '-ResultsSubdir', 'cluster'
  )
  # -WindowStyle Hidden with its own redirected handles, and NO -Wait and NO -NoNewWindow.
  # A child that shares the caller's console holds the caller's stdout pipe open, so anything
  # capturing this script's output would block until the last leg exits; -Wait would block on the
  # whole process tree. Waiting is done on the returned .NET Process object instead, which is a
  # different thing entirely.
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList `
    -WorkingDirectory $k6Dir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  # Touching .Handle caches the native handle. Without this, .ExitCode comes back EMPTY after the
  # process is gone -- PowerShell never opened the handle, so it has no exit status to read, and
  # a leg that failed a threshold would be reported as "EXIT " with no number. Reading the handle
  # once here is what makes the exit code readable later.
  $null = $p.Handle
  $legs += [pscustomobject]@{ Index = $i; Port = $port; Offset = $offset; Proc = $p }
  Write-Host "  leg $i -> :$port  offset=$offset  vus=$VusPerProcess  pid=$($p.Id)"
  # A gap between legs, for the same reason start-api.ps1 staggers instances: without it all the
  # legs fire their 100 logins on the same instant and the first seconds measure a thundering
  # herd rather than the steady state.
  if ($i -lt ($Processes - 1)) { Start-Sleep -Seconds 3 }
}

# The student NUMBERS are offset+1 .. offset+total, not offset .. offset+total-1. That matches
# lib/config.js studentNameFor(), where VU index 0 maps to number offset+1. Labelling the
# window with the offset alone shifts it by one student, which reads as an off-by-one bug in
# the product rather than in the label -- and the pre-flight in run.ps1 states real student
# numbers, so the two have to agree.
Write-Host "==> $($legs.Count) leg(s) launched; total VUs = $($Processes * $VusPerProcess), student numbers $($StudentOffset + 1)..$($StudentOffset + $Processes * $VusPerProcess)"

$failed = 0
foreach ($leg in $legs) {
  $leg.Proc.WaitForExit()
  $code = $leg.Proc.ExitCode
  $tag = if ($code -eq 0) { 'ok' } else { "EXIT $code" }
  if ($code -ne 0) { $failed++ }
  Write-Host "  leg $($leg.Index) (:$($leg.Port), offset $($leg.Offset)) finished: $tag"
}

Write-Host "==> leg exit codes: $failed non-zero of $($legs.Count) (a non-zero code means a THRESHOLD failed, not that the run errored)"
Write-Host "==> summaries: infra\k6\results\cluster\$Label-*.json"
if ($failed -gt 0) { exit 1 }
exit 0
