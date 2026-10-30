"""Offline, dependency-free checks proving the media validator fails closed."""
import unittest

from verify import VerificationError, validate
from render import validate_capture_clock

RELEASE = "a" * 40


class VerifyDemoTests(unittest.TestCase):
    def setUp(self):
        self.probe = {"streams": [
            {"codec_type": "video", "start_time": "0.000000", "duration": "145.000000", "avg_frame_rate": "30/1", "width": 1440, "height": 900},
            {"codec_type": "audio", "start_time": "0.000000", "duration": "145.000000"},
        ], "format": {"duration": "145.000000", "tags": {"comment": f"Standby release {RELEASE}"}}}
        self.captions = {"releaseSha": RELEASE, "fps": 30, "durationSeconds": 145,
                         "cues": [{"startSeconds": 0, "endSeconds": 5, "text": "Actual working application."},
                                  {"startSeconds": 140, "endSeconds": 145, "text": "Model assumptions remain visible."}]}

    def test_accepts_aligned_streams_and_in_bounds_captions(self):
        self.assertEqual(validate(self.probe, self.captions, RELEASE, 145)["status"], "PASS")

    def test_audio_end_uses_nonzero_offset(self):
        self.probe["streams"][1]["start_time"] = "0.120000"
        with self.assertRaisesRegex(VerificationError, "more than one video frame"):
            validate(self.probe, self.captions, RELEASE)

    def test_rejects_caption_that_exceeds_video(self):
        self.captions["cues"][-1]["endSeconds"] = 145.04
        with self.assertRaisesRegex(VerificationError, "outside the video"):
            validate(self.probe, self.captions, RELEASE)

    def test_rejects_exactly_three_minutes(self):
        for stream in self.probe["streams"]:
            stream["duration"] = "180.000000"
        self.probe["format"]["duration"] = "180.000000"
        with self.assertRaisesRegex(VerificationError, "strictly below three minutes"):
            validate(self.probe, self.captions, RELEASE)

    def test_rejects_wrong_release_and_overlapping_captions(self):
        with self.assertRaisesRegex(VerificationError, "Caption release"):
            validate(self.probe, self.captions, "b" * 40)
        self.captions["cues"][1]["startSeconds"] = 4.9
        with self.assertRaisesRegex(VerificationError, "overlaps"):
            validate(self.probe, self.captions, RELEASE)

    def test_rejects_missing_audio_instead_of_passing_file_existence(self):
        self.probe["streams"] = self.probe["streams"][:1]
        with self.assertRaisesRegex(VerificationError, "one audio stream"):
            validate(self.probe, self.captions, RELEASE)

    def test_legacy_page_creation_clock_is_rejected(self):
        with self.assertRaisesRegex(VerificationError, "legacy inferred pre-roll"):
            validate_capture_clock({"schemaVersion": 1, "trimStartSeconds": 23}, 25)

    def test_actual_frame_span_and_action_window_are_required(self):
        epoch = 1793370000123
        metadata = {"schemaVersion": 2, "trimStartSeconds": 0, "captureClock": {
            "method": "playwright-screencast", "firstPresentedAtUnixMs": epoch,
            "lastPresentedAtUnixMs": epoch + 25100, "actionsCompletedAtUnixMs": epoch + 23000,
            "framesObserved": 38}}
        validate_capture_clock(metadata, 25)
        metadata["captureClock"]["lastPresentedAtUnixMs"] = epoch + 23980
        with self.assertRaisesRegex(VerificationError, "frame span is shorter"):
            validate_capture_clock(metadata, 25)
        metadata["captureClock"]["lastPresentedAtUnixMs"] = epoch + 26000
        metadata["captureClock"]["actionsCompletedAtUnixMs"] = epoch + 25500
        with self.assertRaisesRegex(VerificationError, "actions overran"):
            validate_capture_clock(metadata, 25)

    def test_native_slate_receipt_uses_decoded_offset_and_strict_action_budget(self):
        metadata = {"schemaVersion": 3, "trimStartSeconds": 3.2,
                    "syncProof": {"method": "decoded-magenta-slate", "markerFrames": 30, "firstClearFramePtsSeconds": 3.2},
                    "captureClock": {"method": "native-screencast-slate", "storyAnchorAtUnixMs": 1793370000000,
                                     "actionsCompletedAtUnixMs": 1793370023000, "semanticElapsedSeconds": 23}}
        validate_capture_clock(metadata, 30)
        metadata["captureClock"]["semanticElapsedSeconds"] = 30.1
        with self.assertRaisesRegex(VerificationError, "actions overran"):
            validate_capture_clock(metadata, 30)


if __name__ == "__main__":
    unittest.main()
