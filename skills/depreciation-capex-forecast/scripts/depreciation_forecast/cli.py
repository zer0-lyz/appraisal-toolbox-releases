from __future__ import annotations

import argparse
from pathlib import Path

from .workbook import create_template, run_workbook


TEMPLATE_FILENAME = "折旧摊销预测输入模板.xlsx"


def _default_template_path() -> Path:
    return Path.home() / "Downloads" / TEMPLATE_FILENAME


def _default_input_candidates() -> tuple[Path, ...]:
    return (
        _default_template_path(),
        Path("outputs/折旧摊销预测输入模板.xlsx"),
        Path("outputs/折旧摊销预测示例输入.xlsx"),
    )


def _resolve_default_input() -> Path:
    for candidate in _default_input_candidates():
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "未找到默认输入文件。请优先准备以下任一文件："
        + "、".join(str(path) for path in _default_input_candidates())
    )


def _resolve_template_output(raw_output: str | None) -> Path:
    if raw_output is None or not raw_output.strip():
        return _default_template_path()
    raw_output = raw_output.strip()
    output = Path(raw_output).expanduser()
    if output.suffix:
        return output
    return output / TEMPLATE_FILENAME


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="折旧摊销与资本性支出详细预测工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    template = subparsers.add_parser("template", help="生成 Excel 输入模板")
    template.add_argument("--output", help="输出模板路径；留空时默认生成到 ~/Downloads/折旧摊销预测输入模板.xlsx")
    template.add_argument("--with-scenarios", action="store_true", help="将原型中的测试情形写入模板")
    template.add_argument("--prototype", help="原型工作簿路径")

    run = subparsers.add_parser("run", help="运行预测")
    run.add_argument("--input", help="输入模板路径；不填时自动使用默认输入文件")
    run.add_argument("--output", help="输出结果路径；不填时默认回写到输入文件本身")
    run.add_argument(
        "--include-details",
        "--include-monthly",
        action="store_true",
        dest="include_details",
        help="验证模式：同时生成资产结果明细（年度）和资产结果明细（月度）",
    )
    run.add_argument("--detail-asset-id", help="输出指定资产的详细计算过程 Sheet（按资产序号/编号匹配）")
    run.add_argument("--detail-asset-kind", choices=["存量", "新增"], help="与 detail-asset-id 一起使用，限定资产类别")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "template":
        output_path = _resolve_template_output(args.output)
        output = create_template(
            output_path,
            include_scenarios=args.with_scenarios,
            prototype_path=args.prototype,
        )
        print(f"已生成模板：{Path(output).resolve()}")
        return 0
    input_path = Path(args.input) if args.input else _resolve_default_input()
    output_path = Path(args.output) if args.output else input_path
    output = run_workbook(
        input_path,
        output_path,
        include_details=args.include_details,
        detail_asset_id=args.detail_asset_id,
        detail_asset_kind=args.detail_asset_kind,
    )
    print(f"使用输入文件：{input_path.resolve()}")
    if output_path.resolve() == input_path.resolve():
        print("输出方式：回写到同一输入文件")
    print(f"已生成预测结果：{Path(output).resolve()}")
    return 0
