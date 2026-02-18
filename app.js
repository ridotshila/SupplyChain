{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module SupplyChain where

import Prelude (IO, String, putStrLn, FilePath, (<>))
import qualified Prelude as P
import qualified Data.Text as T

import Plutus.V2.Ledger.Api
import Plutus.V2.Ledger.Contexts
import Plutus.V1.Ledger.Value (valueOf, adaSymbol, adaToken)

import PlutusTx
import PlutusTx.Prelude hiding (Semigroup(..), unless)

import qualified Codec.Serialise as Serialise
import qualified Data.ByteString.Lazy as LBS
import qualified Data.ByteString.Short as SBS
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16

import qualified Cardano.Api as C
import qualified Cardano.Api.Shelley as CS

-------------------------------------------------
-- SUPPLY CHAIN STATES
-------------------------------------------------

data BatchState
  = Created
  | InTransit
  | Warehoused
  | Delivered
  | Verified
  | Rejected
PlutusTx.unstableMakeIsData ''BatchState

-------------------------------------------------
-- DATUM
-------------------------------------------------

data SupplyDatum = SupplyDatum
  { sdBatchHash    :: BuiltinByteString
  , sdManufacturer :: PubKeyHash
  , sdTransporter  :: PubKeyHash
  , sdWarehouse    :: PubKeyHash
  , sdRetailer     :: PubKeyHash
  , sdVerifier     :: PubKeyHash
  , sdBondAmount   :: Integer
  , sdState        :: BatchState
  }
PlutusTx.unstableMakeIsData ''SupplyDatum

-------------------------------------------------
-- REDEEMER
-------------------------------------------------

data SupplyAction = Advance BatchState
PlutusTx.unstableMakeIsData ''SupplyAction

-------------------------------------------------
-- HELPERS
-------------------------------------------------

{-# INLINABLE signedBy #-}
signedBy :: PubKeyHash -> ScriptContext -> Bool
signedBy pkh ctx = txSignedBy (scriptContextTxInfo ctx) pkh

{-# INLINABLE validTransition #-}
validTransition :: BatchState -> BatchState -> Bool
validTransition from to = case (from, to) of
  (Created, InTransit)      -> True
  (InTransit, Warehoused)   -> True
  (Warehoused, Delivered)   -> True
  (Delivered, Verified)     -> True
  (Delivered, Rejected)     -> True
  _                         -> False

{-# INLINABLE authorized #-}
authorized :: SupplyDatum -> BatchState -> ScriptContext -> Bool
authorized dat next = case next of
  InTransit   -> signedBy (sdTransporter dat)
  Warehoused  -> signedBy (sdWarehouse dat)
  Delivered   -> signedBy (sdRetailer dat)
  Verified    -> signedBy (sdVerifier dat)
  Rejected    -> signedBy (sdVerifier dat)
  _           -> const False

-------------------------------------------------
-- VALIDATOR
-------------------------------------------------

{-# INLINABLE mkSupplyValidator #-}
mkSupplyValidator :: SupplyDatum -> SupplyAction -> ScriptContext -> Bool
mkSupplyValidator dat action ctx =
  case action of
    Advance newState ->
      traceIfFalse "invalid state transition" transitionOK &&
      traceIfFalse "unauthorized signer" signerOK &&
      traceIfFalse "bond handling invalid" bondOK
  where
    info :: TxInfo
    info = scriptContextTxInfo ctx

    transitionOK :: Bool
    transitionOK = validTransition (sdState dat) newState

    signerOK :: Bool
    signerOK = authorized dat newState ctx

    bondOK :: Bool
    bondOK = case newState of
      Verified -> valueOf (valuePaidTo info (sdManufacturer dat)) adaSymbol adaToken >= sdBondAmount dat
      Rejected -> valueOf (valuePaidTo info (sdVerifier dat)) adaSymbol adaToken >= sdBondAmount dat
      _        -> case findOwnInput ctx of
                    Nothing -> traceError "no script input"
                    Just i  -> valueOf (txOutValue $ txInInfoResolved i) adaSymbol adaToken >= sdBondAmount dat

-------------------------------------------------
-- UNTYPED WRAPPER
-------------------------------------------------

{-# INLINABLE mkValidatorUntyped #-}
mkValidatorUntyped :: BuiltinData -> BuiltinData -> BuiltinData -> ()
mkValidatorUntyped d r c =
  if mkSupplyValidator
       (unsafeFromBuiltinData d)
       (unsafeFromBuiltinData r)
       (unsafeFromBuiltinData c)
  then ()
  else error ()

validator :: Validator
validator = mkValidatorScript $$(PlutusTx.compile [|| mkValidatorUntyped ||])

-------------------------------------------------
-- HASH & ADDRESS (ON-CHAIN)
-------------------------------------------------

plutusValidatorHash :: Validator -> ValidatorHash
plutusValidatorHash val =
  let bytes = Serialise.serialise val
      short = SBS.toShort (LBS.toStrict bytes)
  in ValidatorHash (toBuiltin (SBS.fromShort short))

plutusScriptAddress :: Address
plutusScriptAddress = Address (ScriptCredential (plutusValidatorHash validator)) Nothing

-------------------------------------------------
-- BECH32 ADDRESS (OFF-CHAIN)
-------------------------------------------------

toBech32ScriptAddress :: C.NetworkId -> Validator -> String
toBech32ScriptAddress network val =
  let serialised = SBS.toShort . LBS.toStrict $ Serialise.serialise val
      plutusScript :: CS.PlutusScript CS.PlutusScriptV2
      plutusScript = CS.PlutusScriptSerialised serialised
      scriptHash = CS.hashScript (CS.PlutusScript CS.PlutusScriptV2 plutusScript)
      addr :: CS.AddressInEra CS.BabbageEra
      addr = CS.makeShelleyAddressInEra network (CS.PaymentCredentialByScript scriptHash) CS.NoStakeAddress
  in T.unpack (CS.serialiseAddress addr)

-------------------------------------------------
-- FILE OUTPUT
-------------------------------------------------

writeValidator :: FilePath -> Validator -> IO ()
writeValidator path val = do
  LBS.writeFile path (Serialise.serialise val)
  putStrLn $ "Validator written to: " <> path

writeCBOR :: FilePath -> Validator -> IO ()
writeCBOR path val = do
  let bytes = LBS.toStrict $ Serialise.serialise val
  BS.writeFile path (B16.encode bytes)
  putStrLn $ "CBOR hex written to: " <> path

-------------------------------------------------
-- MAIN
-------------------------------------------------

main :: IO ()
main = do
  let network = C.Testnet (C.NetworkMagic 1)
  writeValidator "supply_chain.plutus" validator
  writeCBOR "supply_chain.cbor" validator
  let addr = toBech32ScriptAddress network validator
  putStrLn "\n--- Supply Chain Provenance (ADA-only) ---"
  putStrLn $ "Bech32 Address: " <> addr
  putStrLn "----------------------------------------"
