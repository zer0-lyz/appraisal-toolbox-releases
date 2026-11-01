# -*- coding: utf-8 -*-
"""
verify_ppi.py — 把抓取到的 NBS PPI 数据与底稿「全年(更新此表数据）」逐月比对

输出
    · 每列的对比结果：一致 / 不一致 / 底稿缺 / 抓取缺
    · 差异明细（年-月、底稿值、NBS 值）
    · 可直接用于回填的"待补清单"

用法
    python verify_ppi.py [--draft 底稿路径] [--json nbs_ppi.json]
"""
import os
import re
import sys
import json
import warnings

warnings.filterwarnings('ignore')
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import openpyxl
from openpyxl.utils import get_column_letter as L

BASE = os.environ.get('FA_WORKSPACE') or os.getcwd()
OUT = os.path.join(BASE, '_out')
DRAFT = os.environ.get('FA_DRAFT') or os.path.join(
    BASE, '固定资产底稿模板', 'XXX公司-固定资产设备底稿-V1.0.xlsx')
SHEET = '全年(更新此表数据）'

# 底稿列 -> nbs_ppi.json 里的指标键
COL2KEY = {
    'D': '家具制造业',
    'E': '文教、工美、体育和娱乐用品制造业',
    'F': '塑料制品',
    'G': '通用设备制造业',
    'H': '专用设备制造业',
    'I': '电气机械及器材制造业',
    'J': '通信设备、计算机及其他电子设备制造业',
    'K': '仪器仪表制造业',
    'L': '中国:PPI:汽车整车制造',
    'M': '中国:PPI:汽车车身、挂车制造',
}


def num(v):
    try:
        return float(v)
    except Exception:
        return None


def load_series(path=None):
    """基线（全量）打底，增量结果叠加——与 apply_ppi_to_draft.py 保持一致。

    历史值几乎不变，固化成基线后日常只需增量抓最近几期，这样既能拿到
    完整历史，又能吃到最新月份。
    """
    if path:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d.get('series') or d.get('nbs') or {}
    ser = {}
    bp = os.environ.get('FA_BASELINE') or os.path.join(BASE, 'data', 'ppi_baseline.json')
    if os.path.exists(bp):
        with open(bp, encoding='utf-8') as f:
            ser = {k: dict(v) for k, v in (json.load(f).get('nbs') or {}).items()}
        print('基线 %s：%d 个序列' % (os.path.basename(bp), len(ser)))
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


def main():
    js = None
    for a in sys.argv:
        if a.endswith('.json') and os.path.exists(a):
            js = a
    if not os.path.exists(DRAFT):
        print('底稿不存在: %s' % DRAFT)
        return

    nbs = load_series(js)
    if not nbs:
        print('没有可用的 PPI 数据，请先运行 nbs_ppi.py')
        return
    for k, v in nbs.items():
        ks = sorted(v.keys())
        print('   %-36s %4d 条  %s ~ %s' % (k[:34], len(v), ks[0], ks[-1]))

    wb = openpyxl.load_workbook(DRAFT)
    ws = wb[SHEET]

    # 读底稿 (年,月) -> 行号
    rows = {}
    for r in range(4, ws.max_row + 1):
        y, m = ws.cell(r, 2).value, ws.cell(r, 3).value
        if y is None or m is None:
            continue
        try:
            rows[(int(y), int(m))] = r
        except Exception:
            pass
    print('\n底稿共 %d 个 (年,月) 行：%s ~ %s'
          % (len(rows), min(rows), max(rows)))

    summary = []
    diffs = []
    fills = []          # (row, col, ym, value) 待回填
    print('\n' + '=' * 96)
    print('%-3s %-32s %6s %6s %6s %6s %6s' % ('列', '指标', '可比', '一致', '不一致', '稿缺', 'NBS缺'))
    print('-' * 96)

    for col, key in COL2KEY.items():
        ser = nbs.get(key) or {}
        if not ser:
            print('%-3s %-32s  NBS 无数据' % (col, key[:30]))
            continue
        same = diff = miss_in_draft = miss_in_nbs = 0
        for ym, val in ser.items():
            y, m = int(ym[:4]), int(ym[4:6])
            r = rows.get((y, m))
            if r is None:
                miss_in_draft += 1
                continue
            cur = ws['%s%d' % (col, r)].value
            cn, vn = num(cur), num(val)
            if cn is None or cn == 0:
                miss_in_draft += 1
                fills.append((r, col, ym, val))
            elif vn is not None and abs(cn - vn) > 0.005:
                diff += 1
                diffs.append((col, key, ym, cn, vn, r))
            else:
                same += 1
        # 底稿有、NBS 没有的
        for (y, m), r in rows.items():
            ym = '%04d%02d' % (y, m)
            if ym not in ser:
                cur = num(ws['%s%d' % (col, r)].value)
                if cur:
                    miss_in_nbs += 1
        summary.append((col, key, same, diff, miss_in_draft, miss_in_nbs))
        print('%-3s %-32s %6d %6d %6d %6d %6d'
              % (col, key[:30], same + diff, same, diff, miss_in_draft, miss_in_nbs))

    print('=' * 96)
    print('\n合计：一致 %d / 不一致 %d / 底稿缺失(可回填) %d'
          % (sum(s[2] for s in summary), sum(s[3] for s in summary),
             sum(s[4] for s in summary)))

    if diffs:
        print('\n--- 数值不一致明细（前 30 条）---')
        for col, key, ym, cv, nv, r in diffs[:30]:
            print('   %s%s  %s  %-26s 底稿=%-9s NBS=%s'
                  % (col, r, ym, key[:24], cv, nv))
    if len(diffs) > 30:
        print('   ... 另有 %d 条' % (len(diffs) - 30))

    rep = {
        'summary': [{'col': c, 'key': k, 'same': s, 'diff': d, 'missing': m, 'nbs_missing': nm}
                    for c, k, s, d, m, nm in summary],
        'diffs': [{'col': c, 'key': k, 'ym': ym, 'draft': cv, 'nbs': nv, 'row': r}
                  for c, k, ym, cv, nv, r in diffs],
        'fills': [{'row': r, 'col': c, 'ym': ym, 'value': v} for r, c, ym, v in fills],
    }
    rp = os.path.join(OUT, 'ppi_verify.json')
    os.makedirs(OUT, exist_ok=True)      # 首次运行 _out/ 尚不存在，须先建目录
    with open(rp, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
    print('\n核实报告 -> %s' % rp)


if __name__ == '__main__':
    main()
