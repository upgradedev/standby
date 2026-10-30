"""Locate an editorial magenta slate in actual decoded video, never a host clock.

The slate is recorded before the story and excluded from every published frame.
Only one averaged RGB pixel per decoded frame is retained temporarily in memory.
"""
import argparse
import json
from pathlib import Path
import subprocess

from verify import VerificationError, number, probe_media, require


def locate_slate(timestamps: list[float], rgb: bytes, source_seconds: float, beat_seconds: float) -> dict:
    require(len(rgb) == len(timestamps) * 3 and len(timestamps) >= 3, "Decoded RGB samples and frame timestamps disagree")
    require(all(value >= 0 for value in timestamps) and all(b > a for a, b in zip(timestamps, timestamps[1:])), "Decoded frame timestamps are not ordered")
    marker = [rgb[index] >= 230 and rgb[index + 1] <= 25 and rgb[index + 2] >= 230 for index in range(0, len(rgb), 3)]
    require(any(marker), "The actual video contains no magenta sync slate")
    first = marker.index(True)
    clear = first
    while clear < len(marker) and marker[clear]:
        clear += 1
    require(clear - first >= 2 and clear < len(marker), "The sync slate does not have a complete marker-to-app transition")
    require(not any(marker[clear:]), "The sync slate is not one contiguous pre-story marker")
    inpoint = timestamps[clear]
    require(source_seconds - inpoint >= beat_seconds, "Actual media after the decoded sync slate is too short")
    return {"method": "decoded-magenta-slate", "firstClearFramePtsSeconds": inpoint,
            "markerFirstFramePtsSeconds": timestamps[first], "markerLastFramePtsSeconds": timestamps[clear - 1],
            "markerFrames": clear - first, "decodedFrames": len(timestamps), "sourceDurationSeconds": source_seconds}


def inspect_sync(media: Path, beat_seconds: float) -> dict:
    try:
        timestamps_raw = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(media)], check=True, capture_output=True, text=True).stdout
        frames = json.loads(timestamps_raw).get("frames", [])
        timestamps = [number(frame.get("best_effort_timestamp_time"), "Decoded frame PTS") for frame in frames]
        rgb = subprocess.run(["ffmpeg", "-v", "error", "-i", str(media), "-map", "0:v:0", "-an", "-sn", "-vf", "scale=1:1:flags=area,format=rgb24", "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"], check=True, capture_output=True).stdout
    except (FileNotFoundError, subprocess.CalledProcessError, json.JSONDecodeError):
        raise VerificationError("The actual video could not be decoded for sync-slate detection") from None
    source_seconds = number(probe_media(media).get("format", {}).get("duration"), "Actual source duration")
    return locate_slate(timestamps, rgb, source_seconds, beat_seconds)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--seconds", type=float, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_sync(args.media, args.seconds)))
    except (OSError, VerificationError) as error:
        print(f"FAIL decoded video sync: {error}")
        raise SystemExit(1)
