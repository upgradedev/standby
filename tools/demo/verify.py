"""Verify a rendered demo using only the Python standard library plus ffprobe.

python tools/demo/verify.py --media demo.mp4 --captions captions.json \
  --expected-release <40-character SHA> --expected-seconds 145

Exit nonzero on a missing stream, excess duration, frame/audio end mismatch,
release mismatch, or invalid captions. A file existing is never a pass.
"""
from __future__ import annotations

import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess


class VerificationError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def number(value: object, label: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise VerificationError(f"{label} is missing or nonnumeric") from None
    require(math.isfinite(parsed), f"{label} must be finite")
    return parsed


def stream_end(stream: dict, label: str) -> float:
    start = number(stream.get("start_time", 0), f"{label} start")
    duration = number(stream.get("duration"), f"{label} duration")
    require(duration > 0, f"{label} duration must be positive")
    return start + duration


def validate(probe: dict, captions: dict, expected_release: str,
             expected_seconds: float | None = None) -> dict:
    require(bool(re.fullmatch(r"[a-f0-9]{40}", expected_release)), "A full release SHA is required")
    require(captions.get("releaseSha") == expected_release, "Caption release differs from the frozen release")
    streams = probe.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    require(len(videos) == 1 and len(audios) == 1, "Exactly one video stream and one audio stream are required")
    video, audio = videos[0], audios[0]
    try:
        fps = float(Fraction(video.get("avg_frame_rate", "0/1")))
    except (ValueError, ZeroDivisionError):
        raise VerificationError("Video frame rate is invalid") from None
    require(0 < fps <= 120, "Video frame rate is invalid")
    frame = 1 / fps
    require(abs(fps - number(captions.get("fps"), "Caption frame rate")) < 0.0001,
            "Caption and video frame rates disagree")
    require(video.get("width") == 1440 and video.get("height") == 900, "Demo dimensions must be 1440 by 900")
    video_end, audio_end = stream_end(video, "Video"), stream_end(audio, "Audio")
    duration = number(probe.get("format", {}).get("duration"), "Container duration")
    require(0 < duration < 180 and video_end < 180 and audio_end < 180,
            "The public demo must remain strictly below three minutes")
    require(abs(video_end - audio_end) <= frame + 0.000001,
            "Audio and video ends differ by more than one video frame")
    require(abs(duration - video_end) <= frame + 0.000001,
            "Container and video duration differ by more than one video frame")
    if expected_seconds is not None:
        require(abs(video_end - expected_seconds) <= frame + 0.000001,
                "Video duration differs from the declared storyboard")
    comment = str(probe.get("format", {}).get("tags", {}).get("comment", ""))
    require(f"Standby release {expected_release}" in comment, "MP4 release metadata is absent or incorrect")
    declared = number(captions.get("durationSeconds"), "Caption timeline duration")
    require(abs(declared - video_end) <= frame + 0.000001, "Caption timeline and video duration disagree")
    cues = captions.get("cues")
    require(isinstance(cues, list) and len(cues) > 0, "Captions must contain at least one cue")
    previous_end = 0.0
    for index, cue in enumerate(cues):
        require(isinstance(cue, dict), f"Caption {index} must be an object")
        start = number(cue.get("startSeconds"), f"Caption {index} start")
        end = number(cue.get("endSeconds"), f"Caption {index} end")
        require(0 <= start < end <= video_end + 0.000001, f"Caption {index} is outside the video")
        require(start >= previous_end - 0.000001, f"Caption {index} overlaps or is out of order")
        require(isinstance(cue.get("text"), str) and cue["text"].strip(), f"Caption {index} is empty")
        previous_end = end
    return {"status": "PASS", "releaseSha": expected_release, "videoSeconds": video_end,
            "audioSeconds": audio_end, "fps": fps, "captionCues": len(cues)}


def probe_media(media: Path) -> dict:
    command = ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(media)]
    try:
        return json.loads(subprocess.run(command, check=True, capture_output=True, text=True).stdout)
    except FileNotFoundError:
        raise VerificationError("ffprobe must be available on the hosted runner") from None
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        raise VerificationError("ffprobe could not read the actual rendered media") from None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--captions", type=Path, required=True)
    parser.add_argument("--expected-release", required=True)
    parser.add_argument("--expected-seconds", type=float)
    args = parser.parse_args()
    try:
        captions = json.loads(args.captions.read_text(encoding="utf-8"))
        result = validate(probe_media(args.media), captions, args.expected_release, args.expected_seconds)
        result.update({"sha256": sha256_file(args.media), "captionsSha256": sha256_file(args.captions)})
        print(json.dumps(result))
        return 0
    except (OSError, json.JSONDecodeError, VerificationError) as error:
        print(f"FAIL demo verification: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
