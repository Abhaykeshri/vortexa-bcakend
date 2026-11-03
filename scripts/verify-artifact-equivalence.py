import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = Path(
    os.environ.get(
        "VORTEXA_SOLIDITY_ARTIFACT_ZIP",
        ROOT.parent / "vortexa-core-smrtcontract" / "vortexa-abis.zip",
    )
)


def environment() -> dict[str, str]:
    values = dict(os.environ)
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip("'\""))
    return values


def rpc_code(url: str, address: str, request_id: int) -> str:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": request_id, "method": "eth_getCode", "params": [address, "latest"]}
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json", "user-agent": "vortexa-artifact-verifier/1.0"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
    if "error" in result or not isinstance(result.get("result"), str):
        raise RuntimeError("RPC bytecode request failed")
    return result["result"].removeprefix("0x").lower()


def mask_immutables(bytecode: str, references: dict) -> str:
    chars = list(bytecode)
    for ranges in references.values():
        for item in ranges:
            start = item["start"] * 2
            length = item["length"] * 2
            chars[start : start + length] = "0" * length
    return "".join(chars)


env = environment()
rpc_url = (env.get("SEPOLIA_RPC_URLS") or env.get("SEPOLIA_RPC_URL") or "").split(",")[0].strip()
if not rpc_url:
    raise RuntimeError("SEPOLIA_RPC_URL or SEPOLIA_RPC_URLS is required")
manifest = json.loads((ROOT / "packages/contracts/manifests/sepolia-v1.json").read_text())
passed = 0
with zipfile.ZipFile(ZIP_PATH) as artifacts:
    for request_id, (key, contract) in enumerate(manifest["contracts"].items(), 1):
        name = contract["name"]
        address = env.get(f"CONTRACT_{key}", "").strip()
        if len(address) != 42 or not address.startswith("0x"):
            raise RuntimeError(f"CONTRACT_{key} is required")
        artifact = json.loads(artifacts.read(f"{name}.sol/{name}.json"))
        local_abi = json.loads(
            (ROOT / f"packages/adapters/abis/{name}.json").read_text(encoding="utf-8-sig")
        )
        expected = artifact["deployedBytecode"]["object"].removeprefix("0x").lower()
        references = artifact["deployedBytecode"].get("immutableReferences", {})
        actual = rpc_code(rpc_url, address, request_id)
        ok = local_abi == artifact["abi"] and mask_immutables(actual, references) == mask_immutables(
            expected, references
        )
        print(f"{'PASS' if ok else 'FAIL'}: {name} ABI and normalized runtime")
        passed += int(ok)
print(f"Artifact equivalence: {passed}/12 PASS")
sys.exit(0 if passed == 12 else 1)
