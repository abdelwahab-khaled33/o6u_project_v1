<#
.SYNOPSIS
  Runs the student exam path load test and archives the summary.

.DESCRIPTION
  Wraps `k6 run` so that every measurement is reproducible and its artefacts are kept.
  The thresholds in student-exam-path.js were derived from the archived summaries in
  results/, so re-deriving them means re-running this and diffing the numbers -- not
  editing the script by feel.

  Changes directory into infra/k6 first, because k6 resolves the handleSummary output path
  (and a relative FIXTURE) against the working directory, not against the script.

  -StudentOffset exists for the capacity ramp. Each step must seat students nobody has already
  sat the exam with -- a second attempt answers 409 "already submitted", which reads as a
  capacity failure and is not one -- so each step slides the window forward through ONE seeded
  cohort instead of re-seeding between steps.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\run.ps1 -Vus 200 -ExamSeconds 60 -Label baseline

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\run.ps1 -Vus 200 -StudentOffset 200 -Label ramp-200
#>
[CmdletBinding()]
param(
  [int]$Vus = 0,                    # 0 = use the seeded cohort size
  [int]$StudentOffset = 0,          # which student in the cohort this run starts from
  [int]$ExamSeconds = 60,
  [int]$RampSeconds = 20,
  [string]$ApiBase = 'http://localhost:4001/api/v1',
  [string]$Label = 'run',
  # Subdirectory under results/ for this run's artefacts. Needed when several k6 processes run
  # at once, one per API instance, so their artefacts stay separable.
  [string]$ResultsSubdir = '',
  [string]$K6 = "$env:USERPROFILE\k6\k6-v2.3.0-windows-amd64\k6.exe",

  # --- window pre-flight (see below). Defaults match seed.ps1 so both scripts read alike. ---
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 5432,
  [string]$DbName = 'exam_platform',
  [string]$DbUser = 'postgres',
  [string]$DbPassword = 'postgres',
  [string]$Psql = "$env:USERPROFILE\pgsql16\pgsql\bin\psql.exe",
  # Only for a deliberate re-run of a known-consumed window, where the 409s are the point.
  [switch]$SkipWindowCheck
)

$ErrorActionPreference = 'Stop'
$k6Dir = $PSScriptRoot
if ($ResultsSubdir) { $ResultsDir = "results/$ResultsSubdir" } else { $ResultsDir = 'results' }
$results = Join-Path $k6Dir $ResultsDir
New-Item -ItemType Directory -Force -Path $results | Out-Null

$fixture = Join-Path $k6Dir 'seed\fixture.json'
if (-not (Test-Path $fixture)) { throw "No fixture. Run seed.ps1 first: $fixture" }

# Fail early and legibly rather than letting k6 report 5,000 identical start failures.
try {
  $health = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 10
  if ($health.database -ne 'connected') { throw "API database=$($health.database)" }
} catch {
  throw "Load-test API is not answering on $ApiBase. Start it with infra\k6\start-api.ps1. ($_)"
}

# --- pre-flight: is this window actually unused? ------------------------------------------
#
# A student can sit the exam once. A second start on an already-attempted student answers
# 409 (SESSION_ACTIVE_ELSEWHERE while in_progress, "already submitted" once submitted), and
# in an archived summary that is INDISTINGUISHABLE from a capacity failure: every check on
# that leg fails, the other legs pass, and the numbers get filed as a result. This exact
# thing happened -- a 4-leg run where one leg reported "start failure rate: 1.0000" and
# the failure turned out to be a window an earlier multi-iteration run had already walked
# over, found only after reading started_at out of the database.
#
# So the window is checked BEFORE k6 starts. It costs one query and it is the difference
# between "2 seconds, clear message" and "a full run whose artefacts are worthless".
$effVus = if ($Vus -gt 0) { $Vus } else { [int](Get-Content $fixture -Raw | ConvertFrom-Json).studentCount }
if (-not $SkipWindowCheck) {
  $fx = Get-Content $fixture -Raw | ConvertFrom-Json
  $first = '{0}{1}' -f $fx.studentPrefix, ([string]($StudentOffset + 1)).PadLeft(5, '0')
  $last  = '{0}{1}' -f $fx.studentPrefix, ([string]($StudentOffset + $effVus)).PadLeft(5, '0')
  $env:PGPASSWORD = $DbPassword
  $qFile = Join-Path $env:LOCALAPPDATA "Temp\opencode\lt-window-check.sql"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $qFile) | Out-Null
  $q = @"
select se.status::text || '=' || count(*)::int
from "User" u join "StudentExam" se on se.student_id = u.id and se.exam_id = '$($fx.examId)'
where u.username >= '$first' and u.username <= '$last'
  and se.status in ('submitted','auto_submitted','in_progress')
group by se.status order by 1;
"@
  Set-Content -Path $qFile -Value $q -NoNewline -Encoding UTF8
  $qb = [System.IO.File]::ReadAllBytes($qFile)
  if ($qb.Length -ge 3 -and $qb[0] -eq 0xEF -and $qb[1] -eq 0xBB -and $qb[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($qFile, $qb[3..($qb.Length - 1)])
  }
  $used = & $Psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -t -A -f $qFile
  if ($LASTEXITCODE -ne 0) { throw "window pre-flight query failed (exit $LASTEXITCODE)" }
  if ($used) {
    throw @"
Offset $StudentOffset with $effVus VUs seats students $first .. $last, and those attempts are
already consumed: $($used -join ', ').
A student may sit the exam once; a second start answers 409 and would be filed as a
capacity failure. Re-arm the window and re-run:
  powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset $StudentOffset -Vus $effVus
or point the run at a fresh window with -StudentOffset <n>.
"@
  }
  Write-Host "    window ok: students $first .. $last are unused ($effVus students)"
}

Set-Location $k6Dir
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
# k6 writes the machine-readable summary under this exact name itself (RUN_LABEL), so nothing
# has to move it. The earlier rename-after-the-fact step was a cross-process race: with one k6
# per API instance, the first run.ps1 to finish renamed whichever summary.json existed, which
# included another leg's, and that leg's numbers were lost even though its console output looked
# complete. The console transcript is timestamped separately, since two legs in the same second
# would otherwise share a .txt too.
$runLabel = "$Label-$stamp"
$summaryPath = Join-Path $results "$runLabel.json"
$txtPath = Join-Path $results "$runLabel.txt"

$args = @(
  'run',
  "-e", "FIXTURE=$fixture",
  "-e", "API_BASE=$ApiBase",
  "-e", "EXAM_SECONDS=$ExamSeconds",
  "-e", "RAMP_SECONDS=$RampSeconds",
  "-e", "STUDENT_OFFSET=$StudentOffset",
  "-e", "RESULTS_DIR=$ResultsDir",
  "-e", "RUN_LABEL=$runLabel"
)
if ($Vus -gt 0) { $args += @('-e', "VUS=$Vus") }

Write-Host "=== k6 run: $Label  vus=$Vus offset=$StudentOffset exam=${ExamSeconds}s ramp=${RampSeconds}s ==="
# stderr goes to its own file rather than being merged into the pipeline, and $ErrorActionPreference
# is relaxed for the duration of the call.
#
# `& $K6 @args 2>&1` alone is not safe here. Windows PowerShell wraps a native command's stderr
# into ErrorRecords, and under 'Stop' the FIRST such line becomes a terminating error. k6 writes
# one warning to stderr per failed request, so the run died at the first timeout -- exactly the run
# whose numbers matter most -- and archived nothing at all.
$errPath = Join-Path $results "$runLabel.stderr.txt"
$previousEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$out = & $K6 @args 'student-exam-path.js' 2> $errPath
$code = $LASTEXITCODE
$ErrorActionPreference = $previousEap
$out | Out-File -FilePath $txtPath -Encoding utf8
$out | Select-Object -Last 30 | Write-Host
if ((Test-Path $errPath) -and (Get-Item $errPath).Length -gt 0) {
  $errText = Get-Content $errPath -Raw
  $warnCount = ($errText -split "`n").Count
  Write-Host "k6 stderr: $warnCount line(s) -> $errPath"
  # Group the warnings by cause. "connection refused" and "timeout" are completely different
  # capacity failures -- one is the listen backlog giving up, the other is the event loop.
  foreach ($kind in @('actively refused', 'i/o timeout', 'context deadline', 'reset by peer', 'no buffer space')) {
    $n = ([regex]::Matches($errText, [regex]::Escape($kind))).Count
    if ($n -gt 0) { Write-Host ("  {0,-22} {1}" -f $kind, $n) }
  }
}

if (Test-Path $summaryPath) {
  Write-Host "summary -> $summaryPath"
  Write-Host "text    -> $txtPath"
} else {
  Write-Warning "k6 exited $code but wrote no summary at $summaryPath"
}

Write-Host "k6 exit code: $code"
exit $code
