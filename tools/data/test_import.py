import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

spec = importlib.util.spec_from_file_location("standby_import", Path(__file__).with_name("import.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CONFIG = json.loads(module.CONFIG_PATH.read_text())


def row(report_id="a", timestamp="2023-01-01T00:00:00Z", position=(-97.75, 30.30), label="Stalled Vehicle"):
    return {"traffic_report_id": report_id, "published_date": timestamp, "longitude": str(position[0]), "latitude": str(position[1]), "issue_reported": label}


class ImportTests(unittest.TestCase):
    def test_pagination_continues_after_partial_page_until_empty(self):
        offsets = []
        class Response:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(self.payload).encode()
        def fake_urlopen(url, timeout):
            offset = int(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["$offset"][0])
            offsets.append(offset)
            return Response([row("a")] if offset == 0 else [])
        with tempfile.TemporaryDirectory() as directory, patch.object(module.urllib.request, "urlopen", side_effect=fake_urlopen):
            rows, pages = module.fetch_year(2023, Path(directory), CONFIG)
        self.assertEqual(offsets, [0, 1000])
        self.assertEqual(len(rows), 1)
        self.assertEqual(pages[-1]["rows"], 0)

    def test_source_labels_and_invalid_input_are_explicit(self):
        rows = [row(), row("b", label="zSTALLED VEHICLE"), row("c", label="Crash"), row("d", position=(float("nan"), 30)), row("e", position=(-98, 30))]
        valid, excluded, _ = module.clean_rows(rows, CONFIG)
        self.assertEqual(len(valid), 2)
        self.assertEqual(excluded, {"other_label": 1, "invalid_timestamp_or_coordinates": 1, "outside_study_region": 1})

    def test_identical_duplicates_and_conflicting_ids(self):
        rows = [row(), row(), row("b"), row("b", position=(-97.76, 30.30)), row("c")]
        valid, excluded, quarantine = module.clean_rows(rows, CONFIG)
        self.assertEqual([r["id"] for r in valid], ["a", "c"])
        self.assertEqual(excluded["identical_duplicate"], 1)
        self.assertEqual(excluded["conflicting_duplicate"], 1)
        self.assertEqual(excluded["conflicting_original_quarantined"], 1)
        self.assertEqual(len(quarantine), 2)

    def test_utc_split_and_local_dst_are_independent(self):
        rows = [row("a", "2024-12-31T23:59:59Z"), row("b", "2025-01-01T00:00:00Z"), row("c", "2025-03-09T07:30:00Z"), row("d", "2025-03-09T08:30:00Z")]
        valid, _, _ = module.clean_rows(rows, CONFIG)
        by_id = {r["id"]: r for r in valid}
        self.assertEqual(by_id["a"]["cohort"], "train")
        self.assertEqual(by_id["b"]["cohort"], "holdout")
        self.assertEqual((by_id["c"]["hour"], by_id["d"]["hour"]), (1, 3))

    def test_empty_input_fails(self):
        with self.assertRaisesRegex(ValueError, "no valid"):
            module.clean_rows([], CONFIG)

    def test_holdout_cannot_create_or_move_representatives(self):
        config = dict(CONFIG, zoneLimit=2, siteLimit=2)
        years = {2023: [row("a", position=(-97.80, 30.23)), row("b", position=(-97.70, 30.40))],
                 2024: [row("c", "2024-01-01T00:00:00Z", (-97.79, 30.24))],
                 2025: [row("d", "2025-01-01T00:00:00Z", (-97.87, 30.45))]}
        before, _, _ = module.make_dataset(years, config, "fixed")
        years[2025] = [row("e", "2025-01-01T00:00:00Z", (-97.63, 30.19))]
        after, _, _ = module.make_dataset(years, config, "fixed")
        self.assertEqual([z["position"] for z in before["zones"]], [z["position"] for z in after["zones"]])
        self.assertEqual(before["sites"], after["sites"])
        self.assertEqual(sum(z["holdoutCount"] for z in after["zones"]), 1)

    def test_voronoi_polygons_cover_the_entire_study_box(self):
        points = [(-97.8, 30.25), (-97.7, 30.4), (-97.7, 30.2)]
        polygons = [module.voronoi_cell(p, points, CONFIG["bounds"]) for p in points]
        def area(poly):
            return abs(sum(poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1] for i in range(len(poly) - 1))) / 2
        west, south, east, north = CONFIG["bounds"]
        self.assertAlmostEqual(sum(area(poly) for poly in polygons), (east - west) * (north - south), places=7)
        self.assertTrue(all(poly[0] == poly[-1] for poly in polygons))


if __name__ == "__main__":
    unittest.main()
