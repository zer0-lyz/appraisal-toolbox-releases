"""Extract only hash-locked vendor runtime, or create a candidate ZIP."""
import hashlib, json, pathlib, sys, zipfile, stat, os, re

def digest(data):
    return hashlib.sha256(data).hexdigest()

def checksum_manifest(root):
    checksum_file = os.path.join(root, 'SHA256SUMS')
    checksums = {}
    with open(long_path(checksum_file), 'r', encoding='utf-8') as handle:
        for line in handle.read().splitlines():
            match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
            if not match:
                raise RuntimeError('Malformed SHA256SUMS line')
            name = match.group(2).replace('\\', '/')
            relative = pathlib.PurePosixPath(name)
            if relative.is_absolute() or '..' in relative.parts or name in checksums:
                raise RuntimeError('Unsafe or duplicate SHA256SUMS path: ' + name)
            checksums[name] = match.group(1)
    if not checksums:
        raise RuntimeError('Empty SHA256SUMS')
    return checksums

def long_path(path):
    """Return a Windows extended path so deeply nested runtime files are not skipped."""
    absolute = os.path.abspath(path)
    if os.name != 'nt' or absolute.startswith('\\\\?\\'):
        return absolute
    if absolute.startswith('\\\\'):
        return '\\\\?\\UNC\\' + absolute[2:]
    return '\\\\?\\' + absolute

def verify_archive(root, archive_path, checksums):
    prefix = os.path.basename(os.path.abspath(root).rstrip('\\/')) + '/'
    expected = {prefix + name for name in checksums}
    expected.add(prefix + 'SHA256SUMS')
    with zipfile.ZipFile(archive_path, 'r') as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError('Duplicate ZIP entry')
        if set(names) != expected:
            missing = sorted(expected - set(names))
            extra = sorted(set(names) - expected)
            raise RuntimeError('ZIP/SHA256SUMS entry mismatch; missing=' + repr(missing[:10]) + '; extra=' + repr(extra[:10]))
        for full_name in names:
            relative = full_name[len(prefix):]
            data = archive.read(full_name)
            if relative == 'SHA256SUMS':
                expected_digest = digest(open(long_path(os.path.join(root, relative)), 'rb').read())
            else:
                expected_digest = checksums[relative]
            if digest(data) != expected_digest:
                raise RuntimeError('ZIP content SHA-256 mismatch: ' + relative)

mode = sys.argv[1]
if mode == 'runtime':
    archive, destination, lockfile = map(pathlib.Path, sys.argv[2:5])
    lock = json.loads(lockfile.read_text())['targets']['macos-arm64']
    assert digest(archive.read_bytes()) == lock['baseAsset']['sha256'], 'Base ZIP SHA mismatch'
    with zipfile.ZipFile(archive) as z:
        prefixes = {p.split('/')[0] for p in z.namelist()}
        assert len(prefixes) == 1
        prefix = next(iter(prefixes)) + '/'
        for item in lock['runtimeFiles']:
            relative = pathlib.PurePosixPath(item['path'])
            assert '..' not in relative.parts and not relative.is_absolute()
            data = z.read(prefix + item['path'])
            assert digest(data) == item['sha256'], item['path']
            dest = destination / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            if item['path'] == 'runtime/node/bin/node':
                dest.chmod(0o755)
elif mode == 'zip':
    root_arg, output_arg = sys.argv[2:4]
    root = os.path.abspath(root_arg)
    output = os.path.abspath(output_arg)
    checksums = checksum_manifest(root)
    root_name = os.path.basename(root.rstrip('\\/'))
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        if os.name == 'nt':
            # Windows recursive walkers can silently omit paths beyond MAX_PATH.
            # SHA256SUMS is produced by the build inventory and is the authoritative list.
            entries = sorted(checksums) + ['SHA256SUMS']
            for relative in entries:
                source = long_path(os.path.join(root, *pathlib.PurePosixPath(relative).parts))
                if os.path.islink(source) or not os.path.isfile(source):
                    raise RuntimeError('Missing or non-regular package file: ' + relative)
                if relative != 'SHA256SUMS':
                    h = hashlib.sha256()
                    with open(source, 'rb') as handle:
                        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                            h.update(chunk)
                    if h.hexdigest() != checksums[relative]:
                        raise RuntimeError('Package SHA-256 mismatch before ZIP: ' + relative)
                z.write(source, root_name + '/' + relative)
        else:
            root_path = pathlib.Path(root)
            for file in sorted(root_path.rglob('*')):
                if file.is_file():
                    assert not file.is_symlink()
                    relative = file.relative_to(root_path).as_posix()
                    if relative != 'SHA256SUMS' and relative not in checksums:
                        raise RuntimeError('Unlisted package file: ' + relative)
                    info = zipfile.ZipInfo(root_name + '/' + relative, (2026, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | (0o755 if file.stat().st_mode & 0o111 else 0o644)) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    z.writestr(info, file.read_bytes())
    verify_archive(root, output, checksums)
elif mode == 'verify-zip':
    root, output = sys.argv[2:4]
    checksums = checksum_manifest(root)
    verify_archive(root, output, checksums)
    print(json.dumps({'ok': True, 'checksumFiles': len(checksums), 'zipEntries': len(checksums) + 1, 'verification': 'exact SHA256SUMS inventory and contents'}))
else:
    raise SystemExit('Unknown packaging operation')
