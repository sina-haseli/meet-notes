# Third-party notices

Meet Notes bundles these open-source libraries in `dist/`.

| Library | Version | Licence | Used for |
|---|---|---|---|
| @breezystack/lamejs (a fork of lamejs / LAME) | 1.2.7 | LGPL-3.0 | Encoding recorded audio to MP3 in the browser |
| marked | 18.1.3 | MIT | Rendering Markdown notes |
| fflate | 0.8.3 | MIT | Creating the notes .zip download |

## LGPL-3.0 (lamejs)

The MP3 encoder is used as an unmodified library under the GNU Lesser General Public
License v3.0 (https://www.gnu.org/licenses/lgpl-3.0.html). Its source code is available at
https://github.com/breezystack/lamejs and on npm as `@breezystack/lamejs`. Meet Notes' own
source is in the project repository, so the library can be replaced with a modified version
and the extension rebuilt (`npm install && npm run build`).

## MIT (marked, fflate)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, subject to the inclusion of the
copyright notice and this permission notice of each project in all copies or substantial
portions of the Software. The Software is provided "as is", without warranty of any kind.

Copyright holders: marked, Christopher Jeffrey and the marked contributors; fflate, Arjun Barrett.
