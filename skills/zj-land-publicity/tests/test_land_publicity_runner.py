import os
import json
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from land_publicity_runner import (
    OUTPUT_COLUMNS, _land_use_categories, _land_use_matches_request, _list_record_matches_request,
    _list_server_filters, _plot_ratio_text, _website_server_filters, enrich_record, filter_records, row_from_item, validate_request,
    write_excel, write_result_html,
)
from scrape_zj_land import build_map_assets, fetch_records, fetch_region_codes


class JSONResponseFixture:
    status_code = 200
    headers = {"Content-Type": "application/json"}

    def raise_for_status(self):
        pass

    @property
    def text(self):
        payload = {"code": 0, **self.json()}
        if isinstance(payload.get("data"), dict) and "records" in payload["data"]:
            payload["data"].setdefault("total", 1000)
        return json.dumps(payload, ensure_ascii=False)


class LandPublicityDateTests(unittest.TestCase):
    def test_server_filters_use_region_tree_and_publish_window(self):
        request = {"district": "宁波市", "location": "镇海区", "provinceWide": False, "startDate": "2025-01-01", "endDate": "2025-01-31"}
        filters = _list_server_filters(request)
        self.assertEqual(filters["regionName"], "镇海区")
        self.assertEqual(filters["fallbackRegionName"], "宁波市")
        self.assertEqual(filters["enrollStartTime"], 1735660800000)
        self.assertEqual(filters["nowTime"], 1738339199999)

    def test_region_tree_resolves_all_descendant_codes(self):
        class Response(JSONResponseFixture):
            def json(self):
                return {"data": [{"districtName": "浙江省", "districtCode": "330000", "children": [
                    {"districtName": "宁波市", "districtCode": "330200", "children": [
                        {"districtName": "镇海区", "districtCode": "330211", "children": []},
                    ]},
                ]}]}

        with patch("scrape_zj_land.requests.get", return_value=Response()):
            self.assertEqual(fetch_region_codes("宁波市"), ["330200", "330211"])

    def test_server_filters_are_sent_to_publicity_list(self):
        calls = []

        class Response(JSONResponseFixture):
            def json(self):
                return {"data": {"records": []}}

        with patch("scrape_zj_land.requests.get", side_effect=lambda url, **kwargs: (calls.append(url) or Response())):
            fetch_records(
                max_pages=1,
                server_filters={
                    "regionCode": "330200,330211",
                    "publishStartTime": 1735660800000,
                    "publishEndTime": 1738339199999,
                },
            )

        self.assertEqual(len(calls), 1)
        self.assertIn("regionCode=330200%2C330211", calls[0])
        self.assertIn("publishStartTime=1735660800000", calls[0])
        self.assertIn("publishEndTime=1738339199999", calls[0])

    def test_county_region_takes_precedence_over_city_fallback(self):
        calls = []

        class Response(JSONResponseFixture):
            def json(self):
                return {"data": {"records": []}}

        with patch("scrape_zj_land.fetch_region_codes", return_value=["330211"]), patch(
            "scrape_zj_land.requests.get", side_effect=lambda url, **kwargs: (calls.append(url) or Response())
        ):
            fetch_records(max_pages=1, server_filters={"regionName": "镇海区", "fallbackRegionName": "宁波市"})

        self.assertIn("regionCode=330211", calls[0])

    def test_official_land_use_codes_cover_all_four_categories(self):
        fixtures = [
            ("住宅用地", {"NAME_": "普通商品住房用地（二类）", "KEY_": "V3-07010203", "PARENTKEY_": "V3-07"}),
            ("商服用地", {"NAME_": "零售商业用地", "KEY_": "V3-090101", "PARENTKEY_": "V3-09"}),
            ("工矿仓储", {"NAME_": "一类工业用地（其他工业用地）", "KEY_": "V3-10010102", "PARENTKEY_": "V3-10"}),
            ("其他用地", {"NAME_": "社会停车场用地", "KEY_": "V3-120803", "PARENTKEY_": "V3-12"}),
            ("其他用地", {"NAME_": "供电用地", "KEY_": "V3-1303", "PARENTKEY_": "V3-13"}),
            ("其他用地", {"NAME_": "公园绿地", "KEY_": "V3-1401", "PARENTKEY_": "V3-14"}),
            ("住宅用地", {"NAME_": "普通商品房", "KEY_": "07010201"}),
            ("商服用地", {"NAME_": "零售商业用地", "KEY_": "0501"}),
            ("工矿仓储", {"NAME_": "其他工业用地", "KEY_": "060102"}),
            ("其他用地", {"NAME_": "教育用地", "KEY_": "0803"}),
        ]
        categories = ["住宅用地", "商服用地", "工矿仓储", "其他用地"]
        for expected, plan_use in fixtures:
            record = {"_sourceEndpoint": "landbidding", "planUse": json.dumps([plan_use], ensure_ascii=False)}
            self.assertEqual(_land_use_categories(record, {}), {expected})
            other = next(value for value in categories if value != expected)
            self.assertTrue(_land_use_matches_request({"landUses": [expected, other]}, record, {}, allow_unknown=False))
            choices_without_match = [value for value in categories if value != expected][:2]
            self.assertFalse(_land_use_matches_request({"landUses": choices_without_match}, record, {}, allow_unknown=False))

    def test_single_official_land_use_filter_is_used_for_each_category(self):
        codes = {"住宅用地": 1, "商服用地": 2, "工矿仓储": 3, "其他用地": 4}
        for land_use, code in codes.items():
            request = {"landUses": [land_use]}
            self.assertEqual(_list_server_filters(request).get("landUse"), None)
            self.assertEqual(_website_server_filters(request)["landUse"], code)

    def test_plot_ratio_is_preserved_in_excel_and_html(self):
        raw_ratio = '{"RJL_X_FH":"≤","RJL_X":"1.01","RJL_S_FH":"≤","RJL_S":"1.6"}'
        self.assertEqual(_plot_ratio_text(raw_ratio), "X≤1.01；S≤1.6")
        enriched = enrich_record({"sourceId": "ratio-fixture", "_sourceEndpoint": "landbidding", "rjl": raw_ratio}, lambda _source_id: {"plotRatio": "{\"RJL_X_FH\":\"≤\",\"RJL_X\":\"9\"}"})
        self.assertEqual(enriched["plot_ratio"], "X≤1.01；S≤1.6")
        detail_fallback = enrich_record({"sourceId": "ratio-fixture", "_sourceEndpoint": "landbidding"}, lambda _source_id: {"plotRatio": raw_ratio})
        self.assertEqual(detail_fallback["plot_ratio"], "X≤1.01；S≤1.6")
        item = {
            "record": {"publicityId": "2026-29", "sourceCode": "2026-29", "rjl": raw_ratio},
            "detail": {}, "detail_data": {"plotRatio": raw_ratio}, "coord": {},
            "location": "余姚市", "land_use": "普通商品住房用地（二类）", "area_mu": None,
            "area_sqm": None, "start_price": None, "start_total_price": "", "deal_price": None,
            "deal_total_price": "", "detail_url": "https://example.invalid/detail", "transferee": "",
            "trade_form": "", "term": "", "plot_ratio": "",
        }
        row = row_from_item(item)
        self.assertEqual(row["容积率"], "X≤1.01；S≤1.6")
        self.assertIn("容积率", OUTPUT_COLUMNS)
        with tempfile.TemporaryDirectory() as directory:
            excel_path = os.path.join(directory, "result.xlsx")
            html_path = os.path.join(directory, "result.html")
            write_excel(Path(excel_path), [row], {"maxPages": 1}, {})
            workbook = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
            values = list(workbook.active.iter_rows(values_only=True))
            workbook.close()
            ratio_column = values[0].index("容积率")
            self.assertEqual(values[1][ratio_column], "X≤1.01；S≤1.6")
            write_result_html(Path(html_path), [row], {"maxPages": 1}, {}, {"map": "", "excel": "result.xlsx"})
            html_text = Path(html_path).read_text(encoding="utf-8")
            self.assertIn("容积率", html_text)
            self.assertIn("X≤1.01；S≤1.6", html_text)

    def test_plot_ratio_is_preserved_in_map_popup(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "result.xlsx"
            rows = [{
                "sourceCode": "2026-26", "districtName": "余姚市", "releaseTime": "2026-10-22",
                "_detail_url": "https://example.invalid/detail", "_location": "余姚市",
                "_use": "零售商业用地", "_plot_ratio": "X≤1.3；S≤1.4",
                "_coord": {"center": {"lng": 121.0, "lat": 30.0}},
            }]
            with patch("scrape_zj_land.load_map_config", return_value={"amapEnabled": False}), patch(
                "scrape_zj_land.browser_script", return_value=""
            ):
                assets = build_map_assets(rows, output_path)
            points = json.loads(Path(assets["coord_json"]).read_text(encoding="utf-8"))
            self.assertEqual(points[0]["items"][0]["plotRatio"], "X≤1.3；S≤1.4")
            map_html = Path(assets["map_html"]).read_text(encoding="utf-8")
            self.assertIn("容积率", map_html)
            self.assertIn("row.plotRatio", map_html)

    def test_list_candidate_filter_uses_list_content_before_detail_fetch(self):
        request = {
            "landUses": ["工矿仓储"],
            "startDate": "2025-01-01",
            "endDate": "2025-12-31",
        }
        matching = {"releaseTime": "2025年06月01日", "content": "<td>土地用途</td><td>工矿仓储用地</td>"}
        non_matching = {"releaseTime": "2025年06月01日", "content": "<td>土地用途</td><td>住宅用地</td>"}
        self.assertTrue(_list_record_matches_request(request, matching))
        self.assertFalse(_list_record_matches_request(request, non_matching))

    def test_list_fetch_filters_candidates_and_stops_at_start_date(self):
        pages = [
            [
                {"id": "keep", "releaseTime": "2025-01-02"},
                {"id": "drop", "releaseTime": "2025-01-01"},
            ],
            [{"id": "too-old", "releaseTime": "2024-12-31"}],
        ]
        calls = []

        class Response(JSONResponseFixture):
            def __init__(self, records):
                self.records = records

            def json(self):
                return {"data": {"records": self.records}}

        def get(url, **kwargs):
            calls.append(url)
            return Response(pages[len(calls) - 1])

        with patch("scrape_zj_land.requests.get", side_effect=get), patch("scrape_zj_land.time.sleep"):
            rows = fetch_records(
                max_pages=10,
                record_filter=lambda record: record["releaseTime"] >= "2025-01-01",
                stop_before="2025-01-01",
            )

        self.assertEqual([row["id"] for row in rows], ["keep", "drop"])
        self.assertEqual(len(calls), 2)
        self.assertIn("size=500", calls[0])

    def test_release_date_uses_inclusive_range(self):
        request = {
            "tradeForm": "",
            "tradeMethods": [],
            "tradeStages": [],
            "district": "",
            "provinceWide": True,
            "location": "",
            "landUses": [],
            "startDate": "2025-01-01",
            "endDate": "2025-01-31",
            "startYear": "",
            "quotePreset": "all",
            "quoteStartDate": "",
            "quoteEndDate": "",
            "startPriceMin": None,
            "startPriceMax": None,
            "areaMin": None,
            "areaMax": None,
            "areaUnit": "sqm",
        }
        records = [
            {"releaseTime": "2024-12-31"},
            {"releaseTime": "2025-01-01"},
            {"releaseTime": "2025-01-31"},
            {"releaseTime": "2025-02-01"},
        ]
        enriched = [
            {"record": record, "detail": {}, "location": "", "start_price": None, "area_sqm": None, "area_mu": None}
            for record in records
        ]
        rows, _ = filter_records(enriched, request)
        self.assertEqual([row["record"]["releaseTime"] for row in rows], ["2025-01-01", "2025-01-31"])
        validated = validate_request({"outputDirectory": os.getcwd(), "provinceWide": True, **request})
        self.assertEqual(validated["maxPages"], 200)

    def test_start_date_cannot_follow_end_date(self):
        with self.assertRaisesRegex(ValueError, "LAND_DATE_RANGE_INVALID"):
            validate_request({
                "outputDirectory": os.getcwd(),
                "provinceWide": True,
                "startDate": "2025-02-01",
                "endDate": "2025-01-01",
            })


if __name__ == "__main__":
    unittest.main()
