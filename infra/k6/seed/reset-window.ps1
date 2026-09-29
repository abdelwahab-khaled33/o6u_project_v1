<#
.SYNOPSIS
  Re-arms a slice of the load-test cohort so it can sit the exam again.

.DESCRIPTION
  A student can only ever sit the load-test exam ONCE. That is not a quirk of the harness,
  it is the product: a second `POST /start` on an attempt that is already `in_progress`
  answers 409 SESSION_ACTIVE_ELSEWHERE (the attempt still holds the session_ip and
  session_token of whoever started it), and an attempt that is already `submitted`
  answers 409 "already submitted". Both are indistinguishable, in a summary file, from a
  capacity failure -- every check on that leg fails while the other legs pass, and the
  archived numbers look like a real result.

  So a cohort is consumed one-shot and a window can only be used once. This script gives
  the window back by deleting that slice's attempts and their snapshot rows, after which
  `GET /student/exams` lazily re-creates the attempts as not_started and a fresh start
  works. It is a FIXTURE operation, deliberately done in SQL: the real product remedy for
  a stuck attempt is the release route, which clears the device session but deliberately
  leaves the attempt, its start time and its deadline alone, and a re-run needs a student
  who has genuinely never sat the exam.

  Only rows tagged lt_stu_ are ever touched.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset 1726 -Vus 100

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset 1726 -Vus 100 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$StudentOffset,
  [Parameter(Mandatory)][int]$Vus,
  [string]$ApiBase = '',                     # unused; kept so both scripts read alike
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 5432,
  [string]$DbName = 'exam_platform',
  [string]$DbUser = 'postgres',
  [string]$DbPassword = 'postgres',
  [string]$Psql = "$env:USERPROFILE\pgsql16\pgsql\bin\psql.exe",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$fixturePath = Join-Path $PSScriptRoot 'fixture.json'
if (-not (Test-Path $fixturePath)) { throw "No fixture: $fixturePath" }
$fixture = Get-Content $fixturePath -Raw | ConvertFrom-Json
$env:PGPASSWORD = $DbPassword
$tmpDir = Join-Path $env:LOCALAPPDATA 'Temp\opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# Fixed-width 5-digit names, so a lexicographic range IS a numeric range. (An earlier probe
# used the unpadded form and matched nothing, which looked like "no rows" rather than
# "wrong query" -- the same trap as a wrong row count in a verification join.)
#
# The student NUMBERS this script covers are offset+1 .. offset+Vus, not offset .. offset+Vus-1.
# That matches config.js studentNameFor(), where VU index 0 maps to number offset+1. Getting
# this wrong shifts the window by one student, which looks like an off-by-one bug in the
# product rather than in the label.
$prefix = $fixture.studentPrefix
$first = '{0}{1}' -f $prefix, ([string]($StudentOffset + 1)).PadLeft(5, '0')
$lastIndex = $StudentOffset + $Vus
$last = '{0}{1}' -f $prefix, ([string]$lastIndex).PadLeft(5, '0')
$examId = $fixture.examId

Write-Host "==> offset $StudentOffset, $Vus VUs -> students $first .. $last (numbers $($StudentOffset + 1)..$lastIndex)"

# Every query goes through a file: Windows PowerShell strips the double quotes out of a
# native command's arguments, so `psql -c '... from "User" ...'` arrives unquoted and reads
# a table named `user`. A temp file cannot be mangled that way.
function Invoke-Psql {
  param([Parameter(Mandatory)][string]$Sql, [switch]$Scalar)
  $f = Join-Path $tmpDir 'lt-reset-q.sql'
  Set-Content -Path $f -Value $Sql -NoNewline -Encoding UTF8
  $bytes = [System.IO.File]::ReadAllBytes($f)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($f, $bytes[3..($bytes.Length - 1)])
  }
  $out = & $Psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -t -A -f $f
  if ($LASTEXITCODE -ne 0) { throw "psql failed (exit $LASTEXITCODE) on:`n$Sql" }
  $out
}

$range = "u.username >= '$first' and u.username <= '$last'"

# Report first, so a DryRun and a real run agree on what they are about to touch.
$statusSql = @"
select COALESCE(se.status::text,'(no attempt)') || ' ' || count(*)::int
from "User" u left join "StudentExam" se on se.student_id = u.id and se.exam_id = '$examId'
where $range
group by se.status order by 1;
"@
Write-Host "    before:"
Invoke-Psql -Sql $statusSql | ForEach-Object { Write-Host "      $_" }

$consumedSql = @"
select count(*)::int from "User" u
join "StudentExam" se on se.student_id = u.id and se.exam_id = '$examId'
where $range and se.status in ('submitted','auto_submitted','in_progress');
"@
$consumed = [int](Invoke-Psql -Sql $consumedSql | Select-Object -First 1)
Write-Host "    consumed attempts in window: $consumed"
if ($consumed -eq 0) { Write-Host '    nothing to do'; exit 0 }

if ($DryRun) { Write-Host '    (DryRun: no changes made)'; exit 0 }

# Deletion order is the FK order, children before parents:
#   GradeAdjustment -> StudentExamQuestion -> StudentExam.
# The load test creates no adjustments, but the FK is Restrict and a stale row here would
# abort the whole statement, so it is cleared rather than assumed absent.
#
# GradeAdjustment reaches the attempt through the QUESTION, not the attempt: its FK column
# is student_exam_question_id, and there is no student_exam_id on the table at all. Writing
# `ga.student_exam_id` fails with "column does not exist" and, because the statements share
# one transaction with ON_ERROR_STOP, the entire reset rolls back and nothing is re-armed.
$del = @"
begin;
delete from "GradeAdjustment" ga
where ga.student_exam_question_id in (
  select q.id from "StudentExamQuestion" q
  join "StudentExam" se on se.id = q.student_exam_id
  where se.exam_id = '$examId'
    and se.student_id in (select id from "User" u where $range)
);

delete from "StudentExamQuestion" q
where q.student_exam_id in (
  select se.id from "StudentExam" se
  where se.exam_id = '$examId'
    and se.student_id in (select id from "User" u where $range)
);

delete from "StudentExam" se
where se.exam_id = '$examId'
  and se.student_id in (select id from "User" u where $range);
commit;
"@
$df = Join-Path $tmpDir 'lt-reset-del.sql'
Set-Content -Path $df -Value $del -NoNewline -Encoding UTF8
$bytes = [System.IO.File]::ReadAllBytes($df)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  [System.IO.File]::WriteAllBytes($df, $bytes[3..($bytes.Length - 1)])
}
& $Psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -q -v ON_ERROR_STOP=1 -f $df
if ($LASTEXITCODE -ne 0) { throw "psql delete failed with exit $LASTEXITCODE" }

Write-Host '    after:'
Invoke-Psql -Sql $statusSql | ForEach-Object { Write-Host "      $_" }
Write-Host "    students $first .. $last re-armed"
