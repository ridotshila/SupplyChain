// guestbook.js
import { Lucid, Blockfrost, Data } from "https://unpkg.com/lucid-cardano@0.10.11/web/mod.js";

// ----------------------------
// CONFIG
// ----------------------------
const BLOCKFROST_URL = "https://cardano-preprod.blockfrost.io/api/v0";
const BLOCKFROST_KEY = "preprodYjRkHfcazNkL0xxG9C2RdUbUoTrG7wip";
const NETWORK = "Preprod";

// ----------------------------
// DATUM
// ----------------------------
const GuestDatum = Data.Object({
  author: Data.Bytes(),   // wallet PKH
  message: Data.Bytes(),  // message as bytes
});

// ----------------------------
// GLOBAL STATE
// ----------------------------
let lucid;
let walletAddress;
let walletPKH;
let scriptAddress;
let script;

// ----------------------------
// LOG FUNCTION
// ----------------------------
function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

// ----------------------------
// INIT / CONNECT WALLET
// ----------------------------
export async function init() {
  if (!window.cardano?.lace) {
    alert("Lace wallet not found");
    return;
  }

  lucid = await Lucid.new(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  const api = await window.cardano.lace.enable();
  lucid.selectWallet(api);

  walletAddress = await lucid.wallet.address();
  walletPKH = lucid.utils.getAddressDetails(walletAddress).paymentCredential.hash;

  // Replace with your CBOR script (hex)
  const SCRIPT_CBOR = "590e39010000323232323232332232..."; // your full CBOR here
  script = { type: "PlutusV2", script: SCRIPT_CBOR };
  scriptAddress = lucid.utils.validatorToAddress(script);

  log("✅ Wallet connected");
  log("Address: " + walletAddress);
  log("Script: " + scriptAddress);
}

// ----------------------------
// CREATE DATUM
// ----------------------------
function mkGuestDatum(message) {
  const encoder = new TextEncoder();
  return Data.to({
    author: walletPKH,
    message: encoder.encode(message), // convert string -> bytes
  }, GuestDatum);
}

// ----------------------------
// SUBMIT MESSAGE
// ----------------------------
export async function submitMessage() {
  try {
    const message = document.getElementById("message").value.trim();
    if (!message) return log("❌ Message cannot be empty");

    const datum = mkGuestDatum(message);

    const tx = await lucid.newTx()
      .payToContract(scriptAddress, { inline: datum }, { lovelace: 1_000_000n }) // 1 ADA minimum
      .complete();

    const signed = await tx.sign().complete();
    const txHash = await signed.submit();

    log("✅ Message submitted! TxHash: " + txHash);
    document.getElementById("message").value = "";
  } catch (e) {
    log("❌ " + e.message);
  }
}

// ----------------------------
// BUTTONS
// ----------------------------
document.getElementById("connect").onclick = init;
document.getElementById("submit").onclick = submitMessage;
