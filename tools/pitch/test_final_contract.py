"""Offline boundary controls. No browser, media execution or network."""
import io
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


if __name__ == '__main__':
    unittest.main()
