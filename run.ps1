param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvironmentFile = Join-Path $ProjectRoot ".env"

if (Test-Path -LiteralPath $EnvironmentFile) {
    foreach ($Line in Get-Content -LiteralPath $EnvironmentFile) {
        if ($Line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            continue
        }
        $Name = $Matches[1]
        $Value = $Matches[2]
        if (
            $Value.Length -ge 2 -and
            (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
             ($Value.StartsWith("'") -and $Value.EndsWith("'")))
        ) {
            $Value = $Value.Substring(1, $Value.Length - 2)
        }
        if (-not (Test-Path -LiteralPath "Env:$Name")) {
            Set-Item -LiteralPath "Env:$Name" -Value $Value
        }
    }
}
if (-not $env:GLITCHLOOM_WORKSPACE) {
    $env:GLITCHLOOM_WORKSPACE = $ProjectRoot
}

Push-Location $ProjectRoot
try {
    if (-not $SkipInstall) {
        uv sync --python 3.12
        Push-Location (Join-Path $ProjectRoot "web")
        try {
            npm ci
            npm run build
        }
        finally {
            Pop-Location
        }
    }
    uv run --python 3.12 glitchloom
}
finally {
    Pop-Location
}
