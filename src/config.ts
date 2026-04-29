export const APP_CONFIG = {
  contractId: "CDGV3NJ3NF7NTG6GZYXR3YM2ZLSUPXLSMFNQ7ZILNUCNIXFHHW3CWH2H",
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

export function hasContractConfig() {
  return Boolean(APP_CONFIG.contractId);
}
