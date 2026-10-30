import unittest
from sync import locate_slate
from verify import VerificationError


class SlateSyncTests(unittest.TestCase):
    def fixture(self):
        pts = [0, 1, 2, 3.167, 3.2, 4, 10, 33.2]
        pixels = bytes([255, 0, 255] * 4 + [20, 25, 35] * 4)
        return pts, pixels

    def test_actual_transition_at_three_point_two_ignores_creation_epoch(self):
        pts, pixels = self.fixture()
        proof = locate_slate(pts, pixels, 34, 30)
        self.assertEqual(proof["firstClearFramePtsSeconds"], 3.2)
        self.assertEqual(proof["markerFrames"], 4)

    def test_short_actual_media_fails_instead_of_padding(self):
        pts, pixels = self.fixture()
        with self.assertRaisesRegex(VerificationError, "after the decoded sync slate is too short") as failure:
            locate_slate(pts, pixels, 33.1, 30)
        self.assertEqual(failure.exception.sync_proof["firstClearFramePtsSeconds"], 3.2)
        self.assertEqual(failure.exception.sync_proof["sourceDurationSeconds"], 33.1)

    def test_noncontiguous_or_missing_slate_fails(self):
        pts, _ = self.fixture()
        with self.assertRaisesRegex(VerificationError, "no magenta"):
            locate_slate(pts, bytes([20, 25, 35] * len(pts)), 34, 30)
        with self.assertRaisesRegex(VerificationError, "not one contiguous"):
            locate_slate(pts, bytes([255, 0, 255] * 3 + [20, 25, 35] * 2 + [255, 0, 255] + [20, 25, 35] * 2), 34, 30)


if __name__ == "__main__":
    unittest.main()
