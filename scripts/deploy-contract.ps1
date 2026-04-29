Write-Host "Starting automated Stellar contract deployment..." -ForegroundColor Cyan

$ContractPath = "contracts\event_attendance"
$WasmPath = "$ContractPath\target\wasm32v1-none\release\event_attendance.wasm"
$EnvPath = ".env.local"
$ConfigPath = "src\config.ts"

Write-Host "Checking Stellar CLI..." -ForegroundColor Yellow

try {
  $stellarVersion = stellar --version
  Write-Host "Stellar CLI found: $stellarVersion" -ForegroundColor Green
} catch {
  Write-Host "Stellar CLI not found. Please install Stellar CLI first." -ForegroundColor Red
  exit 1
}

Write-Host "Adding Stellar Testnet network config..." -ForegroundColor Yellow

stellar network add testnet `
  --rpc-url https://soroban-testnet.stellar.org `
  --network-passphrase "Test SDF Network ; September 2015" 2>$null

Write-Host "Checking deployer identity..." -ForegroundColor Yellow

$identityList = stellar keys ls

if ($identityList -notmatch "deployer") {
  Write-Host "Creating deployer identity..." -ForegroundColor Yellow
  stellar keys generate deployer --network testnet
}

Write-Host "Funding deployer account on Testnet..." -ForegroundColor Yellow
stellar keys fund deployer --network testnet

Write-Host "Adding wasm target if needed..." -ForegroundColor Yellow
rustup target add wasm32v1-none

Write-Host "Building contract..." -ForegroundColor Yellow

Push-Location $ContractPath

cargo build --target wasm32v1-none --release

if ($LASTEXITCODE -ne 0) {
  Write-Host "Contract build failed." -ForegroundColor Red
  Pop-Location
  exit 1
}

Pop-Location

if (!(Test-Path $WasmPath)) {
  Write-Host "WASM file not found: $WasmPath" -ForegroundColor Red
  exit 1
}

Write-Host "Deploying contract to Stellar Testnet..." -ForegroundColor Yellow

$deployOutput = stellar contract deploy `
  --wasm $WasmPath `
  --source-account deployer `
  --network testnet

if ($LASTEXITCODE -ne 0) {
  Write-Host "Contract deploy failed." -ForegroundColor Red
  exit 1
}

$contractId = $deployOutput.Trim()

if ($contractId -notmatch "^C[A-Z0-9]{55}$") {
  Write-Host "Could not detect a valid contract ID from deploy output." -ForegroundColor Red
  Write-Host "Deploy output was:" -ForegroundColor Yellow
  Write-Host $deployOutput
  exit 1
}

Write-Host "Contract deployed successfully." -ForegroundColor Green
Write-Host "Contract ID: $contractId" -ForegroundColor Cyan

Write-Host "Writing contract config to .env.local..." -ForegroundColor Yellow

$envContent = @"
VITE_CONTRACT_ID=$contractId
VITE_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
"@

Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8

Write-Host ".env.local updated successfully." -ForegroundColor Green

Write-Host "Writing contract config to src/config.ts..." -ForegroundColor Yellow

$configContent = @"
export const APP_CONFIG = {
  contractId: "$contractId",
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

export function hasContractConfig() {
  return Boolean(APP_CONFIG.contractId);
}
"@

Set-Content -Path $ConfigPath -Value $configContent -Encoding UTF8

Write-Host "src/config.ts updated successfully." -ForegroundColor Green

Write-Host "Deployment completed." -ForegroundColor Green
Write-Host "Restart npm run dev after deployment so Vite can read the latest config." -ForegroundColor Cyan