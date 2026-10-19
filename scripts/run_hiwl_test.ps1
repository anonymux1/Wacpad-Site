<#
.SYNOPSIS
    WacPad Dual-Rail HIWL (Human/Hardware-In-The-Loop) Test Suite Launcher
.DESCRIPTION
    Provides an interactive menu to run either Approach 1 (Interactive Browser Mode)
    or Approach 2 (Automated Playwright Driver) across Razorpay & Dodo Payments.
#>

param(
    [string]$Mode = ""
)

$ErrorActionPreference = "Stop"
$appDataDir = "$env:APPDATA\mohnishk\WacPad\data"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$siteDir = "F:\Dev\wacpad-site"
$distExe = "$repoRoot\dist\WacPad.exe"

function Clean-ActivationData {
    Write-Host "[*] Resetting local activation cache to Free tier..." -ForegroundColor Gray
    if (Test-Path "$appDataDir\activation.token") { Remove-Item "$appDataDir\activation.token" -Force }
    if (Test-Path "$appDataDir\activation_grace.json") { Remove-Item "$appDataDir\activation_grace.json" -Force }
    if (Test-Path "$appDataDir\license.key") { Remove-Item "$appDataDir\license.key" -Force }
}

function Ensure-WacPadHostRunning {
    $running = Get-Process -Name "wacpad" -ErrorAction SilentlyContinue
    if (-not $running -and (Test-Path $distExe)) {
        Write-Host "[+] Launching WacPad desktop host in background (port 8765)..." -ForegroundColor Cyan
        Start-Process -FilePath $distExe -ArgumentList "--debug-session-timer" -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }
}

Clean-ActivationData
Ensure-WacPadHostRunning

if (-not $Mode) {
    Clear-Host
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "   WacPad Dual-Rail HIWL End-to-End Monetization Test Suite   " -ForegroundColor Cyan
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  APPROACH 1: Interactive Browser Mode (HITL - 5s human action):" -ForegroundColor White
    Write-Host "    [1] Razorpay Sandbox (India ₹1,299 Netbanking/UPI)" -ForegroundColor Yellow
    Write-Host "    [2] Dodo Payments Sandbox (Global $14.99 MoR Card)" -ForegroundColor Yellow
    Write-Host "    [3] Both Rails Consecutively (Full Interactive Suite)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  APPROACH 2: Automated Playwright Driver (100% Headless):" -ForegroundColor White
    Write-Host "    [4] Razorpay Headless Automated Flow" -ForegroundColor Green
    Write-Host "    [5] Dodo Payments Headless Automated Flow" -ForegroundColor Green
    Write-Host "    [6] Full Headless Suite (Both Rails Hands-Free)" -ForegroundColor Green
    Write-Host "    [7] Full Suite with Headed/Visible Browser (Watch it click!)" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "    [8] Exit" -ForegroundColor DarkGray
    Write-Host ""
    $choice = Read-Host "Select an option [1-8]"
} else {
    $choice = $Mode
}

Push-Location $siteDir
try {
    switch ($choice) {
        "1" { npm run test:hiwl:razorpay }
        "2" { npm run test:hiwl:dodo }
        "3" { npm run test:hiwl }
        "4" { node test/hiwl/run_playwright.js --rail razorpay }
        "5" { node test/hiwl/run_playwright.js --rail dodo }
        "6" { npm run test:hiwl:playwright }
        "7" { npm run test:hiwl:playwright:headed }
        "8" { Write-Host "Exiting." -ForegroundColor Gray; exit 0 }
        default { Write-Host "Invalid selection." -ForegroundColor Red }
    }
} finally {
    Pop-Location
}
