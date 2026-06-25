---
name: yumi guard
event: PreToolUse
description: blocks dangerous commands, privilege escalation, protected paths, and credential exposure
---

```python
#!/usr/bin/env python3
import json, sys, re

DANGEROUS_PATTERNS = [
    # destructive file operations
    r'\brm\s+(-[^\s]*r|--recursive)', r'\brm\s+-rf', r'\bsudo\s+rm\b',
    r'\bshred\b', r'\bfind\s+.*-delete', r'\bxargs\s+rm',
    r'\bdd\s+', r'\bmkfs\.', r'\bfdisk\b', r'>/dev/sd',
    r':\(\)\s*\{',  # fork bomb

    # privilege escalation
    r'\bsudo\s+', r'\bsu\s+-', r'\bdoas\s+', r'\bpkexec\b',
    r'\bchmod\s+[ugo]?\+s', r'\bchown\s+root', r'/etc/sudoers',

    # system control
    r'\bshutdown\b', r'\breboot\b', r'\bhalt\b', r'\bpoweroff\b',
    r'\bsystemctl\s+(disable|mask|stop)', r'\blaunchctl\s+(unload|remove)',
    r'\biptables\b', r'\bufw\b', r'\bkillall\b', r'\bpkill\s+-9',
    r'\bcrontab\s+-[re]',

    # remote code execution
    r'curl.*\|.*sh', r'wget.*\|.*sh', r'\beval\s+.*\$',
    r'\bnc\s+.*-e', r'\bbash\s+-i.*>/dev/tcp',

    # dangerous git operations
    r'git\s+push\s+.*(-f|--force)', r'git\s+reset\s+--hard',
    r'git\s+clean\s+-[dfx]', r'git\s+branch\s+-D\s+(main|master)',

    # windows destructive
    r'\bformat\s+[a-z]:', r'\bdel\s+/[sfq]', r'\brd\s+/s',
    r'\breg\s+(delete|add)', r'\bdiskpart\b', r'\bbcdedit\b',
    r'powershell.*-enc', r'powershell.*bypass',

    # credential harvesting
    r'cat\s+.*\.env\b', r'cat\s+.*/\.aws/', r'cat\s+.*/\.ssh/',
    r'cat\s+.*credentials', r'cat\s+.*secret',
    r'grep\s+.*password', r'grep\s+.*api.?key', r'grep\s+.*token',
    r'find\s+.*-name\s+["\']?\*\.pem', r'find\s+.*-name\s+["\']?id_rsa',
]

PROTECTED_PATHS = [
    # system directories
    '/usr/', '/etc/', '/bin/', '/sbin/', '/var/', '/boot/', '/root/',
    '/sys/', '/proc/', '/dev/', '/system/', '/library/',

    # credentials and keys
    '.ssh/', '.gnupg/', '.aws/', '.kube/', '.docker/',
    '.bashrc', '.zshrc', '.profile', '.gitconfig', '.git-credentials',
    'id_rsa', 'id_ed25519', '.netrc', '.npmrc', '.pypirc',

    # secrets and env files
    '.env', '.env.local', '.env.production', '.env.secret',
    'credentials.json', 'secrets.json', 'config/secrets',
    'serviceaccount.json', 'keyfile.json',

    # windows system
    'c:/windows', 'c:/program files', 'system32',
]

CREDENTIAL_PATTERNS = [
    # common secret patterns in file content
    r'password\s*[=:]\s*["\'][^"\']+["\']',
    r'api[_-]?key\s*[=:]\s*["\'][^"\']+["\']',
    r'secret[_-]?key\s*[=:]\s*["\'][^"\']+["\']',
    r'access[_-]?token\s*[=:]\s*["\'][^"\']+["\']',
    r'private[_-]?key\s*[=:]\s*["\'][^"\']+["\']',
    r'-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----',
    r'-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----',
]

def check_path(path):
    if not path: return False
    p = path.lower().replace('\\', '/')
    if '..' in p: return True
    return any(x in p for x in PROTECTED_PATHS)

def check_content_for_secrets(content):
    if not content: return False
    return any(re.search(p, content, re.I) for p in CREDENTIAL_PATTERNS)

try:
    data = json.load(sys.stdin).get('data', {})
    tool, inp = data.get('tool', ''), data.get('input', {})

    # check bash commands
    if tool == 'Bash':
        cmd = inp.get('command', '')
        if any(re.search(p, cmd, re.I) for p in DANGEROUS_PATTERNS):
            print('{"action":"block","message":"blocked by yumi guard: dangerous command"}')
            sys.exit(2)

    # check file operations on protected paths
    if tool in ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']:
        path = inp.get('file_path', '') or inp.get('notebook_path', '')
        if check_path(path):
            print('{"action":"block","message":"blocked by yumi guard: protected path"}')
            sys.exit(2)

        # check if writing secrets
        content = inp.get('content', '') or inp.get('new_string', '')
        if check_content_for_secrets(content):
            print('{"action":"block","message":"blocked by yumi guard: detected credentials in content"}')
            sys.exit(2)

    # check read operations on sensitive files
    if tool == 'Read':
        path = inp.get('file_path', '')
        p = path.lower().replace('\\', '/')
        sensitive = ['.env', 'credentials', 'secrets', '.pem', 'id_rsa', 'id_ed25519', '.aws/']
        if any(s in p for s in sensitive):
            print('{"action":"block","message":"blocked by yumi guard: sensitive file read"}')
            sys.exit(2)

    print('{"action":"continue"}')
except:
    print('{"action":"block","message":"guard error - blocked for safety"}')
    sys.exit(2)
```
