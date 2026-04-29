Write-Host "Setting up automated Stellar contract system..." -ForegroundColor Cyan

# Create folders
New-Item -ItemType Directory -Force -Path "contracts\event_attendance\src" | Out-Null
New-Item -ItemType Directory -Force -Path "scripts" | Out-Null

Write-Host "Writing contracts/event_attendance/Cargo.toml..." -ForegroundColor Yellow

$cargoToml = @'
[package]
name = "event_attendance"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "25.0.0"

[dev_dependencies]
soroban-sdk = { version = "25.0.0", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
'@

Set-Content -Path "contracts\event_attendance\Cargo.toml" -Value $cargoToml -Encoding UTF8

Write-Host "Writing contracts/event_attendance/src/lib.rs..." -ForegroundColor Yellow

$contractCode = @'
#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

#[contract]
pub struct EventAttendanceContract;

#[contractimpl]
impl EventAttendanceContract {
    pub fn register(env: Env, user: Address, event_id: Symbol) -> bool {
        user.require_auth();

        let key = (symbol_short!("REG"), event_id.clone(), user.clone());

        if env.storage().persistent().has(&key) {
            panic!("Already registered");
        }

        env.storage().persistent().set(&key, &true);

        env.events().publish(
            (symbol_short!("register"), event_id, user),
            true,
        );

        true
    }

    pub fn check_in(env: Env, user: Address, event_id: Symbol) -> bool {
        user.require_auth();

        let reg_key = (symbol_short!("REG"), event_id.clone(), user.clone());
        let check_key = (symbol_short!("CHECK"), event_id.clone(), user.clone());

        if !env.storage().persistent().has(&reg_key) {
            panic!("User not registered");
        }

        if env.storage().persistent().has(&check_key) {
            panic!("Already checked in");
        }

        env.storage().persistent().set(&check_key, &true);

        env.events().publish(
            (symbol_short!("checkin"), event_id, user),
            true,
        );

        true
    }

    pub fn is_registered(env: Env, user: Address, event_id: Symbol) -> bool {
        let key = (symbol_short!("REG"), event_id, user);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    pub fn has_checked_in(env: Env, user: Address, event_id: Symbol) -> bool {
        let key = (symbol_short!("CHECK"), event_id, user);
        env.storage().persistent().get(&key).unwrap_or(false)
    }
}
'@

Set-Content -Path "contracts\event_attendance\src\lib.rs" -Value $contractCode -Encoding UTF8

Write-Host "Writing scripts/deploy-contract.ps1..." -ForegroundColor Yellow

$deployScript = @'
Write-Host "Starting automated Stellar contract deployment..." -ForegroundColor Cyan

$ContractPath = "contracts\event_attendance"
$WasmPath = "$ContractPath\target\wasm32v1-none\release\event_attendance.wasm"
$EnvPath = ".env.local"

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
Write-Host "Deployment completed." -ForegroundColor Green
Write-Host "Restart npm run dev after deployment so Vite can read the new .env.local values." -ForegroundColor Cyan
'@

Set-Content -Path "scripts\deploy-contract.ps1" -Value $deployScript -Encoding UTF8

Write-Host "Writing src/config.ts..." -ForegroundColor Yellow

$configTs = @'
export const APP_CONFIG = {
  contractId: import.meta.env.VITE_CONTRACT_ID || "",
  network: import.meta.env.VITE_NETWORK || "testnet",
  rpcUrl:
    import.meta.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org",
  horizonUrl:
    import.meta.env.VITE_HORIZON_URL || "https://horizon-testnet.stellar.org",
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015",
};

export function hasContractConfig() {
  return Boolean(APP_CONFIG.contractId);
}
'@

Set-Content -Path "src\config.ts" -Value $configTs -Encoding UTF8

Write-Host "Creating default .env.local..." -ForegroundColor Yellow

if (!(Test-Path ".env.local")) {
  $defaultEnv = @"
VITE_CONTRACT_ID=
VITE_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
"@

  Set-Content -Path ".env.local" -Value $defaultEnv -Encoding UTF8
}

Write-Host "Updating .gitignore..." -ForegroundColor Yellow

if (!(Test-Path ".gitignore")) {
  New-Item -ItemType File -Path ".gitignore" | Out-Null
}

$gitignoreContent = Get-Content ".gitignore" -Raw

if ($gitignoreContent -notmatch "\.env\.local") {
  Add-Content -Path ".gitignore" -Value "`n.env.local"
}

Write-Host "Contract system setup completed." -ForegroundColor Green
Write-Host "Next command:" -ForegroundColor Cyan
Write-Host "powershell -ExecutionPolicy Bypass -File .\scripts\deploy-contract.ps1" -ForegroundColor Cyan