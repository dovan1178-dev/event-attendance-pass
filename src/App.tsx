import { useEffect, useState } from "react";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Memo,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit-tech/stellar-wallets-kit/modules/utils";
import { APP_CONFIG, hasContractConfig } from "./config";
import "./App.css";

type TxStatus = "idle" | "pending" | "success" | "fail";

const HORIZON_URL = APP_CONFIG.horizonUrl;
const RPC_URL = APP_CONFIG.rpcUrl;
const NETWORK_PASSPHRASE = APP_CONFIG.networkPassphrase || Networks.TESTNET;

const EVENT_ID = "WORKSHOP";
const EVENT_FEE_XLM = "5";

const ORGANIZER_PUBLIC_KEY =
  "GA5SH5Q6GUB5J3TNQ55I3B7FEOQJQTRJRD3OKNYRGEE323U3BYGLVAQO";

function App() {
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [message, setMessage] = useState("");
  const [paymentTxHash, setPaymentTxHash] = useState("");
  const [contractTxHash, setContractTxHash] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [isCheckedIn, setIsCheckedIn] = useState(false);

  useEffect(() => {
    StellarWalletsKit.init({
      modules: defaultModules(),
    });
  }, []);

  async function connectWallet() {
    try {
      setStatus("pending");
      setMessage("Opening Stellar Wallet Kit...");
      setPaymentTxHash("");
      setContractTxHash("");

      const result = await StellarWalletsKit.authModal();

      if (!result.address) {
        setStatus("fail");
        setMessage("Wallet address not found.");
        return;
      }

      setPublicKey(result.address);
      setStatus("success");
      setMessage("Wallet connected successfully.");
    } catch (error) {
      console.error("Wallet connection error:", error);
      setStatus("fail");
      setMessage("Wallet connection failed, rejected, or modal was closed.");
    }
  }

  async function disconnectWallet() {
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      // Some Wallet Kit versions may not fully clear the session.
    }

    setPublicKey("");
    setStatus("idle");
    setMessage("Wallet disconnected.");
    setPaymentTxHash("");
    setContractTxHash("");
    setIsRegistered(false);
    setIsCheckedIn(false);
  }

  async function getWalletAddress() {
    if (publicKey) {
      return publicKey;
    }

    try {
      const { address } = await StellarWalletsKit.getAddress();

      if (!address) {
        setStatus("fail");
        setMessage("Please connect wallet first.");
        return null;
      }

      setPublicKey(address);
      return address;
    } catch {
      setStatus("fail");
      setMessage("Wallet not found, rejected, or not connected.");
      return null;
    }
  }

  async function checkXlmBalance(address: string) {
    const server = new Horizon.Server(HORIZON_URL);
    const account = await server.loadAccount(address);

    const nativeBalance = account.balances.find(
      (balance) => balance.asset_type === "native"
    );

    return nativeBalance ? Number(nativeBalance.balance) : 0;
  }

  async function signWithWallet(xdr: string, address: string) {
    const signedResult = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address,
    });

    if (!signedResult.signedTxXdr) {
      throw new Error("Wallet did not return signed transaction XDR.");
    }

    return signedResult.signedTxXdr;
  }

  async function submitPaymentTransaction(address: string) {
    const horizonServer = new Horizon.Server(HORIZON_URL);
    const sourceAccount = await horizonServer.loadAccount(address);

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: ORGANIZER_PUBLIC_KEY,
          asset: Asset.native(),
          amount: EVENT_FEE_XLM,
        })
      )
      .addMemo(Memo.text(EVENT_ID))
      .setTimeout(60)
      .build();

    setMessage("Step 1/2: Please confirm the 5 XLM event payment...");

    const signedTxXdr = await signWithWallet(transaction.toXDR(), address);

    const signedTransaction = TransactionBuilder.fromXDR(
      signedTxXdr,
      NETWORK_PASSPHRASE
    ) as Transaction;

    setMessage("Submitting payment transaction to Stellar Testnet...");

    const result = await horizonServer.submitTransaction(signedTransaction);

    return result.hash;
  }

  async function waitForContractTransaction(
    rpcServer: rpc.Server,
    txHash: string
  ) {
    for (let i = 0; i < 15; i++) {
      try {
        const response = await rpcServer.getTransaction(txHash);

        if (response.status === "SUCCESS") {
          return "SUCCESS";
        }

        if (response.status === "FAILED") {
          throw new Error("Contract transaction failed on-chain.");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.warn("RPC polling warning:", errorMessage);

        if (errorMessage.includes("Bad union switch")) {
          return "SUBMITTED_BUT_RPC_PARSE_WARNING";
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return "SUBMITTED_BUT_NOT_CONFIRMED_YET";
  }

  async function callAttendanceContract(
    functionName: "register" | "check_in",
    address: string
  ) {
    if (!hasContractConfig()) {
      throw new Error(
        "Missing contract ID. Please deploy contract and ensure src/config.ts is updated."
      );
    }

    const rpcServer = new rpc.Server(RPC_URL, {
      allowHttp: RPC_URL.startsWith("http://"),
    });

    const sourceAccount = await rpcServer.getAccount(address);
    const contract = new Contract(APP_CONFIG.contractId);

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          functionName,
          new Address(address).toScVal(),
          nativeToScVal(EVENT_ID, { type: "symbol" })
        )
      )
      .setTimeout(60)
      .build();

    setMessage(`Preparing contract call: ${functionName}...`);

    const preparedTransaction = await rpcServer.prepareTransaction(transaction);

    setMessage(`Step 2/2: Please confirm contract call: ${functionName}...`);

    const signedTxXdr = await signWithWallet(
      preparedTransaction.toXDR(),
      address
    );

    const signedTransaction = TransactionBuilder.fromXDR(
      signedTxXdr,
      NETWORK_PASSPHRASE
    ) as Transaction;

    setMessage(`Submitting contract call: ${functionName}...`);

    const sendResponse = await rpcServer.sendTransaction(signedTransaction);

    if (sendResponse.status === "ERROR") {
      console.error("RPC sendTransaction error:", sendResponse);
      throw new Error("RPC returned ERROR when submitting contract transaction.");
    }

    const confirmationStatus = await waitForContractTransaction(
      rpcServer,
      sendResponse.hash
    );

    return {
      hash: sendResponse.hash,
      confirmationStatus,
    };
  }

  async function registerEvent() {
    const address = await getWalletAddress();

    if (!address) {
      return;
    }

    if (address === ORGANIZER_PUBLIC_KEY) {
      setStatus("fail");
      setMessage(
        "Please use a member wallet to register. Organizer wallet should only receive event fees."
      );
      return;
    }

    try {
      setStatus("pending");
      setMessage("Checking wallet balance...");
      setPaymentTxHash("");
      setContractTxHash("");

      const xlmBalance = await checkXlmBalance(address);

      if (xlmBalance < Number(EVENT_FEE_XLM) + 0.1) {
        setStatus("fail");
        setMessage(
          "Insufficient balance. Please make sure your Testnet wallet has enough XLM for the 5 XLM fee and transaction costs."
        );
        return;
      }

      const paymentHash = await submitPaymentTransaction(address);

      setPaymentTxHash(paymentHash);
      setMessage("Payment confirmed. Now registering wallet on smart contract...");

      const registerResult = await callAttendanceContract("register", address);

      setContractTxHash(registerResult.hash);
      setIsRegistered(true);
      setStatus("success");

      if (registerResult.confirmationStatus === "SUCCESS") {
        setMessage(
          "Registered successfully. Payment and contract registration are both confirmed."
        );
      } else {
        setMessage(
          "Registration transaction was submitted. RPC could not fully parse confirmation, but the contract tx hash is available for Stellar Explorer verification."
        );
      }
    } catch (error) {
      console.error("Register flow error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatus("fail");
      setMessage(`Register failed: ${errorMessage}`);
    }
  }

  async function checkInEvent() {
    const address = await getWalletAddress();

    if (!address) {
      return;
    }

    if (!isRegistered) {
      setStatus("fail");
      setMessage("Please pay and register before checking in.");
      return;
    }

    if (isCheckedIn) {
      setStatus("fail");
      setMessage("You have already checked in for this event.");
      return;
    }

    try {
      setStatus("pending");
      setMessage("Preparing check-in...");
      setContractTxHash("");

      const checkInResult = await callAttendanceContract("check_in", address);

      setContractTxHash(checkInResult.hash);
      setIsCheckedIn(true);
      setStatus("success");

      if (checkInResult.confirmationStatus === "SUCCESS") {
        setMessage("Check-in successful. Attendance was recorded on-chain.");
      } else {
        setMessage(
          "Check-in transaction was submitted. RPC could not fully parse confirmation, but the tx hash is available for Stellar Explorer verification."
        );
      }
    } catch (error) {
      console.error("Check-in flow error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatus("fail");
      setMessage(`Check-in failed: ${errorMessage}`);
    }
  }

  return (
    <main className="app">
      <section className="card">
        <p className="tag">Stellar Testnet dApp · Level 2</p>

        <h1>Stellar Event Attendance Pass</h1>

        <p className="desc">
          A paid event registration and attendance check-in system built on
          Stellar. Members can register for an event and verify attendance using
          a Stellar wallet.
        </p>

        <div className="eventBox">
          <h2>Stellar Builder Workshop</h2>

          <p>
            <strong>Participation Fee:</strong> {EVENT_FEE_XLM} XLM
          </p>

          <p>
            <strong>Event ID:</strong> {EVENT_ID}
          </p>

          <p>
            <strong>Network:</strong> Stellar Testnet
          </p>

          <p>
            <strong>Organizer Wallet:</strong>
          </p>

          <p>{ORGANIZER_PUBLIC_KEY}</p>

          <p>
            <strong>Contract ID:</strong>
          </p>

          <p>
            {hasContractConfig()
              ? APP_CONFIG.contractId
              : "No contract ID found. Please deploy contract first."}
          </p>
        </div>

        <div className="walletPanel">
          <h3>Wallet Connection</h3>

          <p>
            Use Stellar Wallet Kit to choose Freighter, Albedo, xBull, Rabet,
            LOBSTR, or another supported wallet.
          </p>

          {!publicKey ? (
            <button className="primaryBtn" onClick={connectWallet}>
              Connect Wallet
            </button>
          ) : (
            <>
              <div className="connectedBox">
                <p>
                  <strong>Connected Address:</strong>
                </p>
                <p>{publicKey}</p>
              </div>

              <button className="disconnectBtn" onClick={disconnectWallet}>
                Disconnect Wallet
              </button>
            </>
          )}
        </div>

        <div className="eventBox">
          <h2>Event Status</h2>

          <p>
            <strong>Registration:</strong>{" "}
            {isRegistered ? "Registered" : "Not registered"}
          </p>

          <p>
            <strong>Attendance:</strong>{" "}
            {isCheckedIn ? "Checked in" : "Not checked in"}
          </p>
        </div>

        <div className="actions">
          <button onClick={registerEvent}>Pay & Register</button>
          <button onClick={checkInEvent}>Check In</button>
        </div>

        <div className={`statusBox ${status}`}>
          <strong>Transaction Status:</strong> {status}
        </div>

        {message && <p className="message">{message}</p>}

        {paymentTxHash && (
          <p className="txHash">
            <strong>Payment Tx Hash:</strong> <span>{paymentTxHash}</span>
          </p>
        )}

        {contractTxHash && (
          <p className="txHash">
            <strong>Contract Tx Hash:</strong> <span>{contractTxHash}</span>
          </p>
        )}
      </section>
    </main>
  );
}

export default App;