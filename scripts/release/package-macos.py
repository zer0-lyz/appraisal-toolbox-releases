"""Extract only hash-locked vendor runtime, or create a deterministic candidate ZIP."""
import hashlib, json, pathlib, sys, zipfile, stat

def digest(data):
    return hashlib.sha256(data).hexdigest()

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
    root, output = map(pathlib.Path, sys.argv[2:4])
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in sorted(root.rglob('*')):
            if file.is_file():
                assert not file.is_symlink()
                info = zipfile.ZipInfo(root.name + '/' + file.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | (0o755 if file.stat().st_mode & 0o111 else 0o644)) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, file.read_bytes())
else:
    raise SystemExit('Unknown packaging operation')
