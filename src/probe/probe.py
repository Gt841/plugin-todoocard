#!/usr/bin/env python3
"""BLE preflight probe. Usage: python probe.py <result.json> [label]
exit 0 = scan ok; 4 = exception; TCC kill = SIGABRT (shell 134)."""
import json, os, subprocess, sys, time
RESULT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tcc-probe.json"
LABEL = sys.argv[2] if len(sys.argv) > 2 else "preflight"

def responsible():
    try:
        import ctypes
        lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        fn = lib.responsibility_get_pid_responsible_for_pid
        fn.argtypes = [ctypes.c_int]; fn.restype = ctypes.c_int
        rpid = fn(os.getpid())
        comm = subprocess.run(["ps", "-o", "comm=", "-p", str(rpid)], capture_output=True, text=True, timeout=5).stdout.strip()
        return {"responsible_pid": rpid, "responsible_comm": comm, "is_self": rpid == os.getpid()}
    except Exception as e:
        return {"responsible_pid_error": repr(e)}

def write(p):
    p["label"] = LABEL; p["pid"] = os.getpid(); p["tcc_responsible"] = responsible(); p["ts"] = time.time()
    with open(RESULT, "w") as f: json.dump(p, f, ensure_ascii=False, indent=2)
    print(json.dumps(p, ensure_ascii=False)); sys.stdout.flush()

def main():
    info = {}
    try:
        from CoreBluetooth import CBManager
        a = int(CBManager.authorization())
        info["authorization"] = {0: "notDetermined", 1: "restricted", 2: "denied", 3: "allowedAlways"}.get(a, str(a))
    except Exception as e:
        info["authorization_error"] = repr(e)
    try:
        import asyncio
        from bleak import BleakScanner
        async def scan(): return await BleakScanner.discover(timeout=6.0)
        devs = asyncio.run(scan())
        info["ok"] = True; info["devices_count"] = len(devs)
        info["devices_sample"] = [{"name": d.name, "address": d.address} for d in devs[:5]]
        write(info); return 0
    except Exception as e:
        info["ok"] = False; info["error"] = repr(e); write(info); return 4

if __name__ == "__main__":
    sys.exit(main())
