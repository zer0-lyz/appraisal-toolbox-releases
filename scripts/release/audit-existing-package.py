"""Read-only artifact audit. No product execution, installation or GUI tests."""
import argparse, hashlib, json, pathlib, zipfile, datetime, re, os

p = argparse.ArgumentParser()
for arg in ('source', 'package', 'archive', 'prior-inventory', 'output'):
    p.add_argument('--' + arg, required=True)
a = p.parse_args()
source, package, archive = map(pathlib.Path, (a.source, a.package, a.archive))
def sha(data): return hashlib.sha256(data).hexdigest()
def file_sha(f): return sha(f.read_bytes())
def long_path(path):
    value = os.path.abspath(str(path))
    if os.name != 'nt' or value.startswith('\\\\?\\'): return value
    if value.startswith('\\\\'): return '\\\\?\\UNC\\' + value[2:]
    return '\\\\?\\' + value
checksums = {}
for line in (package / 'SHA256SUMS').read_text('utf-8').splitlines():
    m = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
    if not m: raise RuntimeError('Invalid checksum line')
    name = m[2].replace('\\', '/')
    if name in checksums or '..' in pathlib.PurePosixPath(name).parts or name.startswith('/'):
        raise RuntimeError('Unsafe/duplicate checksum path')
    checksums[name] = m[1]
for name, digest in checksums.items():
    if sha(open(long_path(package / name), 'rb').read()) != digest: raise RuntimeError('Package hash mismatch: ' + name)
files = set(checksums) | {'SHA256SUMS'}
with zipfile.ZipFile(archive) as z:
    prefix = package.name + '/'
    names = z.namelist()
    if len(set(names)) != len(names): raise RuntimeError('Duplicate ZIP entries')
    expected = {prefix + x for x in files}
    if set(names) != expected: raise RuntimeError('ZIP tree mismatch')
    for name in names:
        data = z.read(name)  # also verifies CRC
        relative = name[len(prefix):]
        expected_digest = checksums.get(relative)
        if expected_digest is None:
            expected_digest = sha(open(long_path(package / relative), 'rb').read())
        if sha(data) != expected_digest:
            raise RuntimeError('ZIP/package mismatch: ' + name)
payload = []
for entry in json.loads(pathlib.Path(a.prior_inventory).read_text('utf-8')):
    if file_sha(source / entry['path']) != entry['sha256']:
        raise RuntimeError('Prior source inventory drift: ' + entry['path'])
    name = entry['path']
    if name.startswith('src/') or name in ('manifest.json', 'version.json', 'runtime-compat.json', 'README.md', 'LICENSE'):
        target = 'extension/' + name
    elif name.startswith(('native-helper/', 'skills/')): target = name
    elif name.startswith('windows/installer/'): target = pathlib.PurePosixPath(name).name
    else: continue
    if file_sha(package / target) != entry['sha256']: raise RuntimeError('Payload/source mismatch: ' + name)
    payload.append({'source': name, 'package': target, 'sha256': entry['sha256']})
# Path denylist targets user data; names such as requests/cookies.py are library code.
for name in files:
    if re.search(r'(^|/)(runtime-config\.json|installation-report\.txt|Cookies|Login Data|Local State|\.env(?:\..*)?|latest_history\.json|_history\.json)$', name, re.I):
        raise RuntimeError('Private/generated data path in package: ' + name)
archive_sha = file_sha(archive)
if archive_sha != '9cdf15366fe4711d03f8b34135d5dd4aaa7fbb08826e7678d7b45b2aa2a67a5c':
    raise RuntimeError('Unexpected handoff ZIP')
result = {'auditedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'read-only package/source/ZIP integrity; no new GUI or installation acceptance',
          'archiveSha256': archive_sha, 'archiveBytes': archive.stat().st_size,
          'nativeExeSha256': file_sha(package / 'native-helper/native_host.exe'),
          'checksumFiles': len(checksums), 'zipEntries': len(names),
          'sourcePayloadFiles': len(payload), 'payloadMapping': payload,
          'privateDataPathCheck': 'pass', 'result': 'pass'}
pathlib.Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps({k:v for k,v in result.items() if k != 'payloadMapping'}, ensure_ascii=False))
