# -*- coding: utf-8 -*-
"""
nbs_ppi.py — 从国家统计局抓取分行业 PPI（工业生产者出厂价格指数，上年同月=100）

背景
    data.stats.gov.cn 已于 2026-05 弃用旧的 easyquery.htm 接口（返回 403）。
    新接口在 /dg/website/publicrelease/web/external 下，采用 UUID + 时间分片：
      1. GET  new/queryIndexTreeAsync?pid=&code=1     目录树（code=1 月度数据）
      2. GET  new/queryIndicatorsByCid?cid=xxx        某数据集下的指标列表
      3. POST getEsDataByCidAndDt                     批量取数
    同一指标按 5 年切分到多个 cid，需分别请求后本地拼接。

目标指标（老板口径，来源于「分行业工业生产者出厂价格指数(上年同月=100)」）
    家具制造业 / 文教、工美、体育和娱乐用品制造业 / 塑料制品 / 通用设备制造业 /
    专用设备制造业 / 电气机械和器材制造业 / 计算机、通信和其他电子设备制造业 /
    仪器仪表制造业
    另需「分行业中类」里的：汽车整车制造 / 汽车车身、挂车制造

用法
    python nbs_ppi.py                 # 抓取并输出 _out/nbs_ppi.json + .csv
    python nbs_ppi.py --list          # 只列出可用 cid 与指标，不取数
    python nbs_ppi.py --since 1996
"""
import os
import re
import sys
import json
import time
import warnings
from datetime import datetime

warnings.filterwarnings('ignore')
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import requests

BASE = os.environ.get('FA_WORKSPACE') or os.getcwd()
OUT = os.path.join(BASE, '_out')
API = 'https://data.stats.gov.cn/dg/website/publicrelease/web/external'
ROOT_ID = 'fc982599aa684be7969d7b90b1bd0e84'      # 月度数据根节点
NATION = [{'text': '全国', 'value': '000000000000'}]
REQ_GAP = 1.2        # 每次请求的最小间隔（秒）——NBS 请求过密会触发 JS 人机验证

S = requests.Session()
S.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://data.stats.gov.cn/dg/website/page.html',
    'Content-Type': 'application/json',
})

# 目标行业 -> 用于匹配 i_showname 的关键词
INDUSTRIES = {
    '家具制造业': ['家具制造业'],
    '文教、工美、体育和娱乐用品制造业': ['文教、工美、体育和娱乐用品制造业'],
    # 「塑料制品」底稿用的是**中类细分**的「塑料制品业」，
    # 而非大类「橡胶和塑料制品业」——实测两者差 0.8~1.0，走 MIDCLASS 取
    '塑料制品': ['塑料制品业'],
    '通用设备制造业': ['通用设备制造业'],
    '专用设备制造业': ['专用设备制造业'],
    '电气机械及器材制造业': ['电气机械和器材制造业', '电气机械及器材制造业'],
    '通信设备、计算机及其他电子设备制造业': ['计算机、通信和其他电子设备制造业',
                                              '通信设备、计算机及其他电子设备制造业'],
    '仪器仪表制造业': ['仪器仪表制造业'],
}
# 中类（汽车）关键词
MIDCLASS = {
    '中国:PPI:汽车整车制造': ['汽车整车制造'],
    '中国:PPI:汽车车身、挂车制造': ['汽车车身、挂车制造'],
    # 中类细分：橡胶和塑料制品业 -> 塑料制品业（底稿用的是这个细分口径）
    '塑料制品': ['塑料制品业'],
}


def parse_json(r):
    """NBS 的响应头不可信：正常数据也可能标成 Content-Type: text/html。
    唯一可靠的判据是 **body 能否 json.loads**。
    真正被限流时 body 是 '<html>... Please enable JavaScript ...'（非 JSON）。
    返回 (对象, 状态描述)。"""
    try:
        return json.loads(r.text), 'ok'
    except Exception:
        body = (r.text or '')[:160].replace('\n', ' ')
        if 'enable JavaScript' in body or '<html' in body.lower():
            return None, 'BLOCKED(JS挑战)'
        return None, 'not-json:%s' % body


def _get(path, **params):
    """带节流的 GET。NBS 对请求频率敏感，过密会返回 JS 人机验证页。"""
    for i in range(4):
        try:
            time.sleep(REQ_GAP)
            r = S.get(API + path, params=params, timeout=30)
            j, st = parse_json(r)
            if j is not None:
                return j
            if i == 3:
                print('      GET %s 失败: http=%s ct=%s %s'
                      % (path, r.status_code, str(r.headers.get('Content-Type', ''))[:24], st))
                return {}
            if 'BLOCKED' in st:
                time.sleep(20)
        except Exception:
            if i == 3:
                return {}
        time.sleep(3 + i * 3)
    return {}


def tree(pid, code='1'):
    return _get('/new/queryIndexTreeAsync', pid=pid, code=code).get('data') or []


def find_leaves(keyword, include_dirs=False):
    """在「价格指数」分支下找名字含 keyword 的节点。

    include_dirs=True 时同时返回命中的目录节点——中类 PPI 的
    「(2018-至今)」就是目录（isLeaf=False），须再下钻一层才到指标集。
    """
    lvl1 = tree(ROOT_ID)
    price = next((n for n in lvl1 if '价格指数' in str(n.get('name'))), None)
    if not price:
        return []
    out = []
    stack = [price['_id']]
    seen = 0
    while stack and seen < 400:
        pid = stack.pop(0)
        for n in tree(pid):
            seen += 1
            nm = str(n.get('name') or '')
            leaf = bool(n.get('isLeaf'))
            if keyword in nm:
                if leaf or include_dirs:
                    out.append({'name': nm, '_id': n['_id'], 'isLeaf': leaf,
                                'sdate': n.get('sdate'), 'edate': n.get('edate')})
                if not leaf:
                    stack.append(n['_id'])
            elif not leaf and any(
                    k in nm for k in ['工业生产者出厂价格指数', '分行业', '价格指数']):
                stack.append(n['_id'])
            time.sleep(0.05)
    return out


def indicators(cid):
    j = _get('/new/queryIndicatorsByCid', cid=cid, dt='', name='')
    return (j.get('data') or {}).get('list') or []


def fetch(cid, ind_ids, dts, root_id=ROOT_ID):
    body = {
        'cid': cid, 'indicatorIds': ind_ids, 'das': NATION,
        'dts': dts, 'showType': '1', 'rootId': root_id,
    }
    for i in range(3):
        try:
            time.sleep(REQ_GAP)
            # 注意：多数文档写的是 /getEsDataByCidAndDt，但该路径实测已 404。
            # NBS 近年多次改端点名，当前（2026-09 实测）有效端点为 /stream/esData。
            r = S.post(API + '/stream/esData', data=json.dumps(body),
                       timeout=60)
            j, st = parse_json(r)
            if j is not None:
                return j
            if i == 2:
                print('      fetch FAILED http=%s ct=%s dts=%s %s' % (
                    getattr(r, 'status_code', '?'),
                    str(r.headers.get('Content-Type', ''))[:24],
                    body.get('dts'), st))
                return {'data': []}
            if 'BLOCKED' in st:
                time.sleep(20)
        except Exception:
            if i == 2:
                return {'data': []}
        time.sleep(2)
    return {'data': []}


def main():
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    list_only = '--list' in args
    use_plan = '--use-plan' in args
    recent = None
    since = None
    for i, a in enumerate(args):
        if a == '--recent' and i + 1 < len(args):
            recent = int(args[i + 1])
        if a == '--since' and i + 1 < len(args):
            since = args[i + 1]

    # --recent N：只抓最近 N 个月（含当月）。历史值不会变，日常无需重抓全量。
    # 自动启用 --use-plan 复用 cid/indicatorId 缓存，把请求数从上百次压到十余次。
    if recent:
        now = datetime.now()
        cur = now.year * 12 + (now.month - 1) - recent + 1
        since = '%04d%02d' % (cur // 12, cur % 12 + 1)
        use_plan = True

    print('=' * 78)
    print('国家统计局 分行业 PPI（上年同月=100）')
    if since:
        print('增量模式：只抓 %s 及之后%s' % (since, ('（近 %d 期）' % recent) if recent else ''))
    else:
        print('全量模式：抓取全部时间分片')
    print('=' * 78)

    plan_file = os.path.join(OUT, 'nbs_ppi_plan.json')
    plan = []
    span = {}
    from_cache = False
    if use_plan and os.path.exists(plan_file):
        try:
            cached = json.load(open(plan_file, encoding='utf-8'))
        except Exception:
            cached = []
        if cached:
            from_cache = True
            for x in cached:
                plan.append((x['cid'], x['key'], x['indicator'],
                             x.get('name') or x['key']))
                span[x['cid']] = (x.get('sdate'), x.get('edate'))
            print('\n复用缓存的 cid/indicatorId：%d 条，跳过目录树遍历' % len(plan))

    if not from_cache:
        run_discovery(plan, span)

    if list_only:
        print('\n[--list] 仅列示，未取数')
        save_plan(plan_file, plan, span)
        return

    # ---- 增量筛选：丢掉结束期早于 since 的时间分片 ----
    if since:
        before = len(plan)
        plan = [p for p in plan
                if str(span.get(p[0], (None, '999999'))[1] or '999999')[:6] >= since]
        print('\n增量筛选：%d 条 -> %d 条（仅保留分片截止 >= %s）'
              % (before, len(plan), since))
        if not plan:
            print('没有覆盖 %s 之后的分片，请去掉 --recent/--since 走全量' % since)
            return

    if not from_cache:
        save_plan(plan_file, plan, span)

    fetch_series(plan, span, since, plan_file)


def run_discovery(plan, span):
    """全量发现：遍历目录树，定位分片与其指标。把 cid/iid 写进 plan、范围写进 span。"""
    # ---- 1. 定位「分行业…(上年同月=100)」的 4 个时间分片 ----
    leaves = find_leaves('分行业工业生产者出厂价格指数 (上年同月=100)')
    # 排除「上年同期」「上月」等干扰
    leaves = [l for l in leaves if '上年同月' in l['name']]
    leaves = sorted({l['_id']: l for l in leaves}.values(), key=lambda x: str(x['sdate']))
    print('\n分行业 PPI 时间分片:')
    for l in leaves:
        print('   %-52s %s ~ %s' % (l['name'][:50], l['sdate'], l['edate']))

    # ---- 2. 每个分片查指标，匹配目标行业 ----
    for l in leaves:
        lst = indicators(l['_id'])
        print('\n  cid %s (%s~%s) 指标数 %d' % (l['_id'][:12], l['sdate'], l['edate'], len(lst)))
        for key, aliases in INDUSTRIES.items():
            for it in lst:
                nm = str(it.get('i_showname') or '')
                if any(a in nm for a in aliases):
                    plan.append((l['_id'], key, it['_id'], nm))
                    print('     [%s] %s -> %s' % (key[:12], nm[:40], it['_id'][:12]))
                    break

    # ---- 3. 中类（汽车整车 / 汽车车身挂车）----
    #    中类节点是目录，须下钻一层才到指标集
    mids = find_leaves('分行业中类工业生产者出厂价格指数 (上年同月=100)', include_dirs=True)
    mid = []
    for m in mids:
        if m.get('isLeaf'):
            mid.append(m)
        else:
            for sub in tree(m['_id']):
                if sub.get('isLeaf'):
                    mid.append({'name': '%s / %s' % (m['name'], sub.get('name')),
                                '_id': sub['_id'], 'sdate': sub.get('sdate'),
                                'edate': sub.get('edate'), 'isLeaf': True})
            time.sleep(0.2)
    mid = sorted({m['_id']: m for m in mid}.values(),
                 key=lambda x: (str(x.get('sdate')), str(x.get('name'))))
    print('\n分行业中类 PPI 时间分片 (%d 个):' % len(mid))
    for m in mid[:12]:
        print('   %-56s %s ~ %s' % (str(m.get('name'))[:54], m.get('sdate'), m.get('edate')))
    for m in mid:
        lst = indicators(m['_id'])
        for key, aliases in MIDCLASS.items():
            for it in lst:
                nm = str(it.get('i_showname') or '')
                if not any(a in nm for a in aliases):
                    continue
                # 「塑料制品业」须排除大类「橡胶和塑料制品业」——两者差 0.8~1.0
                if key == '塑料制品' and '橡胶' in nm:
                    continue
                plan.append((m['_id'], key, it['_id'], nm))
                print('     [%s] %s -> %s' % (key[:16], nm[:40], it['_id'][:12]))
                break

    for l in list(leaves) + list(mid):
        span[l['_id']] = (l.get('sdate'), l.get('edate'))


def save_plan(path, plan, span):
    """把 cid/indicatorId 连同分片范围缓存下来，供下次增量抓取复用。"""
    try:
        recs = []
        seen = set()
        for cid, key, iid, nm in plan:
            k = (cid, key)
            if k in seen:
                continue
            seen.add(k)
            sd, ed = span.get(cid, (None, None))
            recs.append({'cid': cid, 'key': key, 'indicator': iid,
                         'name': nm, 'sdate': sd, 'edate': ed})
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
        print('cid/indicatorId 已缓存 -> %s (%d 条)' % (os.path.basename(path), len(recs)))
    except Exception as e:
        print('缓存计划失败（不影响本次结果）: %s' % e)


def fetch_series(plan, span, since, plan_file):
    # ---- 4. 取数 ----
    series = {}     # key -> {yyyymm: value}
    # 按各分片**自身**的时间范围请求。若统一用全范围，超出分片边界的部分会漏数
    # （实测 2007-2013 分片统一请求只回 48 条，按其范围请求可得 84 条）
    # 增量模式下，起始端取 since 与分片起点中较晚者，进一步缩短区间。
    never = 0
    for cid, key, iid, nm in plan:
        sd, ed = span.get(cid, (None, None))
        sy = str(sd)[:4] if sd else '2007'
        ey = str(ed)[:4] if ed else '2026'
        dts = ['%s01MM-%s12MM' % (sy, ey)]
        if since:
            s_ym = str(sd)[:6] if sd else '200701'
            lo = max(since, s_ym)
            dts = ['%sMM-%s12MM' % (lo, ey)]
        r = fetch(cid, [iid], dts)
        data = r.get('data') or []
        got = 0
        for rec in data:
            code = str(rec.get('code') or '')
            m = re.match(r'^(\d{6})MM$', code)
            if not m:
                continue
            ym = m.group(1)
            for v in (rec.get('values') or []):
                if v.get('_id') == iid and v.get('value') not in (None, ''):
                    series.setdefault(key, {})[ym] = v['value']
                    got += 1
        if got == 0:
            never += 1
        print('   取数 %-30s %-10s %s -> %d 条' % (key[:28], cid[:10], dts[0][:13], got))
        time.sleep(0.4)

    if never and len(plan) and never == len(plan):
        print('\n⚠️ 全部取数为空——缓存的分片很可能已失效。'
              '请删掉 %s 后重跑（或加 --use-plan 以外的参数走全量发现）'
              % os.path.basename(plan_file))

    out = {
        'source': API,
        'note': '分行业工业生产者出厂价格指数(上年同月=100)，国家统计局月度数据',
        'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'since': since,
        'series': {k: dict(sorted(v.items())) for k, v in series.items()},
    }
    jp = os.path.join(OUT, 'nbs_ppi.json')
    with open(jp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('\n抓取完成 -> %s' % jp)
    for k, v in out['series'].items():
        ks = sorted(v.keys())
        print('   %-34s %4d 条  %s ~ %s' % (k[:32], len(v), ks[0] if ks else '-', ks[-1] if ks else '-'))


if __name__ == '__main__':
    main()
