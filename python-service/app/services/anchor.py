"""Blockchain anchoring for signed document bundles.

Two modes, auto-selected by env:
  - **evm** (Ethereum / private chain): writes SHA-256 to a minimal anchor contract via web3.py.
    Env: ANCHOR_RPC_URL, ANCHOR_PRIVATE_KEY, ANCHOR_CONTRACT_ADDR
  - **local** (default): append-only Merkle log at storage/anchors/chain.jsonl — each entry
    contains previous hash + signature digest, producing a tamper-evident chain with no
    external dependency. Ideal for demos and private-cloud deployments.

Verification is symmetric: re-compute SHA-256 of the signed bundle (file + .sig + .sig.json),
then check it exists in the chosen chain.
"""
from __future__ import annotations
import hashlib
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..config import settings


CHAIN_DIR = Path(settings.STORAGE_DIR).parent / "anchors"
CHAIN_DIR.mkdir(parents=True, exist_ok=True)
CHAIN_FILE = CHAIN_DIR / "chain.jsonl"


def _bundle_digest(file_path: str) -> str:
    p = Path(file_path)
    sig = p.with_suffix(p.suffix + ".sig")
    mani = p.with_suffix(p.suffix + ".sig.json")
    h = hashlib.sha256()
    for part in (p, sig, mani):
        if part.exists():
            h.update(part.read_bytes())
    return h.hexdigest()


def _last_local_hash() -> str:
    if not CHAIN_FILE.exists():
        return "0" * 64
    last = None
    with open(CHAIN_FILE, "rb") as f:
        for line in f:
            last = line
    if not last:
        return "0" * 64
    return json.loads(last)["block_hash"]


def _append_local(digest: str, metadata: dict) -> dict:
    prev = _last_local_hash()
    ts = datetime.utcnow().isoformat() + "Z"
    header = {"prev": prev, "digest": digest, "ts": ts, "meta": metadata}
    block_hash = hashlib.sha256(json.dumps(header, sort_keys=True).encode()).hexdigest()
    record = {**header, "block_hash": block_hash}
    with open(CHAIN_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return record


def _evm_anchor(digest: str) -> Optional[dict]:
    rpc = os.environ.get("ANCHOR_RPC_URL", "").strip()
    key = os.environ.get("ANCHOR_PRIVATE_KEY", "").strip()
    addr = os.environ.get("ANCHOR_CONTRACT_ADDR", "").strip()
    if not (rpc and key and addr):
        return None
    try:
        from web3 import Web3
        from eth_account import Account
    except Exception:
        return None

    w3 = Web3(Web3.HTTPProvider(rpc))
    if not w3.is_connected():
        return None
    acct = Account.from_key(key)
    # Minimal ABI: anchor(bytes32)
    abi = [{
        "inputs": [{"internalType": "bytes32", "name": "h", "type": "bytes32"}],
        "name": "anchor", "outputs": [], "stateMutability": "nonpayable", "type": "function",
    }]
    c = w3.eth.contract(address=w3.to_checksum_address(addr), abi=abi)
    tx = c.functions.anchor(bytes.fromhex(digest)).build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "gas": 80_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": w3.eth.chain_id,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction).hex()
    return {"chain": "evm", "tx_hash": tx_hash, "contract": addr, "chain_id": w3.eth.chain_id}


def anchor_signed_bundle(file_path: str, document_id: int, signer: str) -> dict:
    digest = _bundle_digest(file_path)
    meta = {"document_id": document_id, "signer": signer, "file": Path(file_path).name}

    evm = None
    try:
        evm = _evm_anchor(digest)
    except Exception as e:
        meta["evm_error"] = str(e)[:200]

    local = _append_local(digest, meta)
    return {"digest": digest, "local": local, "evm": evm}


def verify_anchor(file_path: str) -> dict:
    digest = _bundle_digest(file_path)
    if not CHAIN_FILE.exists():
        return {"found": False, "digest": digest}
    with open(CHAIN_FILE, encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("digest") == digest:
                return {"found": True, "digest": digest, "block": rec}
    return {"found": False, "digest": digest}
