"""Password-once authentication for the release tool; credentials stay in memory."""

import base64
import ctypes
import getpass
import os
import struct
import subprocess
import sys
import threading
import time
import warnings
from ctypes import wintypes
from pathlib import Path

_PIPE_ENV = 'BG_RELEASE_AUTH_PIPE'
_OWNER_ENV = 'BG_RELEASE_AUTH_OWNER'
_TARGET_ENV = 'BG_RELEASE_AUTH_TARGET'
# OpenSSH's askpass reader has a 1024-byte buffer, including its terminator.
_MAX_SECRET = 1020
_HANDSHAKE_SECONDS = 15
_REQUEST = b'BG_RELEASE_PASSWORD_V1\n'


def _wipe(value):
    if isinstance(value, bytearray):
        value[:] = b'\0' * len(value)


class _WindowsAPI:
    """The small Win32 surface needed by the private credential pipe."""

    def __init__(self):
        if os.name != 'nt':
            raise RuntimeError('Release password authentication requires Windows.')
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.security = ctypes.WinDLL('advapi32', use_last_error=True)
        pointer = ctypes.c_void_p
        dword_pointer = ctypes.POINTER(wintypes.DWORD)
        signatures = {
            'CreateNamedPipeW': ([wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
                                 wintypes.DWORD, pointer], wintypes.HANDLE),
            'CreateFileW': ([wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, pointer,
                            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE], wintypes.HANDLE),
            'ConnectNamedPipe': ([wintypes.HANDLE, pointer], wintypes.BOOL),
            'DisconnectNamedPipe': ([wintypes.HANDLE], wintypes.BOOL),
            'WaitNamedPipeW': ([wintypes.LPCWSTR, wintypes.DWORD], wintypes.BOOL),
            'ReadFile': ([wintypes.HANDLE, pointer, wintypes.DWORD, dword_pointer, pointer], wintypes.BOOL),
            'WriteFile': ([wintypes.HANDLE, pointer, wintypes.DWORD, dword_pointer, pointer], wintypes.BOOL),
            'GetOverlappedResult': ([wintypes.HANDLE, pointer, dword_pointer, wintypes.BOOL], wintypes.BOOL),
            'CancelIoEx': ([wintypes.HANDLE, pointer], wintypes.BOOL),
            'CreateEventW': ([pointer, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            'WaitForSingleObject': ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
            'LocalFree': ([pointer], pointer),
            'GetCurrentProcess': ([], wintypes.HANDLE),
            'OpenProcess': ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            'GetProcessTimes': ([wintypes.HANDLE, pointer, pointer, pointer, pointer], wintypes.BOOL),
            'QueryFullProcessImageNameW': ([wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                          dword_pointer], wintypes.BOOL),
            'GetNamedPipeClientProcessId': ([wintypes.HANDLE, dword_pointer], wintypes.BOOL),
            'GetNamedPipeServerProcessId': ([wintypes.HANDLE, dword_pointer], wintypes.BOOL),
            'CreateToolhelp32Snapshot': ([wintypes.DWORD, wintypes.DWORD], wintypes.HANDLE),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = arguments, result
        for name, arguments in {
            'OpenProcessToken': [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)],
            'GetTokenInformation': [wintypes.HANDLE, ctypes.c_int, pointer, wintypes.DWORD, dword_pointer],
            'ConvertSidToStringSidW': [pointer, ctypes.POINTER(wintypes.LPWSTR)],
            'ConvertStringSecurityDescriptorToSecurityDescriptorW': [wintypes.LPCWSTR, wintypes.DWORD,
                                                                      ctypes.POINTER(pointer), dword_pointer],
        }.items():
            function = getattr(self.security, name)
            function.argtypes, function.restype = arguments, wintypes.BOOL

        class Overlapped(ctypes.Structure):
            _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t),
                        ('Offset', wintypes.DWORD), ('OffsetHigh', wintypes.DWORD),
                        ('hEvent', wintypes.HANDLE)]

        class SecurityAttributes(ctypes.Structure):
            _fields_ = [('nLength', wintypes.DWORD), ('lpSecurityDescriptor', pointer),
                        ('bInheritHandle', wintypes.BOOL)]

        class ProcessEntry(ctypes.Structure):
            _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                        ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
                        ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                        ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                        ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]

        self.Overlapped = Overlapped
        self.SecurityAttributes = SecurityAttributes
        self.ProcessEntry = ProcessEntry
        for name in ('Process32FirstW', 'Process32NextW'):
            function = getattr(self.kernel, name)
            function.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
            function.restype = wintypes.BOOL
        self.invalid_handle = ctypes.c_void_p(-1).value
        self.user_sid = self.process_identity(os.getpid())[2]

    def close(self, handle):
        if handle and handle != self.invalid_handle:
            self.kernel.CloseHandle(handle)

    def _sid(self, process):
        token = wintypes.HANDLE()
        if not self.security.OpenProcessToken(process, 0x0008, ctypes.byref(token)):
            raise RuntimeError('Unable to verify release authentication identity.')
        try:
            size = wintypes.DWORD()
            self.security.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
            if not size.value or size.value > 65536:
                raise RuntimeError('Unable to verify release authentication identity.')
            information = ctypes.create_string_buffer(size.value)
            if not self.security.GetTokenInformation(token, 1, information, size, ctypes.byref(size)):
                raise RuntimeError('Unable to verify release authentication identity.')
            sid = ctypes.cast(information, ctypes.POINTER(ctypes.c_void_p)).contents.value
            text = wintypes.LPWSTR()
            if not self.security.ConvertSidToStringSidW(sid, ctypes.byref(text)):
                raise RuntimeError('Unable to verify release authentication identity.')
            try:
                return text.value
            finally:
                self.kernel.LocalFree(ctypes.cast(text, ctypes.c_void_p))
        finally:
            self.close(token)

    def process_identity(self, pid):
        process = self.kernel.OpenProcess(0x1000, False, pid)
        if not process:
            raise RuntimeError('Unable to verify release authentication process.')
        try:
            creation, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
            if not self.kernel.GetProcessTimes(process, ctypes.byref(creation), ctypes.byref(exited),
                                               ctypes.byref(kernel), ctypes.byref(user)):
                raise RuntimeError('Unable to verify release authentication process.')
            capacity = wintypes.DWORD(32768)
            image = ctypes.create_unicode_buffer(capacity.value)
            if not self.kernel.QueryFullProcessImageNameW(process, 0, image, ctypes.byref(capacity)):
                raise RuntimeError('Unable to verify release authentication process.')
            birth = creation.dwLowDateTime | creation.dwHighDateTime << 32
            return birth, os.path.normcase(os.path.realpath(image.value)), self._sid(process)
        finally:
            self.close(process)

    def parents(self):
        snapshot = self.kernel.CreateToolhelp32Snapshot(0x00000002, 0)
        if snapshot == self.invalid_handle:
            raise RuntimeError('Unable to verify release authentication ancestry.')
        try:
            entry = self.ProcessEntry()
            entry.dwSize = ctypes.sizeof(entry)
            result = {}
            available = self.kernel.Process32FirstW(snapshot, ctypes.byref(entry))
            while available:
                result[entry.th32ProcessID] = entry.th32ParentProcessID
                available = self.kernel.Process32NextW(snapshot, ctypes.byref(entry))
            return result
        finally:
            self.close(snapshot)

    def peer_pid(self, handle, server=False):
        pid = wintypes.DWORD()
        function = self.kernel.GetNamedPipeServerProcessId if server else self.kernel.GetNamedPipeClientProcessId
        if not function(handle, ctypes.byref(pid)) or not pid.value:
            raise RuntimeError('Unable to verify release authentication peer.')
        return pid.value

    def pipe(self, address):
        descriptor = ctypes.c_void_p()
        # No Everyone/anonymous access; the kernel also rejects remote clients.
        sddl = 'D:P(A;;GRGW;;;' + self.user_sid + ')'
        if not self.security.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl, 1, ctypes.byref(descriptor), None):
            raise RuntimeError('Unable to protect release authentication pipe.')
        try:
            attributes = self.SecurityAttributes(ctypes.sizeof(self.SecurityAttributes), descriptor, False)
            handle = self.kernel.CreateNamedPipeW(
                address, 0x00000003 | 0x40000000 | 0x00080000,
                0x00000008, 1, 4096, 4096, 0, ctypes.byref(attributes))
            if not handle or handle == self.invalid_handle:
                raise RuntimeError('Unable to create protected release authentication pipe.')
            return handle
        finally:
            self.kernel.LocalFree(descriptor)

    def _complete(self, handle, operation, start, deadline, stop=None):
        operation.hEvent = self.kernel.CreateEventW(None, True, False, None)
        if not operation.hEvent:
            raise RuntimeError('Release authentication communication failed.')
        transferred = wintypes.DWORD()
        pending = False
        try:
            if not start(ctypes.byref(operation), ctypes.byref(transferred)):
                error = ctypes.get_last_error()
                if error == 535:  # A client connected before ConnectNamedPipe.
                    return 0
                if error != 997:  # ERROR_IO_PENDING
                    raise RuntimeError('Release authentication communication failed.')
                pending = True
                while True:
                    if (stop is not None and stop.is_set()) or time.monotonic() >= deadline:
                        raise RuntimeError('Release authentication communication timed out.')
                    wait = self.kernel.WaitForSingleObject(operation.hEvent, 100)
                    if wait == 0:
                        break
                    if wait != 258:
                        raise RuntimeError('Release authentication communication failed.')
                if not self.kernel.GetOverlappedResult(handle, ctypes.byref(operation),
                                                        ctypes.byref(transferred), False):
                    raise RuntimeError('Release authentication communication failed.')
                pending = False
            return transferred.value
        finally:
            if pending:
                self.kernel.CancelIoEx(handle, ctypes.byref(operation))
                self.kernel.GetOverlappedResult(handle, ctypes.byref(operation), ctypes.byref(transferred), True)
            self.close(operation.hEvent)

    def connect(self, handle, deadline, stop):
        operation = self.Overlapped()
        self._complete(handle, operation,
                       lambda overlap, _count: self.kernel.ConnectNamedPipe(handle, overlap), deadline, stop)

    def read(self, handle, count, deadline, stop=None):
        result = bytearray()
        try:
            while len(result) < count:
                buffer = ctypes.create_string_buffer(count - len(result))
                try:
                    operation = self.Overlapped()
                    length = self._complete(handle, operation,
                        lambda overlap, transferred, buffer=buffer: self.kernel.ReadFile(
                            handle, buffer, len(buffer), transferred, overlap), deadline, stop)
                    if not length:
                        raise RuntimeError('Release authentication communication ended.')
                    result.extend(buffer.raw[:length])
                finally:
                    ctypes.memset(buffer, 0, len(buffer))
            return result
        except BaseException:
            _wipe(result)
            raise

    def write(self, handle, data, deadline, stop=None):
        position = 0
        while position < len(data):
            count = len(data) - position
            buffer = ctypes.create_string_buffer(bytes(data[position:]))
            try:
                operation = self.Overlapped()
                length = self._complete(handle, operation,
                    lambda overlap, transferred, buffer=buffer, count=count: self.kernel.WriteFile(
                        handle, buffer, count, transferred, overlap), deadline, stop)
                if not length:
                    raise RuntimeError('Release authentication communication ended.')
                position += length
            finally:
                ctypes.memset(buffer, 0, len(buffer))


class _WindowsBroker:
    def __init__(self, authentication):
        import secrets
        self.authentication = authentication
        self.api = _WindowsAPI()
        self.owner_pid = os.getpid()
        self.address = r'\\.\pipe\bg-release-' + secrets.token_hex(24)
        self._stop = threading.Event()
        self._condition = threading.Condition()
        self._active = {}
        self._expected_python = self.api.process_identity(os.getpid())[1]
        self._handle = self.api.pipe(self.address)
        self._thread = threading.Thread(target=self._serve, name='release-authentication', daemon=True)
        try:
            self._thread.start()
        except BaseException:
            self.api.close(self._handle)
            self._handle = None
            raise

    def authorize(self, pid):
        identity = self.api.process_identity(pid)
        if identity[2] != self.api.user_sid or Path(identity[1]).name.lower() not in ('ssh.exe', 'scp.exe'):
            raise RuntimeError('Unexpected release authentication process.')
        with self._condition:
            if self._stop.is_set():
                raise RuntimeError('Release authentication has ended.')
            self._active[pid] = identity
            self._condition.notify_all()

    def release(self, pid):
        with self._condition:
            self._active.pop(pid, None)
            self._condition.notify_all()

    def _authorized(self, peer, deadline):
        identity = self.api.process_identity(peer)
        if identity[2] != self.api.user_sid or identity[1] != self._expected_python:
            return False
        while not self._stop.is_set() and time.monotonic() < deadline:
            parents = self.api.parents()
            with self._condition:
                ancestor = peer
                for _ in range(12):
                    ancestor = parents.get(ancestor)
                    if not ancestor:
                        break
                    expected = self._active.get(ancestor)
                    if expected is not None:
                        return self.api.process_identity(ancestor) == expected
                # Popen can launch its helper before authorize_process receives its PID.
                self._condition.wait(timeout=0.05)
        return False

    def _serve(self):
        while not self._stop.is_set():
            request = response = acknowledgement = None
            try:
                self.api.connect(self._handle, time.monotonic() + 1, self._stop)
                deadline = time.monotonic() + _HANDSHAKE_SECONDS
                peer = self.api.peer_pid(self._handle)
                if not self._authorized(peer, deadline):
                    continue
                request = self.api.read(self._handle, len(_REQUEST), deadline, self._stop)
                if request != _REQUEST:
                    continue
                with self.authentication._lock:
                    if self.authentication._closed:
                        continue
                    response = bytearray(struct.pack('!I', len(self.authentication._secret)))
                    response.extend(self.authentication._secret)
                self.api.write(self._handle, response, deadline, self._stop)
                acknowledgement = self.api.read(self._handle, 2, deadline, self._stop)
                if acknowledgement != b'OK':
                    continue
            except (RuntimeError, OSError, ValueError):
                # Invalid/expired peers receive no credential and cannot kill the broker.
                pass
            finally:
                _wipe(request)
                _wipe(response)
                _wipe(acknowledgement)
                self.api.kernel.DisconnectNamedPipe(self._handle)

    def close(self):
        self._stop.set()
        with self._condition:
            self._active.clear()
            self._condition.notify_all()
        self.api.kernel.CancelIoEx(self._handle, None)
        self._thread.join(timeout=_HANDSHAKE_SECONDS + 2)
        if self._thread.is_alive():
            raise RuntimeError('Release authentication cleanup did not complete.')
        self.api.close(self._handle)
        self._handle = None


def _read_pipe_secret(address, owner_pid):
    api = _WindowsAPI()
    deadline = time.monotonic() + _HANDSHAKE_SECONDS
    while True:
        handle = api.kernel.CreateFileW(address, 0x80000000 | 0x40000000, 0, None,
                                        3, 0x40000000, None)
        if handle and handle != api.invalid_handle:
            break
        if ctypes.get_last_error() not in (2, 231) or time.monotonic() >= deadline:
            raise RuntimeError('Release authentication is unavailable.')
        api.kernel.WaitNamedPipeW(address, 100)
        time.sleep(0.025)
    header = secret = None
    try:
        if api.peer_pid(handle, server=True) != owner_pid or api.process_identity(owner_pid)[2] != api.user_sid:
            raise RuntimeError('Unexpected release authentication owner.')
        api.write(handle, _REQUEST, deadline)
        header = api.read(handle, 4, deadline)
        size = struct.unpack('!I', header)[0]
        if size < 1 or size > _MAX_SECRET:
            raise RuntimeError('Invalid release authentication response.')
        secret = api.read(handle, size, deadline)
        api.write(handle, b'OK', deadline)
        return bytes(secret)
    finally:
        _wipe(header)
        _wipe(secret)
        api.close(handle)


def _askpass(prompt):
    try:
        target = os.environ.get(_TARGET_ENV, '')
        address = os.environ.get(_PIPE_ENV, '')
        owner = os.environ.get(_OWNER_ENV, '')
        if (not target or prompt.strip() != (target + "'s password:")
                or os.environ.get('SSH_ASKPASS_PROMPT', '') not in ('', 'password')
                or not address.startswith(r'\\.\pipe\bg-release-') or not owner.isdecimal()):
            return 1
        secret = bytearray(_read_pipe_secret(address, int(owner)))
        try:
            if not secret or len(secret) > _MAX_SECRET or any(value in secret for value in (0, 10, 13)):
                return 1
            sys.stdout.buffer.write(secret)
            sys.stdout.buffer.write(b'\n')
            sys.stdout.buffer.flush()
            return 0
        finally:
            _wipe(secret)
    except (OSError, RuntimeError, ValueError, TypeError, AttributeError, struct.error, ctypes.ArgumentError):
        return 1


class DeploymentAuthentication:
    def __init__(self, target):
        if (os.name != 'nt' or not isinstance(target, str) or target.count('@') != 1
                or not all(target.split('@')) or any(character.isspace() for character in target)
                or any(ord(character) < 32 for character in target)):
            raise RuntimeError('Unsupported release authentication target or platform.')
        self.target = target
        self._lock = threading.Lock()
        self._closed = False
        self._secret = bytearray()
        self._broker = None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                password = getpass.getpass('Server password (used only for this release): ')
            self._secret = bytearray(password.encode('utf-8'))
            del password
            if (not self._secret or len(self._secret) > _MAX_SECRET
                    or any(value in self._secret for value in (0, 10, 13))):
                raise RuntimeError('A valid server password is required.')
            self._broker = _WindowsBroker(self)
        except (OSError, RuntimeError, ValueError, getpass.GetPassWarning, ctypes.ArgumentError):
            raise RuntimeError('Unable to establish private release authentication.') from None
        finally:
            if self._broker is None:
                _wipe(self._secret)
                self._closed = True

    def prepare_command(self, args, env=None):
        command = list(map(str, args))
        executable = Path(command[0]).name.lower() if command else ''
        if executable not in ('ssh', 'ssh.exe', 'scp', 'scp.exe'):
            raise RuntimeError('Release credentials are limited to SSH and SCP.')
        if not any(item == self.target or item.startswith(self.target + ':') for item in command[1:]):
            raise RuntimeError('Unexpected release authentication destination.')
        with self._lock:
            if self._closed:
                raise RuntimeError('Release authentication has ended.')
        options = []
        for value in ('StrictHostKeyChecking=yes', 'NumberOfPasswordPrompts=1', 'BatchMode=no',
                      'PasswordAuthentication=yes', 'KbdInteractiveAuthentication=no',
                      'PreferredAuthentications=publickey,password'):
            options.extend(('-o', value))
        child_environment = dict(os.environ if env is None else env)
        child_environment.update({
            'SSH_ASKPASS': subprocess.list2cmdline([
                sys.executable, '-I', '-B', str(Path(__file__).resolve()), '--askpass']),
            'SSH_ASKPASS_REQUIRE': 'force',
            _PIPE_ENV: self._broker.address,
            _OWNER_ENV: str(self._broker.owner_pid),
            _TARGET_ENV: self.target,
        })
        child_environment.pop('SSH_ASKPASS_PROMPT', None)
        return [command[0], *options, *command[1:]], child_environment

    def authorize_process(self, pid):
        self._broker.authorize(pid)

    def release_process(self, pid):
        self._broker.release(pid)

    def send_sudo_password(self, stream):
        with self._lock:
            if self._closed:
                raise RuntimeError('Release authentication has ended.')
            frame = bytearray(base64.b64encode(self._secret))
        try:
            frame.extend(b'\n')
            position = 0
            while position < len(frame):
                written = stream.write(memoryview(frame)[position:])
                if not isinstance(written, int) or written <= 0:
                    raise RuntimeError('Unable to send protected server authorization.')
                position += written
            stream.flush()
        finally:
            _wipe(frame)

    def redact(self, line):
        with self._lock:
            if not self._secret:
                return line
            secret = bytes(self._secret)
            encoded = base64.b64encode(self._secret)
        # Apply the longer representation first when one happens to contain the other.
        for value in sorted((secret, encoded), key=len, reverse=True):
            line = line.replace(value, b'[REDACTED]')
        return line

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            _wipe(self._secret)
        if self._broker is not None:
            self._broker.close()


def run_with_sudo(marker, action):
    """Self-contained Linux entry point, also embedded before the tool is uploaded."""
    import _thread
    import base64
    import os
    import select
    import subprocess
    import sys
    import termios
    import threading
    import time

    if (not isinstance(marker, str) or not marker or len(marker) > 200
            or any(ord(character) < 33 or ord(character) > 126 for character in marker)):
        raise RuntimeError('Invalid server authorization handshake.')
    secret = bytearray()
    frame = bytearray()
    stop = threading.Event()
    failed = threading.Event()
    keeper = None
    original = None
    descriptor = None

    def erase(value):
        value[:] = b'\0' * len(value)

    def validate_password():
        payload = bytearray(secret)
        payload.extend(b'\n')
        try:
            result = subprocess.run(['sudo', '-S', '-p', '', '-v'], input=payload,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=20, check=False)
            if result.returncode:
                raise RuntimeError('Server authorization failed.')
        except (OSError, subprocess.TimeoutExpired):
            raise RuntimeError('Server authorization failed.') from None
        finally:
            erase(payload)

    def refresh():
        while not stop.wait(45):
            try:
                result = subprocess.run(['sudo', '-n', '-v'], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=10, check=False)
                if result.returncode:
                    if stop.is_set():
                        return
                    validate_password()
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                if not stop.is_set():
                    failed.set()
                    _thread.interrupt_main()
                return

    try:
        try:
            descriptor = sys.stdin.fileno()
            if not os.isatty(descriptor):
                raise RuntimeError('Server authorization requires a protected terminal.')
            original = termios.tcgetattr(descriptor)
            protected = termios.tcgetattr(descriptor)
            protected[3] &= ~(termios.ECHO | termios.ECHONL)
            termios.tcsetattr(descriptor, termios.TCSANOW, protected)
            sys.stdout.write('\n' + marker + '\n')
            sys.stdout.flush()
            deadline = time.monotonic() + 45
            while b'\n' not in frame:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([descriptor], [], [], remaining)[0]:
                    raise RuntimeError('Server authorization handshake timed out.')
                chunk = os.read(descriptor, 512)
                if not chunk or len(frame) + len(chunk) > 2048:
                    raise RuntimeError('Invalid server authorization frame.')
                frame.extend(chunk)
            encoded = bytes(frame).rstrip(b'\r\n')
            secret.extend(base64.b64decode(encoded, validate=True))
            del encoded
            erase(frame)
            if (not secret or len(secret) > 1024
                    or any(value in secret for value in (0, 10, 13))):
                raise RuntimeError('Invalid server authorization frame.')
            validate_password()
        except (ValueError, OSError, termios.error):
            raise RuntimeError('Unable to establish protected server authorization.') from None
        finally:
            if original is not None:
                termios.tcsetattr(descriptor, termios.TCSANOW, original)
                original = None
        keeper = threading.Thread(target=refresh, name='release-sudo-refresh', daemon=True)
        keeper.start()
        try:
            result = action()
        except KeyboardInterrupt:
            if failed.is_set():
                raise RuntimeError('Server authorization could not be renewed.') from None
            raise
        if failed.is_set():
            raise RuntimeError('Server authorization could not be renewed.')
        return result
    finally:
        try:
            stop.set()
            if keeper is not None:
                keeper.join(timeout=32)
        finally:
            # A renewal failure can interrupt the main thread while it joins.
            erase(frame)
            erase(secret)
            if original is not None:
                termios.tcsetattr(descriptor, termios.TCSANOW, original)


if __name__ == '__main__':
    raise SystemExit(_askpass(sys.argv[2]) if len(sys.argv) == 3 and sys.argv[1] == '--askpass' else 1)
