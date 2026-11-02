"""Offline boundary controls. No browser, media execution or network."""
import io
import copy
import json
from unittest.mock import patch
import final_contract as contract
import stat
import unittest
import zipfile
import importlib.util
from pathlib import Path
from final_contract import FILES, safe_name, validate_archive, checked_render_command
from check_final_color import check_pixels


class ContractControls(unittest.TestCase):
    def test_colour_criteria_reject_independent_posterization_and_round_trip_errors(self):
        check_pixels({'meanAbsoluteRgbError': 0, 'maxChannelError': 0, 'darkGreyRedLevels': 46})
        for metrics in [
            {'meanAbsoluteRgbError': 4.2, 'maxChannelError': 23, 'darkGreyRedLevels': 32},
            {'meanAbsoluteRgbError': 0, 'maxChannelError': 0, 'darkGreyRedLevels': 30},
            {'meanAbsoluteRgbError': .2, 'maxChannelError': 12, 'darkGreyRedLevels': 46},
        ]:
            with self.assertRaisesRegex(ValueError, 'colour preservation'):
                check_pixels(metrics)

    def test_canonical_names_are_closed(self):
        self.assertEqual(len(FILES), 40)
        self.assertIn('live/source/S7.mp4', FILES)
        self.assertNotIn('live/S7.mp4', FILES)
        self.assertNotIn('scripts/capture_app.mjs', FILES)
        self.assertNotIn('audio/cache/token.mp3', FILES)

    def test_independent_unsafe_paths(self):
        for name in ['/etc/passwd', '../timeline.json', 'scenes/../../x', 'C:\\secret', 'audio\\S1.mp3']:
            self.assertFalse(safe_name(name), name)
        self.assertTrue(safe_name('live/source/S4.mp4'))

    def test_extra_execution_entry_refused_before_body_read(self):
        with zipfile.ZipFile(io.BytesIO(), 'w') as archive:
            archive.writestr('scripts/capture_app.mjs', 'do not execute')
            with self.assertRaisesRegex(ValueError, 'Unexpected packet entries'):
                validate_archive(archive)

    def test_duplicate_archive_refused(self):
        with zipfile.ZipFile(io.BytesIO(), 'w') as archive:
            for name in FILES | {'manifest.json'}:
                archive.writestr(name, 'x')
            archive.writestr('timeline.json', 'other')
            with self.assertRaises(ValueError):
                validate_archive(archive)

    def test_symlink_refused(self):
        with zipfile.ZipFile(io.BytesIO(), 'w') as archive:
            for name in FILES | {'manifest.json'}:
                info = zipfile.ZipInfo(name)
                info.external_attr = (stat.S_IFLNK if name == 'timeline.json' else stat.S_IFREG) << 16
                archive.writestr(info, 'x')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                validate_archive(archive)

    def test_render_command_uses_only_exact_local_renderer_and_full_scale(self):
        project = Path('/approved/project')
        command = ['node', str(project / 'scripts/render_scene.mjs'), 'scenes/S1.html?label=approved', 'rendered/S1.mp4', '--fps', '25']
        self.assertEqual(checked_render_command(command, project, {'rendered/S1.mp4'}, set()), command)
        for mutation in [command + ['--scale', '.5'], ['bash', *command[1:]], [*command[:3], '../outside.mp4', *command[4:]], [*command[:4], '--fps', '30']]:
            with self.assertRaises(ValueError):
                checked_render_command(mutation, project, {'rendered/S1.mp4'}, set())
        with self.assertRaises(ValueError):
            checked_render_command(command, project, {'rendered/S1.mp4'}, {'rendered/S1.mp4'})

    def test_ass_conversion_keeps_commas_newlines_and_refuses_late_cues(self):
        spec = importlib.util.spec_from_file_location('final_renderer', Path(__file__).with_name('final-render.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cue = 'Dialogue: 0,0:00:00.35,0:00:02.00,Default,,0,0,0,,{\\b1}Hello, world\\NSecond line'
        self.assertEqual(module.srt_from_ass(cue), '1\n00:00:00,350 --> 00:00:02,000\nHello, world\nSecond line\n')
        with self.assertRaises(ValueError):
            module.srt_from_ass(cue.replace('0:00:02.00', '0:03:00.00'))


FIXTURE = Path(__file__).with_name('fixtures') / 'narrative_revision_1.json'


class RevisionControls(unittest.TestCase):
    def setUp(self):
        self.narration = json.loads(FIXTURE.read_text(encoding='utf-8'))
        # Independently fixed measured lengths; these are synthetic, not actual
        # narration fit claims. All density criteria were fixed before new audio.
        durations = [10.8, 10.8, 10.8, 18.3, 25.3, 26.3, 24.3, 12.3, 11.4]
        self.measured = {f'S{i}': {'duration': value} for i, value in enumerate(durations, 1)}

    def test_exact_editorial_fixture_is_bound_without_production_metadata(self):
        self.assertEqual(contract.narrative_subset_sha(self.narration), '24a9e13b925afcff4b4b0c61db695fbddde8331fa12649a51315d1bf3eed7db1')
        self.narration['notes'] = ['metadata can record the actual approved voice later']
        self.assertEqual(contract.narrative_subset_sha(self.narration), contract.REVISION_NARRATION_SUBSET)
        for key, value in [('speechText', 'Different claim.'), ('captionText', 'Different caption.'),
                           ('window_end', 13), ('audio_offset', .35), ('tail_hold', .3), ('caption_margin_v', 90)]:
            changed = copy.deepcopy(self.narration)
            changed['segments'][0][key] = value
            self.assertNotEqual(contract.narrative_subset_sha(changed), contract.REVISION_NARRATION_SUBSET, key)

    def test_unknown_actual_voice_bindings_always_refuse(self):
        for receipt, provider in [(None, None), ('TO_BE_FILLED', {}), ('a' * 64, {})]:
            with patch.object(contract, 'REVISION_VOICE_RECEIPT', receipt), patch.object(contract, 'REVISION_VOICE_PROVIDER', provider):
                with self.assertRaisesRegex(ValueError, 'not sealed'):
                    contract.validate_revision_authority({}, {}, self.narration, b'{}')

    def test_changed_text_refused_even_with_configured_voice_bindings(self):
        self.narration['segments'][6]['speechText'] += ' This is a guaranteed forecast.'
        binding = {'narrativeSubsetSha256': contract.REVISION_NARRATION_SUBSET}
        with patch.object(contract, 'REVISION_VOICE_RECEIPT', 'a' * 64), patch.object(contract, 'REVISION_VOICE_PROVIDER', {'service': 'fixture', 'voice': 'fixture'}):
            with self.assertRaisesRegex(ValueError, 'narration changed'):
                contract.validate_revision_authority(binding, binding, self.narration, b'{}')

    def test_dense_synthetic_measurements_fit_without_changing_windows(self):
        result = contract.revision_audio_density(self.narration, self.measured)
        self.assertAlmostEqual(result['totalMeasuredAudioSeconds'], 150.3)
        self.assertAlmostEqual(result['finalTailSeconds'], 2.4)
        self.assertLessEqual(max(result['interwindowGapsSeconds']), 3.5)

    def test_actual_rejected_r2_lengths_remain_a_density_negative(self):
        original = [5.64, 6.936, 10.392, 13.728, 11.664, 14.328, 9.816, 10.176, 8.712]
        measured = {f'S{i}': {'duration': value} for i, value in enumerate(original, 1)}
        self.assertAlmostEqual(sum(original), 91.392)
        with self.assertRaisesRegex(ValueError, 'below 140'):
            contract.revision_audio_density(self.narration, measured)

    def test_total_duration_alone_cannot_hide_a_long_gap(self):
        self.measured['S5']['duration'] = 22
        self.assertGreater(sum(row['duration'] for row in self.measured.values()), 140)
        with self.assertRaisesRegex(ValueError, 'gap exceeds 3.5'):
            contract.revision_audio_density(self.narration, self.measured)

    def test_final_hold_bounds_are_both_enforced(self):
        self.measured['S9']['duration'] = 10
        with self.assertRaisesRegex(ValueError, 'final tail'):
            contract.revision_audio_density(self.narration, self.measured)
        self.measured['S9']['duration'] = 12
        with self.assertRaisesRegex(ValueError, 'overruns'):
            contract.revision_audio_density(self.narration, self.measured)

    def test_missing_nonfinite_and_overlapping_measurements_refuse(self):
        for bad in [float('nan'), float('inf'), -1, 0, 12]:
            measured = copy.deepcopy(self.measured)
            measured['S1']['duration'] = bad
            with self.assertRaises(ValueError):
                contract.revision_audio_density(self.narration, measured)
        del self.measured['S7']
        with self.assertRaisesRegex(ValueError, 'Nine'):
            contract.revision_audio_density(self.narration, self.measured)


if __name__ == '__main__':
    unittest.main()
