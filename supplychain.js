// supplychain.js
import { Lucid, Blockfrost, Constr, Data } from "https://unpkg.com/lucid-cardano@0.10.11/web/mod.js";

// ----------------------------
// CONFIG
// ----------------------------
const BLOCKFROST_URL = "https://cardano-preprod.blockfrost.io/api/v0";
const BLOCKFROST_KEY = "preprodYjRkHfcazNkL0xxG9C2RdUbUoTrG7wip";
const NETWORK = "Preprod";

// ----------------------------
// DATUM
// ----------------------------
const BatchDatum = Data.Object({
  batchHash: Data.Bytes(),
  manufacturer: Data.Bytes(),
  transporter: Data.Bytes(),
  warehouse: Data.Bytes(),
  retailer: Data.Bytes(),
  verifier: Data.Bytes(),
  bondAmount: Data.Integer(),
  state: Data.Integer(), // 0=Created, 1=InTransit, 2=Warehoused, 3=Delivered, 4=Verified, 5=Rejected
});

// ----------------------------
// REDEEMERS
// ----------------------------
const advanceRedeemer = (state) => Data.to(new Constr(state, []));
const finalizeRedeemer = (state) => Data.to(new Constr(state + 10, []));

// ----------------------------
// GLOBAL STATE
// ----------------------------
let lucid;
let walletAddress;
let scriptAddress;
let script; // store script object globally

// ----------------------------
// LOG
// ----------------------------
function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

// ----------------------------
// INIT / CONNECT
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

  // ✅ Replace with your clean CBOR (single-line, hex-only)
  const SCRIPT_CBOR = "590e39010000323232323232332232323232323232323322..."; 
  script = { type: "PlutusV2", script: SCRIPT_CBOR };
  scriptAddress = lucid.utils.validatorToAddress(script);

  log("✅ Wallet connected");
  log("Address: " + walletAddress);
  log("Script: " + scriptAddress);
}

// ----------------------------
// BUILD DATUM
// ----------------------------
function mkBatchDatum(batchHash, transporter, warehouse, retailer, verifier, bond) {
  const manufacturer = lucid.utils.getAddressDetails(walletAddress).paymentCredential.hash;
  return Data.to({
    batchHash,
    manufacturer,
    transporter,
    warehouse,
    retailer,
    verifier,
    bondAmount: BigInt(bond) * 1_000_000n,
    state: 0,
  }, BatchDatum);
}

// ----------------------------
// CREATE BATCH
// ----------------------------
export async function createBatch() {
  try {
    const batchHash = document.getElementById("batchHash").value;
    const bond = Number(document.getElementById("bond").value);
    const transporter = document.getElementById("transporter").value;
    const warehouse = document.getElementById("warehouse").value;
    const retailer = document.getElementById("retailer").value;
    const verifier = document.getElementById("verifier").value;

    const datum = mkBatchDatum(batchHash, transporter, warehouse, retailer, verifier, bond);

    const tx = await lucid.newTx()
      .payToContract(scriptAddress, { inline: datum }, { lovelace: BigInt(bond) * 1_000_000n })
      .addSignerKey(lucid.utils.getAddressDetails(walletAddress).paymentCredential.hash)
      .complete();

    const signed = await tx.sign().complete();
    const txHash = await signed.submit();

    log("🚀 Batch created: " + txHash);
  } catch (e) {
    log("❌ " + e.message);
  }
}

// ----------------------------
// ADVANCE STATE
// ----------------------------
async function advanceState(state) {
  try {
    const utxos = await lucid.utxosAt(scriptAddress);
    const utxo = utxos[0];
    if (!utxo) return log("No batch found");

    const tx = await lucid.newTx()
      .collectFrom([utxo], advanceRedeemer(state))
      .attachSpendingValidator(script)
      .complete();

    const signed = await tx.sign().complete();
    const txHash = await signed.submit();
    log(`➡️ Batch advanced to state ${state} Tx: ${txHash}`);
  } catch (e) {
    log("❌ " + e.message);
  }
}

// ----------------------------
// FINALIZE / VERIFY
// ----------------------------
async function finalizeBatch(state) {
  try {
    const utxos = await lucid.utxosAt(scriptAddress);
    const utxo = utxos[0];
    if (!utxo) return log("No batch found");

    const tx = await lucid.newTx()
      .collectFrom([utxo], finalizeRedeemer(state))
      .attachSpendingValidator(script)
      .complete();

    const signed = await tx.sign().complete();
    const txHash = await signed.submit();
    log(`✅ Batch finalized to state ${state} Tx: ${txHash}`);
  } catch (e) {
    log("❌ " + e.message);
  }
}

// ----------------------------
// BUTTONS
// ----------------------------
document.getElementById("connect").onclick = init;
document.getElementById("create").onclick = createBatch;
document.getElementById("toTransit").onclick = () => advanceState(1);
document.getElementById("toWarehouse").onclick = () => advanceState(2);
document.getElementById("toDelivered").onclick = () => advanceState(3);
document.getElementById("verify").onclick = () => finalizeBatch(4);
document.getElementById("reject").onclick = () => finalizeBatch(5);
