param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$GlitchlingsCheckout = Join-Path $env:USERPROFILE "primestuff\glitchlings"

if (-not $env:GLITCHLOOM_GLITCHLINGS_PATH -and (Test-Path -LiteralPath $GlitchlingsCheckout)) {
    $env:GLITCHLOOM_GLITCHLINGS_PATH = $GlitchlingsCheckout
}
if (-not $env:GLITCHLOOM_WORKSPACE) {
    $env:GLITCHLOOM_WORKSPACE = Split-Path -Parent $ProjectRoot
}

Push-Location $ProjectRoot
try {
    if (-not $SkipInstall) {
        uv sync --python 3.12
        Push-Location (Join-Path $ProjectRoot "web")
        try {
            npm install
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
