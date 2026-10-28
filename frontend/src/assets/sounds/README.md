# Game sound assets

Selected and converted on 2026-10-28. All five cues are by **Kenney Vleugels / Kenney.nl**, released under **Creative Commons Zero (CC0)**. The original license files from each downloaded pack are retained beside the WAV files. Attribution is appreciated by the creator and is not required.

## Sources

The files were downloaded from Kenney's own OpenGameArt uploads, after the main Kenney site returned HTTP 403 for archive downloads. No mirror audio is included.

| Pack | Creator page | Download actually used | Original license |
| --- | --- | --- | --- |
| Casino Audio 1.1 | [Kenney](https://kenney.nl/assets/casino-audio), [Kenney's OpenGameArt upload](https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips) | [kenney_casino-audio.zip](https://opengameart.org/sites/default/files/kenney_casino-audio.zip) | [casino-audio-LICENSE.txt](casino-audio-LICENSE.txt) |
| Interface Sounds 1.0 | [Kenney](https://kenney.nl/assets/interface-sounds), [Kenney's OpenGameArt upload](https://opengameart.org/content/interface-sounds) | [kenney_interfaceSounds.zip](https://opengameart.org/sites/default/files/kenney_interfaceSounds.zip) | [interface-sounds-LICENSE.txt](interface-sounds-LICENSE.txt) |
| Short Music Jingles | [Kenney](https://kenney.nl/assets/music-jingles), [Kenney's OpenGameArt upload](https://opengameart.org/content/85-short-music-jingles) | [jingleSounds_Kenney.zip](https://opengameart.org/sites/default/files/jingleSounds_Kenney.zip) | [music-jingles-LICENSE.txt](music-jingles-LICENSE.txt) |

CC0 reference: <https://creativecommons.org/publicdomain/zero/1.0/>.

## Selected cues

| Local asset | Source entry in downloaded archive | Duration | Bytes | Role |
| --- | --- | ---: | ---: | --- |
| `dice-roll.wav` | Casino: `Audio/dice-throw-2.ogg` | 0.3995 s | 17,664 | A short physical dice throw |
| `checker-hit.wav` | Casino: `Audio/chips-collide-1.ogg` | 0.2558 s | 11,326 | A distinct chip collision for a capture |
| `checker-bear-off.wav` | Casino: `Audio/chip-lay-1.ogg` | 0.1696 s | 7,522 | A softer chip placement when bearing off |
| `double-offer.wav` | Interface: `Audio/maximize_006.ogg` | 0.3761 s | 16,628 | A short cue for a new doubling offer |
| `victory.wav` | Jingles: `OGG/jingles_PIZZA/jingles_PIZZA10.ogg` | 0.7972 s | 35,200 | A short ascending pizzicato finish |

Total shipped audio: **88,340 bytes**. Cue selection used source names, decoded waveform metadata and pitch inspection; subjective listening and playback on physical devices remain user validation.

## Processing

- Decoded from the original Ogg files, mixed to mono and resampled by Chromium's `OfflineAudioContext` to 22,050 Hz.
- Encoded as uncompressed PCM16 WAV for broad browser decoding support; no new runtime dependency.
- Only leading/trailing samples below -60 dBFS were eligible for trimming, retaining 5 ms padding. This removed 3.9 ms from the end of the doubling cue; the other durations were retained.
- Applied a 2 ms edge fade and peak normalization. Peak targets: dice 0.70, capture 0.72, bear off 0.55, doubling 0.60, victory 0.70. No clipping was found in the resulting files.
- No pitch or playback-speed change. The original creator licenses are copied without modification.

## SHA-256

| Asset | Original Ogg SHA-256 | Shipped WAV SHA-256 |
| --- | --- | --- |
| `dice-roll` | `e0b8c370503b2c5c2a72d311cccae30fe63a6afd48f2be32e771fcf1a98585d6` | `35651f9c30aabfbc976a5c369ed8afccd8503f56b1bdddeabbe2ad777a819221` |
| `checker-hit` | `f41b3d106360fc68ebc061a211d4265b4cb5fa1fbe86e4d57d3673510e2c3784` | `192d11aa08c2b94333cfb8f219275638f3a71d9364e7ef407f0b7de7b8bb4639` |
| `checker-bear-off` | `4b2111252ccb64eed67f171e061053849cfbb29873536c03948646f244a3905c` | `37b676d383c8c7051720d492580c5f4aa516183878018e7bf78f5eff0ec2656e` |
| `double-offer` | `f050b3bb77cb0b901bc8df43d2cc1872c353aebae10b4030cf8ae681726ad343` | `0070654cc9f65078f86431ffbdeeeb2545c123b234c969edefb86d1fa8434bab` |
| `victory` | `baf50beffc4cc2dbb92c9d596a22732a8b5249c7648b681c0df6d0af6c561478` | `550eefda5ec1811283ef37145122070b2941255091d44ca5679065bcbcd6f5b8` |

Downloaded archive SHA-256 values:

- Casino: `f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18`
- Interface: `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`
- Jingles: `be324b6cf26e35c95c2a344569a2470512819d0246cc81328bef3499de3682e5`
