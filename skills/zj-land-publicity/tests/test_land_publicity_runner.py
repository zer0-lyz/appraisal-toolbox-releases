import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from land_publicity_runner import _list_record_matches_request, _list_server_filters, filter_records, validate_request
from scrape_zj_land import fetch_records, fetch_region_codes


class LandPublicityDateTests(unittest.TestCase):
    def test_server_filters_use_region_tree_and_publish_window(self):
        request = {"district": "宁波市", "location": "镇海区", "provinceWide": False, "startDate": "2025-01-01", "endDate": "2025-01-31"}
        filters = _list_server_filters(request)
        self.assertEqual(filters["regionName"], "镇海区")
        self.assertEqual(filters["fallbackRegionName"], "宁波市")
        self.assertEqual(filters["enrollStartTime"], 1735660800000)
        self.assertEqual(filters["nowTime"], 1738339199999)

    def test_region_tree_resolves_all_descendant_codes(self):
        class Response:
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

        class Response:
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

        class Response:
            def json(self):
                return {"data": {"records": []}}

        with patch("scrape_zj_land.fetch_region_codes", return_value=["330211"]), patch(
            "scrape_zj_land.requests.get", side_effect=lambda url, **kwargs: (calls.append(url) or Response())
        ):
            fetch_records(max_pages=1, server_filters={"regionName": "镇海区", "fallbackRegionName": "宁波市"})

        self.assertIn("regionCode=330211", calls[0])

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

        class Response:
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
