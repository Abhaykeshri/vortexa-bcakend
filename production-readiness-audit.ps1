$ErrorActionPreference = "Continue"
$report = "production-readiness-report.txt"

"VORTEXA BACKEND - PRODUCTION READINESS AUDIT" | Set-Content $report
"Date: $(Get-Date)" | Add-Content $report
"==========================================" | Add-Content $report

function Section($name) {
    "`n========== $name ==========" | Tee-Object -FilePath $report -Append
}

function Run-Check($name, $command) {
    Section $name
    try {
        & cmd.exe /d /s /c "$command 2>&1" |
            Out-String |
            Tee-Object -FilePath $report -Append
        "EXIT CODE: $LASTEXITCODE" |
            Tee-Object -FilePath $report -Append
    } catch {
        "ERROR: $($_.Exception.Message)" |
            Tee-Object -FilePath $report -Append
    }
}

Section "SYSTEM"
node --version | Out-String | Add-Content $report
npm --version | Out-String | Add-Content $report
git --version | Out-String | Add-Content $report

Run-Check "GIT STATUS" "git status --short"
Run-Check "CURRENT BRANCH" "git branch --show-current"
Run-Check "LATEST COMMIT" "git log -1 --oneline"
Run-Check "GIT DIFF CHECK" "git diff --check"

Run-Check "TYPESCRIPT BUILD" "npm run build"
Run-Check "COMPLETE CI" "npm run ci"

Section "AVAILABLE NPM SCRIPTS"
node -e "console.log(JSON.stringify(require('./package.json').scripts,null,2))" |
    Out-String |
    Add-Content $report

Section "PRODUCTION FILE CHECKS"

$files = @(
    ".env.example",
    ".github/workflows/ci.yml",
    ".railway/railway.ts",
    "docs/PRODUCTION_READINESS_CHECKLIST.md",
    "docs/RAILWAY_DEPLOYMENT_GUIDE.md",
    "docs/SCHEMA_AND_RESTORE.md",
    "apps/api/src/app.ts",
    "apps/api/src/middleware/http.middleware.ts",
    "apps/indexer/src/main.ts",
    "apps/outbox/src/main.ts"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        "PRESENT: $file" | Add-Content $report
    } else {
        "MISSING: $file" | Add-Content $report
    }
}

Section "ENVIRONMENT VARIABLE NAMES (NO VALUES)"

if (Test-Path ".env") {
    Get-Content ".env" |
        Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } |
        ForEach-Object { ($_ -split '=',2)[0].Trim() } |
        Sort-Object -Unique |
        Add-Content $report
} else {
    "No local .env found" | Add-Content $report
}

Section "POSTGRES / REDIS TOOL AVAILABILITY"

foreach ($tool in @("pg_dump", "pg_restore", "psql", "redis-cli")) {
    $found = Get-Command $tool -ErrorAction SilentlyContinue
    if ($found) {
        "AVAILABLE: $tool" | Add-Content $report
    } else {
        "NOT INSTALLED: $tool" | Add-Content $report
    }
}

Section "PRODUCTION READINESS DOCUMENT"

if (Test-Path "docs/PRODUCTION_READINESS_CHECKLIST.md") {
    Get-Content "docs/PRODUCTION_READINESS_CHECKLIST.md" |
        Add-Content $report
}

Section "AUDIT COMPLETED"
"Report: $report" | Add-Content $report

Write-Host "`nAUDIT COMPLETED" -ForegroundColor Green
Write-Host "Report saved to: $report" -ForegroundColor Cyan
