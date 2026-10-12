"""Replace only the known embedded Appraisal map client, preserving payload bytes.

No configuration, API key, coordinates or business data are parsed or logged.
The selected HTML is backed up locally before an atomic, in-place update.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import uuid

OLD_HEADER = b'/* Official AMap JS API basemap. Leaflet retains the case/selection tools. */'
NEW_HEADER = b"/* Official AMap JS API frames share Leaflet's moving pane with case overlays. */"
FOOTER = b'})(window);'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def update_page(page, client, apply=False):
    page = Path(page).resolve(strict=True)
    if not page.is_file() or page.suffix.lower() not in ('.html', '.htm'):
        raise ValueError('请选择评估工具箱生成的地图 HTML 文件')
    old = page.read_bytes()
    positions = [old.find(header) for header in (OLD_HEADER, NEW_HEADER)]
    starts = [start for start in positions if start >= 0]
    if len(starts) != 1:
        raise ValueError('未找到唯一的评估工具箱地图组件，未修改文件')
    start = starts[0]
    if old.count(OLD_HEADER) + old.count(NEW_HEADER) != 1:
        raise ValueError('网页包含多个地图组件，未修改文件')
    end = old.find(FOOTER, start)
    if end < 0:
        raise ValueError('地图组件不完整，未修改文件')
    end += len(FOOTER)
    replacement = Path(client).read_bytes().strip()
    if not replacement.startswith(NEW_HEADER) or not replacement.endswith(FOOTER):
        raise ValueError('修复组件格式不正确，未修改文件')
    prefix, suffix = old[:start], old[end:]
    new = prefix + replacement + suffix
    result = {'page': str(page), 'changed': new != old, 'applied': False,
              'dataPrefixSha256': digest(prefix), 'dataSuffixSha256': digest(suffix),
              'originalSha256': digest(old), 'newSha256': digest(new),
              'scope': 'only embedded client replaced; configuration and payload kept opaque'}
    if new == old or not apply:
        return result
    backup = page.with_name(page.name + '.before-map-fix-' + time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8])
    with backup.open('xb') as saved:
        saved.write(old)
    if digest(backup.read_bytes()) != digest(old):
        raise ValueError('备份校验失败，未修改原网页')
    fd, temporary = tempfile.mkstemp(prefix='.appraisal-map-', suffix='.tmp', dir=page.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(new)
        # Do not overwrite a concurrent regeneration of the result page.
        if digest(page.read_bytes()) != digest(old):
            raise ValueError('网页已被另一操作更新，未覆盖；请稍后重试')
        for attempt in range(4):
            try:
                os.replace(temporary, page)
                break
            except PermissionError:
                if attempt == 3:
                    raise ValueError('网页被其他程序占用，请关闭该页后重试')
                time.sleep(0.2)
        actual = page.read_bytes()
        if digest(actual) != digest(new) or actual[:start] != prefix or actual[start + len(replacement):] != suffix:
            raise ValueError('更新后校验失败，原始备份已保留')
        result.update(applied=True, backup=str(backup), payloadBytesUnchanged=True)
        return result
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description='只更新已有地图网页的显示组件，保留原数据并先备份')
    parser.add_argument('--client', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('page')
    args = parser.parse_args()
    try:
        result = update_page(args.page, args.client, args.apply)
        print(json.dumps(result, ensure_ascii=False))
        print('地图网页已更新；在原浏览器刷新该地图。' if result['applied'] else '未修改文件（已是最新组件或仅检查）。')
        return 0
    except (OSError, ValueError) as error:
        print('地图网页更新失败：' + str(error))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
