# ─────────────────────────────────────────────────────────────
#  Pulse — Devnet SOL Airdrop Script (Windows PowerShell)
#  Run: .\airdrop-devnet.ps1
# ─────────────────────────────────────────────────────────────

# PASTE YOUR VAULT ADDRESS HERE
$VAULT = "AJi7eoLRt1BjjdV9MDxmXFxpQkR7bMsf8UBNWES7JKYx"

$AMOUNT = 2

$RPC_ENDPOINTS = @(
    "https://api.devnet.solana.com",
    "https://rpc.ankr.com/solana_devnet",
    "https://solana-devnet.g.alchemy.com/v2/demo"
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Pulse Devnet Airdrop Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Target: $VAULT" -ForegroundColor Yellow
Write-Host ""

if (-not (Get-Command solana -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Solana CLI not found. Run: winget install Solana.Solana" -ForegroundColor Red
    exit 1
}

Write-Host "Solana CLI: $(solana --version)" -ForegroundColor Green
Write-Host ""

$successCount = 0

foreach ($rpc in $RPC_ENDPOINTS) {
    Write-Host "Trying RPC: $rpc" -ForegroundColor Gray
    solana config set --url $rpc | Out-Null

    $attempts = 0
    $succeeded = $false

    while ($attempts -lt 3 -and -not $succeeded) {
        $attempts++
        Write-Host "  Attempt $attempts / 3 - requesting $AMOUNT SOL..." -ForegroundColor Gray

        $result = (solana airdrop $AMOUNT $VAULT --url $rpc 2>&1) | Out-String

        if ($result -match "Signature" -or $result -match "SOL") {
            Write-Host "  SUCCESS" -ForegroundColor Green
            Write-Host "  $result" -ForegroundColor Green
            $successCount++
            $succeeded = $true
        } elseif ($result -match "limit" -or $result -match "rate" -or $result -match "429") {
            Write-Host "  Rate limited - moving to next RPC" -ForegroundColor Yellow
            break
        } else {
            Write-Host "  Failed: $result" -ForegroundColor Red
            if ($attempts -lt 3) {
                Write-Host "  Waiting 5s..." -ForegroundColor Gray
                Start-Sleep -Seconds 5
            }
        }
    }

    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  Done. $successCount successful airdrop(s)" -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking balance..." -ForegroundColor Gray
solana balance $VAULT --url https://api.devnet.solana.com

Write-Host ""
Write-Host "Explorer: https://explorer.solana.com/address/$VAULT?cluster=devnet" -ForegroundColor Yellow