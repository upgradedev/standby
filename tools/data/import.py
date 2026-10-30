"""Reproduce the public Austin study; raw inputs remain in ignored .runtime/raw.

No AWS credentials or paid APIs are used. All location choices use train only.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

CONFIG_PATH = Path(__file__).with_name("model-config.json")
UTC = timezone.utc
CHICAGO = ZoneInfo("America/Chicago")
PAGE_SIZE = 1000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical(value))


def parse_utc(value):
    if not isinstance(value, str):
        raise ValueError("missing timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        # Socrata floating timestamps in this dataset represent UTC publication.
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def fetch_year(year, output, config, refresh=False):
    rows, pages = [], []
    for offset in range(0, 100000, PAGE_SIZE):
        query = {
            "$select": "traffic_report_id,published_date,latitude,longitude,traffic_report_status,issue_reported",
            "$where": "issue_reported in ('Stalled Vehicle','zSTALLED VEHICLE') "
                f"AND published_date >= '{year}-01-01T00:00:00Z' "
                f"AND published_date < '{year + 1}-01-01T00:00:00Z'",
            "$order": "published_date,traffic_report_id",
            "$limit": str(PAGE_SIZE), "$offset": str(offset),
        }
        url = config["sourceUrl"] + "?" + urllib.parse.urlencode(query)
        path = output / "raw" / f"{year}-{offset}.json"
        if path.exists() and not refresh:
            raw = path.read_bytes()
        else:
            with urllib.request.urlopen(url, timeout=60) as response:
                raw = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        batch = json.loads(raw)
        if not isinstance(batch, list):
            raise ValueError("source did not return a list")
        pages.append({"url": url, "sha256": hashlib.sha256(raw).hexdigest(), "rows": len(batch), "path": str(path.relative_to(output))})
        rows.extend(batch)
        # Always continue to an empty page, including a partial final page.
        if not batch:
            return rows, pages
    raise ValueError("source exceeded bounded import limit")


def clean_rows(rows, config):
    valid, excluded, conflicts = [], Counter(), []
    by_id = {}
    for row in rows:
        report_id = row.get("traffic_report_id")
        if not isinstance(report_id, str) or not report_id.strip():
            excluded["missing_id"] += 1
            continue
        if report_id in by_id:
            if canonical(by_id[report_id][0]) == canonical(row):
                excluded["identical_duplicate"] += 1
            else:
                by_id[report_id][1] = True
                conflicts.append({"id": report_id, "reason": "conflicting_duplicate", "row": row})
                excluded["conflicting_duplicate"] += 1
        else:
            by_id[report_id] = [row, False]
    west, south, east, north = config["bounds"]
    for report_id, (row, conflict) in sorted(by_id.items()):
        if conflict:
            excluded["conflicting_original_quarantined"] += 1
            conflicts.append({"id": report_id, "reason": "conflicting_original", "row": row})
            continue
        if row.get("issue_reported") not in config["sourceLabels"]:
            excluded["other_label"] += 1
            continue
        try:
            when = parse_utc(row.get("published_date"))
            lon, lat = float(row["longitude"]), float(row["latitude"])
            if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise ValueError("coordinates")
        except (ValueError, TypeError, KeyError):
            excluded["invalid_timestamp_or_coordinates"] += 1
            continue
        if not (west <= lon <= east and south <= lat <= north):
            excluded["outside_study_region"] += 1
            continue
        cohort = next((name for name, period in config["periods"].items() if parse_utc(period["start"]) <= when < parse_utc(period["end"])), None)
        if cohort is None:
            excluded["outside_period"] += 1
            continue
        local = when.astimezone(CHICAGO)
        valid.append({"id": report_id, "position": (lon, lat), "cohort": cohort, "hour": local.hour,
                      "day": local.weekday(), "month": when.strftime("%Y-%m")})
    if not valid:
        raise ValueError("no valid source rows")
    return valid, dict(excluded), conflicts


def distance_squared(a, b):
    return ((a[0] - b[0]) * math.cos(math.radians(30.32))) ** 2 + (a[1] - b[1]) ** 2


def meters(a, b):
    return math.sqrt(distance_squared(a, b)) * 111195.0


def representatives(train, limit, rounds):
    """Deterministic weighted farthest-first then bounded medoid refinement."""
    weights = Counter(tuple(row["position"]) for row in train)
    points = sorted(weights)
    target = min(limit, len(points))
    if not target:
        raise ValueError("empty training cohort")
    center = (sum(p[0] * weights[p] for p in points) / sum(weights.values()), sum(p[1] * weights[p] for p in points) / sum(weights.values()))
    chosen = [min(points, key=lambda p: (distance_squared(p, center), p))]
    while len(chosen) < target:
        chosen.append(min((p for p in points if p not in chosen), key=lambda p: (-min(distance_squared(p, q) for q in chosen) * math.sqrt(weights[p]), p)))
    for _ in range(rounds):
        clusters = [[] for _ in chosen]
        for point in points:
            index = min(range(len(chosen)), key=lambda i: (distance_squared(point, chosen[i]), i))
            clusters[index].append(point)
        updated = [min(cluster, key=lambda p: (sum(distance_squared(p, q) * weights[q] for q in cluster), p)) if cluster else chosen[i]
                   for i, cluster in enumerate(clusters)]
        if updated == chosen:
            break
        chosen = updated
    return sorted(chosen)


def clip_polygon(polygon, a, b, c):
    """Clip convex polygon against a*x+b*y <= c; all cells cover the bbox."""
    if not polygon:
        return []
    result = []
    previous = polygon[-1]
    previous_value = a * previous[0] + b * previous[1] - c
    for current in polygon:
        value = a * current[0] + b * current[1] - c
        if (value <= 1e-12) != (previous_value <= 1e-12):
            ratio = previous_value / (previous_value - value)
            result.append((previous[0] + ratio * (current[0] - previous[0]), previous[1] + ratio * (current[1] - previous[1])))
        if value <= 1e-12:
            result.append(current)
        previous, previous_value = current, value
    return result


def voronoi_cell(point, all_points, bounds):
    west, south, east, north = bounds
    polygon = [(west, south), (east, south), (east, north), (west, north)]
    # Use the same local projection as representative assignment.
    scale2 = math.cos(math.radians(30.32)) ** 2
    for other in all_points:
        if other == point:
            continue
        a, b = 2 * (other[0] - point[0]) * scale2, 2 * (other[1] - point[1])
        c = (other[0] ** 2 - point[0] ** 2) * scale2 + other[1] ** 2 - point[1] ** 2
        polygon = clip_polygon(polygon, a, b, c)
    if len(polygon) < 3:
        raise ValueError("empty Voronoi cell")
    return [[round(x, 8), round(y, 8)] for x, y in polygon + [polygon[0]]]


def quantile(values, q):
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(q * len(ordered)) - 1)], 2) if ordered else 0


def make_dataset(rows_by_year, config, generated_at):
    valid, excluded, quarantine = {}, {}, []
    input_rows = {"train": 0, "holdout": 0}
    for year, rows in sorted(rows_by_year.items()):
        cohort = "train" if year < 2025 else "holdout"
        input_rows[cohort] += len(rows)
        cleaned, exclusions, conflicts = clean_rows(rows, config)
        valid.setdefault(cohort, []).extend(cleaned)
        counts = Counter(excluded.get(cohort, {}))
        counts.update(exclusions)
        excluded[cohort] = dict(counts)
        quarantine.extend(conflicts)
    if not valid.get("train") or not valid.get("holdout"):
        raise ValueError("both cohorts must contain eligible reports")
    # Dedup across annual pages/years, without silently choosing conflicting IDs.
    all_ids = [row["id"] for cohort in valid.values() for row in cohort]
    if len(set(all_ids)) != len(all_ids):
        raise ValueError("duplicate IDs span annual cohorts; manual quarantine required")
    reps = representatives(valid["train"], config["zoneLimit"], config["medoidRounds"])
    zones = []
    west, south, east, north = config["bounds"]
    for i, position in enumerate(reps):
        vertical = "North" if position[1] > south + (north - south) * 2 / 3 else "South" if position[1] < south + (north - south) / 3 else "Central"
        horizontal = "West" if position[0] < west + (east - west) / 3 else "East" if position[0] > west + (east - west) * 2 / 3 else "Central"
        zones.append({"id": f"zone-{i + 1:03}", "name": f"{vertical} {horizontal} · {i + 1:03}", "position": list(position),
                      "polygon": voronoi_cell(position, reps, config["bounds"]), "trainCount": 0, "holdoutCount": 0,
                      "trainHours": [0] * 24, "holdoutHours": [0] * 24, "trainDays": [0] * 7, "holdoutDays": [0] * 7,
                      "qualityFlags": ["representative-point approximation"]})
    distribution, approximation, monthly = {}, {}, Counter()
    for cohort, records in valid.items():
        distribution[cohort] = {"hours": [0] * 24, "days": [0] * 7}
        offsets = []
        for row in records:
            index = min(range(len(reps)), key=lambda i: (distance_squared(row["position"], reps[i]), i))
            zone = zones[index]
            zone[cohort + "Count"] += 1
            zone[cohort + "Hours"][row["hour"]] += 1
            zone[cohort + "Days"][row["day"]] += 1
            distribution[cohort]["hours"][row["hour"]] += 1
            distribution[cohort]["days"][row["day"]] += 1
            monthly[row["month"]] += 1
            offsets.append(meters(row["position"], reps[index]))
        approximation[cohort] = {"p50": quantile(offsets, .5), "p90": quantile(offsets, .9), "max": round(max(offsets), 2)}
    weighted_reps = [{"position": tuple(z["position"])} for z in zones for _ in range(z["trainCount"])]
    site_points = representatives(weighted_reps, config["siteLimit"], 0)
    sites = [{"id": f"site-{i + 1:02}", "name": f"Assumed standby {i + 1:02}", "position": list(point), "assumed": True}
             for i, point in enumerate(site_points)]
    dataset = {
        "schemaVersion": "1", "id": config["version"], "configHash": digest(config), "generatedAt": generated_at,
        "bounds": config["bounds"], "periods": config["periods"], "zones": zones, "sites": sites,
        "distribution": distribution,
        "quality": {"inputRows": input_rows, "accepted": {c: len(valid[c]) for c in valid}, "excluded": excluded,
                    "monthlyReports": dict(sorted(monthly.items())), "approximationMeters": approximation,
                    "warnings": ["Publication time is not incident occurrence or assistance response time.",
                                 "January 2024 has sparse source reporting; report counts do not estimate all breakdowns.",
                                 "Sites and fleet are hypothetical; access, capacity and operating hours are unverified.",
                                 "Zone names describe relative positions within this bounded study, not official neighbourhoods."]},
        "source": {"url": config["sourceUrl"], "attribution": "City of Austin, Real Time Traffic Incident Reports; transformed by Standby",
                   "semantics": "UTC report publication timestamps; Chicago local-hour/day charts; stalled-vehicle reports only.",
                   "policyUrl": "https://datahub.austintexas.gov/stories/s/ranj-cccq"},
    }
    dataset["hash"] = digest(dataset)
    routing = {"datasetHash": dataset["hash"], "configHash": dataset["configHash"], "profile": config["profile"],
               "bounds": config["bounds"], "origins": [{"id": s["id"], "position": s["position"]} for s in sites],
               "destinations": [{"id": z["id"], "position": z["position"]} for z in zones]}
    return dataset, routing, quarantine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(".runtime"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with ThreadPoolExecutor(max_workers=3) as executor:
        fetched = list(executor.map(lambda year: (year, *fetch_year(year, args.output, config, args.refresh)), [2023, 2024, 2025]))
    dataset, routing, quarantine = make_dataset({year: rows for year, rows, _ in fetched}, config, generated_at)
    manifest = {"retrievedAt": generated_at, "configHash": digest(config), "datasetHash": dataset["hash"],
                "pages": [page for _, _, pages in fetched for page in pages], "quality": dataset["quality"],
                "files": {"dataset": "dataset.json", "routing": "routing-input.json"}}
    metadata_url = "https://data.austintexas.gov/api/views/dx9v-zd7x.json"
    metadata_path = args.output / "raw" / "metadata.json"
    if not metadata_path.exists() or args.refresh:
        metadata_path.write_bytes(urllib.request.urlopen(metadata_url, timeout=60).read())
    manifest["metadata"] = {"url": metadata_url, "sha256": hashlib.sha256(metadata_path.read_bytes()).hexdigest()}
    write_json(args.output / "dataset.json", dataset)
    write_json(args.output / "routing-input.json", routing)
    write_json(args.output / "raw" / "quarantine.json", quarantine)
    write_json(args.output / "import-manifest.json", manifest)
    print(json.dumps({"datasetHash": dataset["hash"], "zones": len(dataset["zones"]), "sites": len(dataset["sites"]),
                      "pairs": len(dataset["zones"]) * len(dataset["sites"]), "quality": dataset["quality"]}, indent=2))


if __name__ == "__main__":
    main()
