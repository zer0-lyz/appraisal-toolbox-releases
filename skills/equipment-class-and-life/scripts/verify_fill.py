#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设备分类与年限回填自检脚本（equipment-class-and-life 技能配套）

用法:
  python verify_fill.py <工作簿路径> [已认可历史输出.tsv]

检查项:
  1) 空值行(7列任一为空)  2) 大类白名单  3) 区间格式 d-d 且不倒挂
  4) 年限∈区间          5) 同种(基名去括号+同义词)组内 分类/年限/区间 一致
可选: 传第二参数(已认可历史输出 tsv，列: row name cat idx years rng src ...)
     则按基名比对重叠设备的 分类/大类/年限/区间，报告差异。

运行环境: D:\\Anaconda3\\python.exe（用户硬性规定）
"""
import re
import sys
import collections

ALLOWED = {
    "家具", "文教、工美、体育和娱乐用品", "塑料制品", "通用设备", "专用设备",
    "电气机械及器材", "通信设备、计算机及其他电子设备", "仪器仪表",
}
# 同义词映射：基名 -> 归一化组名（多批次累积，与 references/values.md 第五节同步）
SYN = {
    "班台": "班台/大班桌", "大班桌": "班台/大班桌", "大班台": "班台/大班桌",
    "沥青混凝土搅拌机": "沥青混凝土搅拌机/自动混合料拌合机",
    "自动混合料拌合机": "沥青混凝土搅拌机/自动混合料拌合机",
    "1+1+3沙发": "沙发",
    "电子汽车衡": "地磅", "地磅": "地磅",
    "人员通道设备": "门禁设备", "通道闸机": "门禁设备",
    "桁车": "起重设备/行车", "行车": "起重设备/行车",
    "卸车拉断阀": "阀门/拉断阀", "拉断阀": "阀门/拉断阀",
}
# 后缀归组：基名含该词即归为同名组（用于"XX（站点）"式同种设备）
SUFFIX = ["气化站", "防护服"]
DEFAULT_SHEET = "AI设备分类与年限"


def group_key(b):
    if b in SYN:
        return SYN[b]
    for s in SUFFIX:
        if s in b:
            return s
    return b


def base(name):
    s = re.sub(r"[（(].*?[）)]", "", str(name))   # 去掉括号内编号
    s = re.sub(r"[\s　*]", "", s)
    return s


def load_workbook(path, sheet_name=None):
    import openpyxl
    wb = openpyxl.load_workbook(path)
    requested = str(sheet_name or DEFAULT_SHEET).strip()
    ws = wb[requested] if requested in wb.sheetnames else wb[wb.sheetnames[0]]
    rows = []
    for r in range(2, ws.max_row + 1):
        v = [ws.cell(row=r, column=c).value for c in range(1, 8)]
        if v[0] is None and v[1] is None:
            continue
        rows.append(dict(seq=v[0], name=str(v[1]), cat=v[2], maj=v[3],
                         yrs=v[4], rng=str(v[5]) if v[5] is not None else None,
                         src=v[6]))
    return rows


def check(rows):
    issues = []
    groups = collections.defaultdict(list)
    for i, x in enumerate(rows):
        seq = x["seq"]
        if any(x[k] is None or str(x[k]).strip() == "" for k in ("cat", "maj", "yrs", "rng", "src")):
            issues.append(f"行{seq} 存在空值: {x['name']}")
        if x["maj"] not in ALLOWED:
            issues.append(f"行{seq} 大类越界: {x['maj']} ({x['name']})")
        if x["rng"]:
            m = re.match(r"^(\d+)-(\d+)$", x["rng"])
            if not m:
                issues.append(f"行{seq} 区间格式异常: {x['rng']}")
            else:
                lo, hi = int(m.group(1)), int(m.group(2))
                if lo > hi:
                    issues.append(f"行{seq} 区间倒挂: {x['rng']}")
                try:
                    y = int(x["yrs"])
                    if not (lo <= y <= hi):
                        issues.append(f"行{seq} 年限{y}不在区间{x['rng']}内 ({x['name']})")
                except (TypeError, ValueError):
                    issues.append(f"行{seq} 年限非整数: {x['yrs']}")
        g = group_key(base(x["name"]))
        groups[g].append(x)
    for g, xs in groups.items():
        if len(xs) < 2:
            continue
        sig = {(x["cat"], x["maj"], x["yrs"], x["rng"]) for x in xs}
        if len(sig) > 1:
            issues.append(f"同种组[{g}]×{len(xs)} 口径不一致: {sig}")
    return issues, groups


def cross_compare(cur, tsv):
    old = collections.defaultdict(list)
    for line in open(tsv, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) < 7 or p[1] == "name":
            continue
        try:
            yrs = int(float(p[4]))
        except (TypeError, ValueError):
            continue
        old[base(p[1])].append((p[2], p[3], yrs, p[5]))
    curmap = {}
    for x in cur:
        curmap.setdefault(base(x["name"]), x)
    diffs = []
    for b, x in curmap.items():
        if b not in old:
            continue
        o = old[b][0]
        if (o[0], o[1], o[2], o[3]) != (x["cat"], x["maj"], int(x["yrs"]), x["rng"]):
            diffs.append((b, (x["cat"], x["maj"], x["yrs"], x["rng"]), o))
    return diffs


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    args = sys.argv[1:]
    sheet_name = DEFAULT_SHEET
    positional = []
    i = 0
    while i < len(args):
        if args[i] == "--sheet" and i + 1 < len(args):
            sheet_name = args[i + 1]
            i += 2
            continue
        positional.append(args[i])
        i += 1
    if not positional:
        print(__doc__)
        sys.exit(2)
    rows = load_workbook(positional[0], sheet_name)
    issues, groups = check(rows)
    print(f"设备行数: {len(rows)}")
    multi = {g: xs for g, xs in groups.items() if len(xs) > 1}
    print(f"多台同种组数: {len(multi)}")
    if issues:
        print(f"发现问题 {len(issues)} 项:")
        for it in issues:
            print(" -", it)
        sys.exit(1)
    print("自检通过：0 空值 / 大类白名单合法 / 区间合法且年限∈区间 / 同种组口径一致")
    if len(positional) > 1:
        diffs = cross_compare(rows, positional[1])
        if diffs:
            print(f"跨批次差异 {len(diffs)} 项：")
            for b, c, o in diffs:
                print(f" [{b}] 本次{c} vs 历史{o}")
        else:
            print("跨批次比对通过：重叠同名设备口径 0 差异")
    sys.exit(0)


if __name__ == "__main__":
    main()
