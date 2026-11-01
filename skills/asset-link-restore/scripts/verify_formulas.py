# -*- coding: utf-8 -*-
"""用 formulas 引擎真实重算输出文件，与原始静态值逐格比对（SUBTOTAL 单元格标注引擎限制）"""
import sys
import formulas, openpyxl

OUT = sys.argv[1] if len(sys.argv) > 1 else '浙江省二轻集团有限责任公司-明细表_链接恢复.xlsx'
SRC = sys.argv[2] if len(sys.argv) > 2 else '浙江省二轻集团有限责任公司-明细表.xlsx'
AMOUNT_TOL, RATE_TOL = 0.01, 0.01

PREFIX = f"'[{OUT}]"

xl = formulas.ExcelModel().loads(OUT).finish()
sol = xl.calculate()

def get_calc(sheet, coord):
    k = f"{PREFIX}{sheet}'!{coord}"
    v = sol.get(k)
    if v is None:
        return None
    sv = str(v)
    if '#NAME' in sv or '#REF' in sv:
        return '__ENGINE_LIMIT__'
    try:
        arr = v.value
        if hasattr(arr, 'flat'):   # numpy.ndarray / formulas Array
            for item in arr.flat:
                if isinstance(item, (int, float)) and not isinstance(item, bool):
                    return float(item)
            return None
        if isinstance(arr, (list, tuple)):
            for row in arr:
                for cell in row:
                    if isinstance(cell, (int, float)):
                        return float(cell)
            return None
        return float(arr)
    except Exception:
        return None

wbv = openpyxl.load_workbook(SRC, data_only=True)

specs = []
for s in ('1-汇总表',):
    for col in 'DEFG':
        specs.append((s, col, 8, 31))
for s in ('2-分类汇总',):
    for col in 'CDEF':
        specs.append((s, col, 7, 66))
for s, r2 in (('3-流动资产汇总', 27), ('4-非流动资产汇总', 28), ('5-流动负债汇总', 28), ('6-非流动负债汇总', 28)):
    for col in 'DEFG':
        specs.append((s, col, 7, r2))
for s, r2 in (('3-1货币资金汇总表', 24), ('3-8其他应收款汇总', 26), ('3-9存货汇总', 23),
              ('4-6其他非流动金融资产汇总', 25), ('4-7投资性房地产汇总', 22), ('4-8固定资产汇总', 20),
              ('4-9在建工程汇总', 26), ('4-13无形资产汇总', 25), ('5-10其他应付款汇总表', 27)):
    for col in 'DEFG':
        specs.append((s, col, 7, r2))

ok = lim = bad = 0
bad_list = []
for sheet, col, r1, r2 in specs:
    for r in range(r1, r2 + 1):
        coord = f"{col}{r}"
        calc = get_calc(sheet, coord)
        orig = wbv[sheet][coord].value
        if calc is None:
            continue
        if calc == '__ENGINE_LIMIT__':
            lim += 1
            continue
        try:
            orig_f = float(orig) if orig is not None else None
        except (TypeError, ValueError):
            orig_f = None
        if orig_f is None:
            ok2 = abs(calc) <= AMOUNT_TOL
        else:
            tol = RATE_TOL if col in ('F', 'G') else AMOUNT_TOL
            ok2 = abs(calc - orig_f) <= tol
        if ok2:
            ok += 1
        else:
            bad += 1
            bad_list.append((sheet, coord, calc, orig))

print(f"重算比对：一致 {ok}，引擎限制(SUBTOTAL等) {lim}，不一致 {bad}")
for sheet, coord, calc, orig in bad_list[:30]:
    print(f"  [不一致] {sheet}!{coord}: 计算值={calc} 原值={orig}")
