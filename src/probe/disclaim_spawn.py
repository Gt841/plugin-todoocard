#!/usr/bin/env python3
"""macOS disclaim supervisor. Usage: python disclaim_spawn.py <prog> [args...]
Spawn child with TCC responsibility detached, print 'PID <n>', then wait (supervise)."""
import ctypes, os, sys
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
class SpawnAttr(ctypes.Structure):
    _fields_ = [("opaque", ctypes.c_byte * 128)]
libc.posix_spawnattr_init.argtypes = [ctypes.POINTER(SpawnAttr)]; libc.posix_spawnattr_init.restype = ctypes.c_int
libc.posix_spawnattr_destroy.argtypes = [ctypes.POINTER(SpawnAttr)]
libc.responsibility_spawnattrs_setdisclaim.argtypes = [ctypes.POINTER(SpawnAttr), ctypes.c_int]; libc.responsibility_spawnattrs_setdisclaim.restype = ctypes.c_int
libc.posix_spawnp.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(SpawnAttr), ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_char_p)]
libc.posix_spawnp.restype = ctypes.c_int
def to_argv(lst):
    arr = (ctypes.c_char_p * (len(lst) + 1))()
    for i, s in enumerate(lst): arr[i] = s.encode() if isinstance(s, str) else s
    arr[len(lst)] = None; return arr
def main():
    if len(sys.argv) < 2: return 2
    attr = SpawnAttr(); libc.posix_spawnattr_init(ctypes.byref(attr))
    libc.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), 1)
    argv = to_argv(sys.argv[1:]); envp = to_argv(["%s=%s" % (k, v) for k, v in os.environ.items()])
    pid = ctypes.c_int(0)
    rc = libc.posix_spawnp(ctypes.byref(pid), sys.argv[1].encode(), None, ctypes.byref(attr), argv, envp)
    libc.posix_spawnattr_destroy(ctypes.byref(attr))
    if rc != 0: return rc
    print("PID %d" % pid.value); sys.stdout.flush()
    _, status = os.waitpid(pid.value, 0)
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
if __name__ == "__main__":
    sys.exit(main())
