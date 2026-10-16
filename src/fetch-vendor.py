#!/usr/bin/env python3
"""Fetch the viewer's external dependencies into src/vendor/ so the built
HTML needs no network at all — the venue may have none on the day.

    python3 fetch-vendor.py

Writes vendor/three.min.js and vendor/fonts.css (woff2 inlined as data: URIs)
and prints a SHA-256 for each, so a later run can prove nothing drifted.
Only needs running again to change a version; the vendored files are committed.
"""
import base64, hashlib, pathlib, re, sys, urllib.request

HERE   = pathlib.Path(__file__).parent
VENDOR = HERE / 'vendor'

# r128 exactly: the viewer uses sRGBEncoding and Geometry APIs that later
# releases removed. Bumping this is a code change, not a refresh.
THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
# Mozilla's own two faces, released by Mozilla under the SIL Open Font License
# and served from Google Fonts. Both are variable across weight 200-700, so one
# file covers every weight the chrome uses: four faces here replace the eight
# static ones Archivo needed, and cost about a quarter of the bytes.
# IBM Plex Mono stays because Mozilla publishes no monospace, and the readout
# and the street labels need one.
FONTS_URL = ('https://fonts.googleapis.com/css2?family=Mozilla+Headline:wght@200..700'
             '&family=Mozilla+Text:wght@200..700'
             '&family=IBM+Plex+Mono:wght@400;500&display=swap')
# The OFL requires its notice and licence to travel with the font, and we embed
# the fonts in the HTML, so the licences are fetched and committed alongside.
LICENCES = {
    'OFL-Mozilla-Headline.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/mozillaheadline/OFL.txt',
    'OFL-Mozilla-Text.txt':     'https://raw.githubusercontent.com/google/fonts/main/ofl/mozillatext/OFL.txt',
    'OFL-IBM-Plex-Mono.txt':    'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt',
}
# Google serves woff2 only to a browser-shaped UA; anything else gets ttf.
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/131.0.0.0 Safari/537.36')
# Latin covers Spanish and Catalan; latin-ext is for the international speaker
# names the programme will bring. The other subsets are 100 KB of nothing.
SUBSETS = ('latin', 'latin-ext')


def get(url, ua=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA} if ua else {})
    return urllib.request.urlopen(req, timeout=60).read()


def sha(b): return hashlib.sha256(b).hexdigest()[:16]


def build_fonts_css():
    css = get(FONTS_URL, ua=True).decode()
    out, kept, skipped = [], 0, 0
    for subset, block in re.findall(r'/\* (\S+) \*/\s*(@font-face \{.*?\})', css, re.S):
        if subset not in SUBSETS:
            skipped += 1
            continue
        url = re.search(r'url\((https://[^)]+)\)', block).group(1)
        b64 = base64.b64encode(get(url)).decode()
        out.append(re.sub(r'url\(https://[^)]+\)',
                          f'url(data:font/woff2;base64,{b64})', block))
        kept += 1
    print(f'  fonts: {kept} faces embedded, {skipped} subsets dropped')
    return '\n'.join(out) + '\n'


def main():
    VENDOR.mkdir(exist_ok=True)

    three = get(THREE_URL)
    # An inline <script> ends at the first literal </script>, wherever it sits.
    if b'</script' in three.lower().replace(b'<\\/script', b''):
        sys.exit('three.min.js contains </script>: it cannot be inlined')
    (VENDOR / 'three.min.js').write_bytes(three)
    print(f'  three.min.js  {len(three):>8,} b  sha256:{sha(three)}  (r128)')

    css = build_fonts_css().encode()
    (VENDOR / 'fonts.css').write_bytes(css)
    print(f'  fonts.css   {len(css):>8,} b  sha256:{sha(css)}')

    for name, url in LICENCES.items():
        txt = get(url)
        (VENDOR / name).write_bytes(txt)
        print(f'  {name:<26} {len(txt):>7,} b')
    print('\nDone. Now: python3 build.py')


if __name__ == '__main__':
    main()
