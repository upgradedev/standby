"""Render independently replaceable real-app beats and assemble a verified MP4.

Hosted runner only; requires ffmpeg/ffprobe already installed there:
python tools/demo/render.py --capture .runtime/demo/<release> \
  --voice-dir .runtime/voice/<release> --release <40-character SHA>

Each voice file is <beat>.mp3, .wav, or .m4a. Voice generation is deliberately
outside this tool. Use --beat history to rebuild only that video/audio segment;
omit --beat afterward to assemble all existing segments. Missing or overlong
voice fails visibly. No invented silence-only final narration is supplied.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess

from verify import VerificationError, number, probe_media, require, sha256_file, validate
from sync import inspect_sync


def run(command: list[str]) -> None:
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError:
        raise VerificationError(f"{command[0]} must be available on the hosted runner") from None
    except subprocess.CalledProcessError:
        raise VerificationError(f"{command[0]} failed; no output is considered verified") from None


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def write_srt(path: Path, captions: dict) -> None:
    pieces = []
    for index, cue in enumerate(captions["cues"], 1):
        text = cue["text"].strip().replace("\r", " ").replace("\n", " ")
        pieces.append(f"{index}\n{srt_time(cue['startSeconds'])} --> {srt_time(cue['endSeconds'])}\n{text}\n")
    path.write_text("\n".join(pieces), encoding="utf-8")


def voice_file(directory: Path, beat_id: str) -> Path:
    candidates = [directory / f"{beat_id}{extension}" for extension in (".wav", ".mp3", ".m4a")]
    existing = [candidate for candidate in candidates if candidate.is_file()]
    require(len(existing) == 1, f"Exactly one voice file is required for {beat_id}")
    return existing[0]


def validate_capture_clock(metadata: dict, duration: float) -> None:
    if metadata.get("schemaVersion") == 3:
        clock = metadata.get("captureClock", {})
        require(clock.get("method") == "native-screencast-slate", "Native sync-slate receipt is required")
        require(0 <= number(clock.get("semanticElapsedSeconds"), "Semantic action duration") <= duration,
                "Actual demo actions overran the captured edit window")
        elapsed = (number(clock.get("actionsCompletedAtUnixMs"), "Action completion") - number(clock.get("storyAnchorAtUnixMs"), "Story anchor")) / 1000
        require(0 <= elapsed <= duration, "Semantic action clock is outside the beat budget")
        proof = metadata.get("syncProof", {})
        require(proof.get("method") == "decoded-magenta-slate" and proof.get("markerFrames", 0) >= 2,
                "Decoded sync-slate proof is required")
        require(metadata.get("trimStartSeconds") == proof.get("firstClearFramePtsSeconds"), "In-point differs from the decoded actual frame")
        return
    require(metadata.get("schemaVersion") == 2 and metadata.get("trimStartSeconds") == 0,
            "Capture uses a legacy inferred pre-roll clock; recapture this beat with explicit screencast start")
    clock = metadata.get("captureClock", {})
    require(clock.get("method") == "playwright-screencast", "A browser presentation-clock receipt is required")
    first = number(clock.get("firstPresentedAtUnixMs"), "First presented frame timestamp")
    last = number(clock.get("lastPresentedAtUnixMs"), "Last presented frame timestamp")
    actions_end = number(clock.get("actionsCompletedAtUnixMs"), "Action completion timestamp")
    require(first > 0 and last - first >= duration * 1000, "Actual presented frame span is shorter than the beat")
    require(isinstance(clock.get("framesObserved"), int) and clock["framesObserved"] >= 2,
            "At least two actual browser frames must bound the beat")
    require(first <= actions_end <= first + duration * 1000,
            "Actual demo actions overran the captured edit window")


def render_beat(capture: Path, voices: Path, segments: Path, beat: dict, project: dict) -> None:
    beat_id = beat["id"]
    require(bool(re.fullmatch(r"[a-z]+", beat_id)), "Beat identifier is invalid")
    metadata = read_json(capture / f"{beat_id}.json")
    require(metadata.get("releaseSha") == project["releaseSha"] and metadata.get("datasetHash") == project["datasetHash"],
            f"{beat_id} capture belongs to a different release or dataset")
    require(metadata.get("videoFile") == f"{beat_id}.webm", f"{beat_id} video path is not an owned capture")
    duration = number(metadata.get("durationSeconds"), "Beat duration")
    require(abs(duration - (beat["endSeconds"] - beat["startSeconds"])) < 0.000001,
            f"{beat_id} duration differs from the storyboard")
    validate_capture_clock(metadata, duration)
    fps = number(project.get("fps"), "Storyboard frame rate")
    frame_count = round(duration * fps)
    require(abs(frame_count / fps - duration) < 0.000001, "Beat duration is not an exact frame count")
    trim = number(metadata.get("trimStartSeconds"), "Capture in-point")
    require(trim >= 0, "Capture in-point cannot be negative")
    source = capture / metadata["videoFile"]
    source_probe = probe_media(source)
    if metadata.get("schemaVersion") == 3:
        decoded = inspect_sync(source, duration)
        require(abs(decoded["firstClearFramePtsSeconds"] - trim) < 0.000001,
                f"{beat_id} in-point does not match actual decoded pixels")
    available = number(source_probe.get("format", {}).get("duration"), "Raw capture duration") - trim
    require(available >= duration, f"{beat_id} capture is too short; recapture this beat")
    voice = voice_file(voices, beat_id)
    audio_probe = probe_media(voice)
    require(any(stream.get("codec_type") == "audio" for stream in audio_probe.get("streams", [])),
            f"{beat_id} voice file has no audio stream")
    voice_duration = number(audio_probe.get("format", {}).get("duration"), "Voice duration")
    require(0 < voice_duration <= duration - 0.1, f"{beat_id} narration exceeds its beat budget; revise or regenerate that voice")
    video_path = segments / f"{beat_id}.mp4"
    audio_path = segments / f"{beat_id}.wav"
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{trim:.6f}", "-i", str(source),
         "-vf", f"fps={fps:g},scale=1440:900:flags=lanczos,setsar=1,format=yuv420p",
         "-frames:v", str(frame_count), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-movflags", "+faststart", str(video_path)])
    run(["ffmpeg", "-y", "-v", "error", "-i", str(voice),
         "-af", f"aresample=48000,apad,atrim=duration={duration:g},asetpts=PTS-STARTPTS",
         "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(audio_path)])
    (segments / f"{beat_id}.json").write_text(json.dumps({"releaseSha": project["releaseSha"],
        "datasetHash": project["datasetHash"], "frames": frame_count, "seconds": duration,
        "voiceFile": voice.name, "narrationSeconds": voice_duration,
        "voiceSha256": sha256_file(voice), "captureSha256": sha256_file(source),
        "captureMetadataSha256": sha256_file(capture / f"{beat_id}.json"),
        "videoSha256": sha256_file(video_path), "audioSha256": sha256_file(audio_path)}, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--voice-dir", type=Path, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--beat", help="Re-render only this independent beat; do not assemble a final video")
    parser.add_argument("--rebuild-all", action="store_true", help="Rebuild all segments before final assembly")
    args = parser.parse_args()
    try:
        capture = args.capture.resolve()
        project, captions = read_json(capture / "project.json"), read_json(capture / "captions.json")
        require(re.fullmatch(r"[a-f0-9]{40}", args.release) is not None, "A full frozen release SHA is required")
        require(project.get("releaseSha") == args.release == captions.get("releaseSha"), "Render release differs from capture or captions")
        beats = project.get("beats", [])
        require(isinstance(beats, list) and len(beats) > 0, "Storyboard beats are missing")
        require(not args.beat or any(beat.get("id") == args.beat for beat in beats), "Requested beat does not exist")
        segments = capture / "segments"
        segments.mkdir(exist_ok=True)
        for beat in beats:
            beat_id = beat["id"]
            require(re.fullmatch(r"[a-z]+", beat_id) is not None, "Invalid beat identifier")
            existing = all((segments / f"{beat_id}{extension}").is_file() for extension in (".mp4", ".wav", ".json"))
            if (args.beat and beat_id == args.beat) or (not args.beat and (args.rebuild_all or not existing)):
                render_beat(capture, args.voice_dir.resolve(), segments, beat, project)
        if args.beat:
            print(f"PASS rendered independent beat {args.beat}; assemble separately after reviewing its pixels")
            return 0
        video_lines, audio_lines = [], []
        for beat in beats:
            beat_id = beat["id"]
            metadata = read_json(segments / f"{beat_id}.json")
            duration = beat["endSeconds"] - beat["startSeconds"]
            require(metadata.get("releaseSha") == args.release and metadata.get("datasetHash") == project["datasetHash"],
                    f"{beat_id} segment belongs to another frozen release")
            require(abs(number(metadata.get("seconds"), "Segment duration") - duration) < 0.000001,
                    f"{beat_id} segment timing is stale")
            for extension, field in ((".mp4", "videoSha256"), (".wav", "audioSha256")):
                require(metadata.get(field) == sha256_file(segments / f"{beat_id}{extension}"),
                        f"{beat_id} segment bytes changed; re-render that beat")
            require(metadata.get("voiceSha256") == sha256_file(voice_file(args.voice_dir.resolve(), beat_id)),
                    f"{beat_id} narration changed; re-render that beat")
            require(metadata.get("captureSha256") == sha256_file(capture / f"{beat_id}.webm") and
                    metadata.get("captureMetadataSha256") == sha256_file(capture / f"{beat_id}.json"),
                    f"{beat_id} capture changed; re-render that beat")
            video_lines += [f"file 'segments/{beat_id}.mp4'", f"duration {duration:.6f}"]
            audio_lines += [f"file 'segments/{beat_id}.wav'", f"duration {duration:.6f}"]
        video_list, audio_list = capture / "video-concat.txt", capture / "audio-concat.txt"
        video_list.write_text("\n".join(video_lines) + "\n", encoding="utf-8")
        audio_list.write_text("\n".join(audio_lines) + "\n", encoding="utf-8")
        srt = capture / "captions.srt"
        write_srt(srt, captions)
        final = capture / "standby-demo.mp4"
        duration = number(project.get("durationSeconds"), "Storyboard duration")
        require(0 < duration < 180, "Storyboard must remain below three minutes")
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(video_list),
             "-f", "concat", "-safe", "0", "-i", str(audio_list), "-i", str(srt),
             "-map", "0:v:0", "-map", "1:a:0", "-map", "2:0", "-c:v", "copy",
             "-af", f"aresample=async=1:first_pts=0,apad,atrim=duration={duration:g}",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-c:s", "mov_text", "-t", f"{duration:g}",
             "-metadata:s:s:0", "language=eng", "-metadata", "title=Standby Operations Console",
             "-metadata", f"comment=Standby release {args.release}; dataset {project['datasetHash']}",
             "-movflags", "+faststart", str(final)])
        result = validate(probe_media(final), captions, args.release, duration)
        result.update({"sha256": sha256_file(final), "captionsSha256": sha256_file(capture / "captions.json")})
        (capture / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result))
        return 0
    except (OSError, KeyError, TypeError, json.JSONDecodeError, VerificationError) as error:
        print(f"FAIL demo rendering: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
