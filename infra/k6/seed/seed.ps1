<#
.SYNOPSIS
  Seeds a load-test cohort and a live exam, then writes the k6 fixture.

.DESCRIPTION
  Two halves, deliberately split by what they need to be honest about:

  * Students, subject, section and question pool go in through SQL. 5,000 bcrypt hashes
    through the admin API is minutes of seeding that measures nothing.
  * The exam is created and approved through the REAL API, because that is the only way to
    get a genuine access-code hash/ciphertext pair and genuine pre-generated attempts. The
    create path is where generateStudentExamsForExam runs inside its 60s transaction, so
    seeding through the API also exercises the one code path the load test cannot.

  Everything is tagged lt_ / LT so cleanup is a single cascade and never touches real data.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\k6\seed\seed.ps1 -Students 500
#>
[CmdletBinding()]
param(
  [int]$Students = 500,
  [string]$ApiBase = 'http://localhost:4000/api/v1',
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 5432,
  [string]$DbName = 'exam_platform',
  [string]$DbUser = 'postgres',
  [string]$DbPassword = 'postgres',
  [string]$Psql = "$env:USERPROFILE\pgsql16\pgsql\bin\psql.exe",
  # One password for the whole cohort. See 01-fixture.sql for why the login cost is identical.
  [string]$Password = 'LoadTest!2026',
  [int]$Mix = 2
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root
$fixturePath = Join-Path $PSScriptRoot 'fixture.json'
$env:PGPASSWORD = $DbPassword
$tmpDir = Join-Path $env:LOCALAPPDATA 'Temp\opencode'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# Every query goes through a file, never psql -c.
#
# PowerShell strips the double quotes out of a native command's arguments, so
# `psql -c 'select ... from "User"'` arrives as `from User` and Postgres reads a table
# named `user` that does not exist. The `-c` form cannot be made to work here; a temp file
# can. This is the same trap that makes the .sql fixture a file rather than an inline string.
function Invoke-Psql {
  param([Parameter(Mandatory)][string]$Sql)
  $f = Join-Path $tmpDir "lt-q.sql"
  Set-Content -Path $f -Value $Sql -NoNewline -Encoding UTF8
  $bytes = [System.IO.File]::ReadAllBytes($f)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($f, $bytes[3..($bytes.Length - 1)])
  }
  $out = & $Psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -t -A -f $f
  if ($LASTEXITCODE -ne 0) { throw "psql failed (exit $LASTEXITCODE) on:`n$Sql" }
  # Return the rows once. Emitting here as well as via the pipeline return would hand the
  # caller "50 50" for one row, and [int]"50 50" is a cast error.
  $out
}

function Write-TempSql {
  param([Parameter(Mandatory)][string]$Sql)
  $f = Join-Path $tmpDir "lt-fixture.sql"
  Set-Content -Path $f -Value $Sql -NoNewline -Encoding UTF8
  # A UTF-8 BOM at the head of a .sql file aborts the first statement with
  # `syntax error at or near "<BOM>"`. This exact trap already cost one migration.
  $bytes = [System.IO.File]::ReadAllBytes($f)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($f, $bytes[3..($bytes.Length - 1)])
    Write-Host "    (stripped UTF-8 BOM)"
  }
  $f
}

Write-Host "==> health check"
$health = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 10
if ($health.database -ne 'connected') { throw "API reports database=$($health.database)" }
Write-Host "    api ok, database=$($health.database)"

Write-Host "==> hashing the cohort password (bcrypt cost 10, once)"
$hash = node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" $Password
if (-not $hash) { throw 'bcrypt hash generation produced nothing' }
Write-Host "    hash prefix: $($hash.Substring(0,7))..."

Write-Host "==> applying fixture SQL ($Students students)"
$sql = Get-Content (Join-Path $PSScriptRoot '01-fixture.sql') -Raw
# The bcrypt alphabet is ./A-Za-z0-9$ -- no quote can appear in it, so the hash drops
# straight into a SQL single-quoted literal with no escaping.
$sql = $sql.Replace('__HASH__', $hash)
$sql = $sql -replace '(?m)^\\set student_count \d+', "\set student_count $Students"
if ($sql -match '__HASH__') { throw 'hash placeholder survived substitution' }
$tmp = Write-TempSql -Sql $sql
& $Psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -q -f $tmp
if ($LASTEXITCODE -ne 0) { throw "psql failed with exit $LASTEXITCODE" }

$counts = Invoke-Psql -Sql 'select count(*) from "User" where username like ''lt\_stu\_%'''
Write-Host "    students in cohort: $($counts.Trim())"

Write-Host "==> creating the exam through the real API (as lt_doc)"
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" -ContentType 'application/json' `
  -Body (@{ username = 'lt_doc'; password = $Password } | ConvertTo-Json) -TimeoutSec 30
$docHeaders = @{ Authorization = "Bearer $($login.token)" }

$adminLogin = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" -ContentType 'application/json' `
  -Body (@{ username = 'lt_admin'; password = $Password } | ConvertTo-Json) -TimeoutSec 30
$adminHeaders = @{ Authorization = "Bearer $($adminLogin.token)" }

$subjectId = '11111111-1111-4111-8111-111111111111'
$poolIds = @()
for ($i = 1; $i -le 30; $i++) {
  $poolIds += ('5' + $i.ToString('0000000') + '-0000-4000-8000-000000000000')
}

$now = Get-Date
$examBody = @{
  subject_id           = $subjectId
  title                = "Load Test Exam $($now.ToString('s'))"
  question_pool_ids    = $poolIds
  difficulty_mix       = @{ easy = $Mix; medium = $Mix; hard = $Mix }
  points_per_question  = 2
  duration_minutes     = 60
  start_time           = $now.AddMinutes(-5).ToUniversalTime().ToString('o')
  end_time             = $now.AddHours(4).ToUniversalTime().ToString('o')
  target_scope         = 'subject'
} | ConvertTo-Json -Depth 5

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$created = Invoke-RestMethod -Method Post -Uri "$ApiBase/exams" -ContentType 'application/json' `
  -Headers $docHeaders -Body $examBody -TimeoutSec 180
$sw.Stop()
$examId = $created.exam.id
Write-Host "    created+pre-generated in $([math]::Round($sw.Elapsed.TotalSeconds,2))s  exam=$examId  status=$($created.exam.status)"

Write-Host "==> approving (as lt_admin)"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$approved = Invoke-RestMethod -Method Post -Uri "$ApiBase/admin/exams/$examId/approve" `
  -Headers $adminHeaders -Body '{}' -ContentType 'application/json' -TimeoutSec 300
$sw.Stop()
Write-Host "    approved in $([math]::Round($sw.Elapsed.TotalSeconds,2))s  status=$($approved.exam.status)"

Write-Host "==> reading the access code (the only route that returns plaintext)"
$code = Invoke-RestMethod -Uri "$ApiBase/exams/$examId/access-code" -Headers $docHeaders -TimeoutSec 30
$plain = if ($code.access_code) { $code.access_code } elseif ($code.code) { $code.code } else { ($code | ConvertTo-Json -Compress) }
Write-Host "    access code: $plain"

# The attempt pre-generation is the expensive half of exam setup; record it so the
# k6 report can separate "how long to seat 5,000 students" from "how fast a student starts".
# Single-quoted PowerShell strings keep the SQL's own double quotes intact; a single quote
# inside is written by doubling it. A double-quoted PowerShell string would hand psql
# `from StudentExam` and Postgres would go looking for a table that is not there.
$q = 'select count(*) from "StudentExam" where "exam_id" = ''' + $examId + ''''
$attempts = Invoke-Psql -Sql $q
$q2 = 'select count(*) from "StudentExamQuestion" q join "StudentExam" s on s.id = q."student_exam_id" where s."exam_id" = ''' + $examId + ''''
$snapshots = Invoke-Psql -Sql $q2
Write-Host "    pre-generated attempts: $($attempts.Trim())   snapshot rows: $($snapshots.Trim())"

$fixture = [ordered]@{
  apiBase      = $ApiBase
  examId       = $examId
  accessCode   = $plain
  password     = $Password
  studentCount = $Students
  studentPrefix= 'lt_stu_'
  mix          = $Mix
  createdAt    = (Get-Date).ToString('o')
  attempts     = [int]$attempts.Trim()
  snapshots    = [int]$snapshots.Trim()
}
# Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM, and a BOM in front of
# JSON makes `JSON.parse` fail with "invalid character 'o' looking for beginning of value".
# UTF8Encoding($false) is "UTF-8 without BOM". The same trap bit a migration .sql file in this
# project, so it is worth writing down rather than rediscovering.
$json = $fixture | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($fixturePath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "==> fixture written to $fixturePath"
Write-Host "    Run:  k6 run -e FIXTURE=$fixturePath infra\k6\student-exam-path.js"
