"""Independent artifact invariants; never publishes raw report identifiers."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def validate(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    assert data["schemaVersion"] == "1"
    unsigned = {key: value for key, value in data.items() if key != "hash"}
    expected = hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    assert expected == data["hash"], "dataset fingerprint mismatch"
    assert 1 <= len(data["zones"]) <= 240 and 1 <= len(data["sites"]) <= 12
    assert len({zone["id"] for zone in data["zones"]}) == len(data["zones"])
    assert len({site["id"] for site in data["sites"]}) == len(data["sites"])
    west, south, east, north = data["bounds"]
    area = 0
    for zone in data["zones"]:
        assert set(zone) == {"id", "name", "position", "polygon", "trainCount", "holdoutCount", "trainHours", "holdoutHours", "trainDays", "holdoutDays", "qualityFlags"}, "unexpected public fields"
        assert west <= zone["position"][0] <= east and south <= zone["position"][1] <= north
        polygon = zone["polygon"]
        assert len(polygon) >= 4 and polygon[0] == polygon[-1]
        assert all(math.isfinite(x) and math.isfinite(y) and west - 1e-7 <= x <= east + 1e-7 and south - 1e-7 <= y <= north + 1e-7 for x, y in polygon)
        area += abs(sum(polygon[i][0] * polygon[i + 1][1] - polygon[i + 1][0] * polygon[i][1] for i in range(len(polygon) - 1))) / 2
        for cohort in ["train", "holdout"]:
            assert len(zone[cohort + "Hours"]) == 24 and len(zone[cohort + "Days"]) == 7
            assert sum(zone[cohort + "Hours"]) == zone[cohort + "Count"] == sum(zone[cohort + "Days"])
    assert math.isclose(area, (east - west) * (north - south), abs_tol=1e-6), "Voronoi cells do not cover the full study region"
    for cohort in ["train", "holdout"]:
        accepted = data["quality"]["accepted"][cohort]
        assert accepted > 0
        assert sum(z[cohort + "Count"] for z in data["zones"]) == accepted
        assert sum(data["distribution"][cohort]["hours"]) == accepted == sum(data["distribution"][cohort]["days"])
        assert accepted + sum(data["quality"]["excluded"][cohort].values()) == data["quality"]["inputRows"][cohort], "input accounting mismatch"
    assert all(site["assumed"] is True and any(site["position"] == z["position"] for z in data["zones"]) for site in data["sites"])
    return {"hash": data["hash"], "zones": len(data["zones"]), "sites": len(data["sites"]), "accepted": data["quality"]["accepted"], "status": "VALID"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    args = parser.parse_args()
    print(json.dumps(validate(args.dataset), indent=2))
