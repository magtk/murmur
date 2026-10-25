# Changelog

All notable changes to murmur are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [1.2.0] - 2026-10-25

### Added
- Short 10-character join code (e.g. `K7M2P-9XQ4R`) for typing by hand; shown in the share dialog and on the full-screen QR.
- "Join a board" field on the start page.
- Search and AI discoverability: static description in `index.html`, schema.org `WebApplication` data, Open Graph tags, `sitemap.xml`, `llms.txt`, `robots.txt` template.
- Version number in the start-page footer, linking to this changelog.

### Changed
- New boards use the short code in links (`…/murmur/#k7m2p-9xq4r`). Links created by earlier versions keep working.

## [1.1.0] - 2026-10-24

### Added
- Board lifetime: 7/14/21/30 days after the last change (default 21), warning 3 days before expiry, export prompt after expiry, automatic removal 7 days later.
- Automatic cleanup of participants' cached board views after 30 days.
- Logo, favicon, home-screen icon, 500×500 avatar and 1280×640 social preview image.
- Grouping without drag and drop: *Group* field in the card edit dialog (keyboard accessible).

### Changed
- Colours meet WCAG 2.2 AA contrast in light and dark themes (axe-core audit: 0 violations).
- Logo colours adjusted to stay distinguishable with colour vision deficiencies.
- Minimum text size 11 px; larger touch targets.

### Fixed
- Dropdown menus no longer overflow the screen on phones.
- Cards no longer replay their entrance animation on every board update.

## [1.0.0] - 2026-10-24

### Added
- Board with sections and cards, voting, grouping by drag and drop, sorting.
- Join via QR code or link, no account; anonymous by default, optional pseudonyms.
- "Think first" mode: hide cards until reveal, with timer.
- Short single/multiple-choice quizzes with timer and live results.
- Participant counter (connected / contributed).
- Export to JSON, Markdown, PNG and print/PDF; board templates in `boards/`.
- Polish and English interface; light, dark and system theme; projector mode.
- Peer-to-peer, no backend (WebRTC via Trystero, Nostr signalling); instructor verification by ECDSA key fingerprint.
- PolyForm Noncommercial 1.0.0 licence; commercial licence on request.

[1.2.0]: https://github.com/magtk/murmur/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/magtk/murmur/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/magtk/murmur/releases/tag/v1.0.0
