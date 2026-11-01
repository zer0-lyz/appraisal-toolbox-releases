# -*- coding: utf-8 -*-
"""
apply_ppi_to_draft.py — 把 NBS PPI 数据落到**原底稿**，格式与底稿保持一致

与 fill_ppi.py 的分工
    fill_ppi.py         用 openpyxl，输出到 _out/ 副本，适合先看效果
    apply_ppi_to_draft  用 COM(WPS)，直接改原底稿，公式缓存值与结构零损伤

安全设计
    1. 默认自动备份（带时间戳），备份失败即中止
    2. 走 COM（WPS 原生），保留全部公式缓存值、名称定义、图片、批注、Table
    3. 只补不覆盖——底稿已有值的格子一律不动（底稿存 2 位小数，比 NBS 官网的
       1 位小数更精细，覆盖它等于降低精度）
    4. 写入后强制格式：宋体 10 号、数值型、两位小数
    5. 支持新增未来月份行：复制上期行格式，并补 A/B/C 三列（日期/年/月）

用法
    python apply_ppi_to_draft.py                 # 备份后写入原底稿
    python apply_ppi_to_draft.py --dry-run       # 只输出计划，不写文件
    python apply_ppi_to_draft.py --draft <路径>  # 指定底稿
"""
import os
import sys
import json
import time
import shutil
import calendar
import warnings
from datetime import datetime, date

warnings.filterwarnings('ignore')
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE = os.environ.get('FA_WORKSPACE') or os.getcwd()
OUT = os.path.join(BASE, '_out')
BASELINE = os.environ.get('FA_BASELINE') or os.path.join(BASE, 'data', 'ppi_baseline.json')
DRAFT = os.environ.get('FA_DRAFT') or os.path.join(
    BASE, '固定资产底稿模板', 'XXX公司-固定资产设备底稿-V1.0.xlsx')
SHEET = '全年(更新此表数据）'
FIRST_DATA_ROW = 4


def load_series(path=None):
    """取数策略：**基线（全量）打底，增量抓取结果叠加覆盖**。

    背景：全量抓取要请求 4 个时间分片，慢且易触发限流；历史值几乎不变，
    所以固化成基线（data/ppi_baseline.json）后，日常只需增量抓最近几期。
    这样下游脚本既能拿到完整历史，又能吃到最新月份。
    """
    ser = {}
    if path:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('series') or d.get('nbs') or {}
    if os.path.exists(BASELINE):
        with open(BASELINE, encoding='utf-8') as f:
            ser = {k: dict(v) for k, v in (json.load(f).get('nbs') or {}).items()}
        print('基线 %s：%d 个序列' % (os.path.basename(BASELINE), len(ser)))
    inc = os.path.join(OUT, 'nbs_ppi.json')
    if os.path.exists(inc):
        with open(inc, encoding='utf-8') as f:
            d = json.load(f)
        for k, v in (d.get('series') or {}).items():
            ser.setdefault(k, {}).update(v)
        ks = [x for k, v in (d.get('series') or {}).items() for x in v]
        if ks:
            print('增量 %s：%d 期（%s ~ %s）'
                  % (os.path.basename(inc), len(ks), min(ks), max(ks)))
    return ser

# 列 -> NBS 序列 key（列号写死，避免依赖 openpyxl）
COL2KEY = {
    4:  ('D', '家具制造业'),
    5:  ('E', '文教、工美、体育和娱乐用品制造业'),
    6:  ('F', '塑料制品'),
    7:  ('G', '通用设备制造业'),
    8:  ('H', '专用设备制造业'),
    9:  ('I', '电气机械及器材制造业'),
    10: ('J', '通信设备、计算机及其他电子设备制造业'),
    11: ('K', '仪器仪表制造业'),
    12: ('L', '中国:PPI:汽车整车制造'),
    13: ('M', '中国:PPI:汽车车身、挂车制造'),
}

# 各列在底稿中的既有数字格式（新增行时用；写入时不改已有格式）
DEFAULT_FMT = {
    12: '###,###,###,###,##0.00',
    13: '#,##0.00_ ',
}
FALLBACK_FMT = '#,##0.00'

XL_PASTE_FORMATS = -4122


def log(*a):
    print(*a)


def month_end(y, m):
    # datetime（而非 date）：pywin32 的 COM 属性写入只接受
    # pywintypes 可转换的值，datetime.date 会抛
    # "must be a pywintypes time object"。
    return datetime(y, m, calendar.monthrange(y, m)[1])


def pick_format(cur_fmt, col):
    """沿用底稿现有格式；若不含两位小数则补上"""
    f = str(cur_fmt or '')
    if '0.00' in f or '0.0;' in f:
        return None          # 已经两位小数，不动
    return DEFAULT_FMT.get(col, FALLBACK_FMT)


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    draft = DRAFT
    js = None          # 仅当显式 --json 时才直接读该文件，否则走「基线+增量」
    for i, a in enumerate(args):
        if a == '--draft' and i + 1 < len(args):
            draft = args[i + 1]
        if a == '--json' and i + 1 < len(args):
            js = args[i + 1]

    if not os.path.exists(draft):
        log('底稿不存在: %s' % draft)
        return 3

    nbs = load_series(js)
    if not nbs:
        log('没有可用的 PPI 数据。请先运行 nbs_ppi.py（或 ppi_baseline.py --build）')
        return 3
    try:
        import win32com.client as win32
        import pythoncom
    except Exception as ex:
        log('缺少 Windows WPS/Excel 原生编辑组件（pywin32）：%s' % ex)
        return 5
    log('底稿    : %s' % os.path.basename(draft))
    log()

    # ---------- 备份 ----------
    if not dry:
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        b, e = os.path.splitext(draft)
        backup = '%s-备份%s%s' % (b, stamp, e)
        try:
            shutil.copy2(draft, backup)
            sz = os.path.getsize(backup)
            log('已备份 -> %s (%.1f MB)' % (os.path.basename(backup), sz / 1048576.0))
        except Exception as ex:
            log('备份失败，中止: %s' % ex)
            return 4

    pythoncom.CoInitialize()
    app = None
    try:
        app = win32.DispatchEx('Excel.Application')
        app.Visible = False
        app.DisplayAlerts = False
        wb = app.Workbooks.Open(os.path.abspath(draft))
        ws = wb.Worksheets(SHEET)

        # ---------- 建立 (年,月) -> 行 映射 ----------
        used = ws.UsedRange
        last = used.Row + used.Rows.Count - 1
        rows = {}
        last_data_row = FIRST_DATA_ROW
        for r in range(FIRST_DATA_ROW, last + 1):
            y = ws.Cells(r, 2).Value
            m = ws.Cells(r, 3).Value
            if y is None or m is None:
                continue
            try:
                key = (int(y), int(m))
            except Exception:
                continue
            if key in rows:
                continue
            rows[key] = r
            last_data_row = max(last_data_row, r)
        log('底稿数据: %d 个 (年,月) 行, %s ~ %s (R%d)'
            % (len(rows), min(rows), max(rows), last_data_row))
        log()

        # ---------- 逐列写入 ----------
        added_rows = 0
        filled = 0
        fmt_fixed = 0
        font_fixed = 0
        per_col = {}
        skipped = []

        for col, (letter, key) in sorted(COL2KEY.items()):
            ser = nbs.get(key) or {}
            n = 0
            for ym, val in sorted(ser.items()):
                y, m = int(ym[:4]), int(ym[4:])
                r = rows.get((y, m))

                # 月底日期超出底稿范围 -> 新增一行（复制上期格式）
                if r is None:
                    if dry:
                        log('  %s 需新增行 %s-%s (底稿截止 %s)'
                            % (letter, y, m, max(rows)))
                        continue
                    r = last_data_row + 1
                    ws.Rows(last_data_row).Copy()
                    ws.Rows(r).PasteSpecial(Paste=XL_PASTE_FORMATS)
                    app.CutCopyMode = False
                    ws.Cells(r, 1).Value = month_end(y, m)
                    ws.Cells(r, 2).Value = y
                    ws.Cells(r, 3).Value = m
                    rows[(y, m)] = r
                    last_data_row = r
                    added_rows += 1

                cell = ws.Cells(r, col)
                cur = cell.Value
                try:
                    cur_n = float(cur) if cur is not None else None
                except Exception:
                    cur_n = None

                if cur_n is None or cur_n == 0:
                    if dry:
                        n += 1
                        continue
                    cell.Value = float(val)          # 数值型，不是文本
                    n += 1
                    filled += 1
                    # 字体：宋体 10 号
                    if str(cell.Font.Name) != '宋体':
                        cell.Font.Name = '宋体'
                        font_fixed += 1
                    if float(cell.Font.Size) != 10.0:
                        cell.Font.Size = 10
                        font_fixed += 1
                    # 数字格式：确保两位小数
                    nf = pick_format(cell.NumberFormat, col)
                    if nf:
                        cell.NumberFormat = nf
                        fmt_fixed += 1
                else:
                    try:
                        if abs(cur_n - float(val)) > 0.05:
                            skipped.append((letter, r, ym, cur_n, float(val)))
                    except Exception:
                        pass
            if n:
                per_col[letter] = n

        log('--- 写入明细 ---')
        for letter, n in sorted(per_col.items()):
            key = [k for c, (l, k) in COL2KEY.items() if l == letter][0]
            log('  %s %-32s 补 %d 处' % (letter, key[:30], n))
        log('  合计补 %d 处；新增行 %d；修正字体 %d 处；修正数字格式 %d 处'
            % (filled, added_rows, font_fixed, fmt_fixed))

        if skipped:
            log()
            log('底稿已有值且与 NBS 差异 >0.05 的格子 %d 个（未改动，供核对）：' % len(skipped))
            for letter, r, ym, cv, nv in skipped[:15]:
                log('   %s%-4d %s  底稿=%-8s NBS=%-8s' % (letter, r, ym, cv, nv))

        if dry:
            log()
            log('[--dry-run] 未写入任何文件')
            wb.Close(SaveChanges=False)
        else:
            app.CalculateFull()
            wb.Save()
            wb.Close(SaveChanges=False)
            log()
            log('已保存 -> %s' % draft)

        rep = {
            'draft': draft, 'filled': filled, 'added_rows': added_rows,
            'font_fixed': font_fixed, 'fmt_fixed': fmt_fixed,
            'per_col': per_col,
            'conflicts': len(skipped), 'dry_run': dry,
            'at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, 'ppi_apply_report.json'), 'w', encoding='utf-8') as f:
            json.dump(rep, f, ensure_ascii=False, indent=2)
        return 0
    finally:
        try:
            if app is not None:
                app.Quit()
        except Exception:
            pass
        pythoncom.CoUninitialize()


if __name__ == '__main__':
    sys.exit(main())
