"""One-frame decoded-pixel controls using the sealed composer's actual overlay method.

No video codec, browser, network, capture or voice generation. The legacy mutation
must fail the same pixel limits before a full final composition may start.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from final_contract import SCRIPTS, require

WIDTH, HEIGHT = 256, 96


def pixel_metrics(reference, actual):
    require(len(reference) == len(actual) == WIDTH * HEIGHT * 3, 'Diagnostic frame size')
    delta = [abs(a - b) for a, b in zip(reference, actual)]
    return {'meanAbsoluteRgbError': sum(delta) / len(delta),
            'maxChannelError': max(delta),
            'darkGreyRedLevels': len({actual[x * 3] for x in range(WIDTH)}),
            'sha256': hashlib.sha256(actual).hexdigest()}


def check_pixels(metrics):
    # Fixed independent pixel criteria: transparent/disabled overlays must retain
    # a dark ramp to within normal single-conversion rounding, not 14 round trips.
    require(metrics['meanAbsoluteRgbError'] <= .75 and metrics['maxChannelError'] <= 3
            and metrics['darkGreyRedLevels'] >= 45, 'Overlay colour preservation failed')


def check(composer, out):
    composer, out = Path(composer).resolve(), Path(out).resolve()
    require(hashlib.sha256(composer.read_bytes()).hexdigest() == SCRIPTS['compose.py'], 'Unreviewed diagnostic composer')
    spec = importlib.util.spec_from_file_location('sealed_colour_composer', composer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'composerSha256': SCRIPTS['compose.py'],
              'geometry': [WIDTH, HEIGHT], 'framesPerCase': 1, 'codecEncodes': 0, 'cases': {}}
    try:
        with tempfile.TemporaryDirectory(prefix='colour-', dir=out) as directory:
            temp = Path(directory)
            rgb = bytearray()
            for y in range(HEIGHT):
                for x in range(WIDTH):
                    value = x // 4
                    rgb.extend((value, value, value) if y < 32 else
                               (value // 2, value, value + 10) if y < 64 else (x, x, x))
            base = temp / 'ramp.ppm'
            base.write_bytes(f'P6\n{WIDTH} {HEIGHT}\n255\n'.encode() + rgb)
            header = f'P7\nWIDTH {WIDTH}\nHEIGHT {HEIGHT}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n'.encode()
            transparent, patch = temp / 'transparent.pam', temp / 'patch.pam'
            transparent.write_bytes(header + bytes(WIDTH * HEIGHT * 4))
            rgba = bytearray(WIDTH * HEIGHT * 4)
            for y in range(40, 56):
                for x in range(192, 224):
                    at = (y * WIDTH + x) * 4
                    rgba[at:at + 4] = bytes((220, 32, 16, 255))
            patch.write_bytes(header + rgba)

            def decode(graph):
                command = ['ffmpeg', '-nostdin', '-v', 'error', '-filter_complex_threads', '1',
                           '-i', str(base), '-i', str(transparent), '-i', str(patch),
                           '-filter_complex', graph, '-map', '[out]', '-frames:v', '1',
                           '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
                result = subprocess.run(command, capture_output=True, timeout=30, check=True)
                require(len(result.stdout) == WIDTH * HEIGHT * 3, 'Missing decoded diagnostic frame')
                return result.stdout

            reference = decode('[0:v]format=yuv420p,format=rgba,format=yuv420p,format=rgb24[out]')

            def actual_graph(count, enabled=False, colour_patch=False):
                graph = module.Graph(WIDTH, HEIGHT, 25, WIDTH, {}, {})
                graph.chains.append('[0:v]format=yuv420p[base]')
                current = 'base'
                for index in range(count):
                    start = 0 if enabled else 1 + index / 10
                    current = graph.overlay(current, 2 if colour_patch and index == count - 1 else 1,
                                            index, start, start + 1)
                graph.chains.append(f'[{current}]format=yuv420p,format=rgb24[out]')
                return ';'.join(graph.chains)

            for name, count, enabled in [('one_disabled', 1, False), ('fourteen_disabled', 14, False),
                                          ('fourteen_transparent_enabled', 14, True)]:
                actual = decode(actual_graph(count, enabled))
                metrics = pixel_metrics(reference, actual)
                check_pixels(metrics)
                report['cases'][name] = metrics

            # A real opaque patch must still be composited; omitting every layer
            # cannot satisfy this control even if its dark pixels are unchanged.
            composited = decode(actual_graph(14, True, True))
            centre = (48 * WIDTH + 208) * 3
            require(all(abs(a - b) <= 5 for a, b in zip(composited[centre:centre + 3], (220, 32, 16))), 'Real alpha overlay was not applied')
            # Compare with an independent single alpha composite. Chroma filtering
            # can legitimately affect adjacent rows, so an arbitrary crop is not
            # an exact-pixel reference for a coloured patch in 4:2:0 output.
            patch_reference = decode('[0:v]format=yuv420p,format=rgba[main];'
                                     '[2:v]format=rgba[patch];'
                                     '[main][patch]overlay=0:0:format=auto,format=yuv420p,format=rgb24[out]')
            patch_metrics = pixel_metrics(patch_reference, composited)
            check_pixels(patch_metrics)
            report['cases']['real_alpha_patch'] = {'centreRgb': list(composited[centre:centre + 3]), 'againstSingleComposite': patch_metrics}

            # Deliberately restore the exact defect in the actual generated graph.
            # The unchanged pixel gate must reject it, without inspecting graph text.
            legacy = actual_graph(14).replace('format=rgba[xo', 'format=yuv420p[xo')
            bad = pixel_metrics(reference, decode(legacy))
            try:
                check_pixels(bad)
            except ValueError:
                report['negativeControl'] = {'status': 'LEGACY_ROUND_TRIPS_REJECTED', 'metrics': bad}
            else:
                raise ValueError('Colour negative control unexpectedly passed')
        report['status'] = 'PASS_ACTUAL_COMPOSER_DECODED_COLOUR'
    except Exception as error:
        report.update(status='fail', errorClass=type(error).__name__, error=str(error))
        raise
    finally:
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--composer', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    check(args.composer, args.out)
