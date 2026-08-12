# SpeedPup Architecture

## Goals

- Native Cinnamon desklet.
- Passive live network throughput monitoring.
- On-demand internet speed test.
- No blocking I/O on Cinnamon's UI thread.
- No shell command construction from user-controlled input.
- Clean lifecycle cleanup when the desklet is removed.
- Self-contained Cinnamon Spice code.
- External tools, if used, must come from the distribution package manager.

## Planned components

1. Desklet UI
2. Asynchronous network counter reader
3. Speed-test provider runner
4. Result parser
5. Cinnamon xlet settings
6. Optional history stored outside the installation directory

## Data ownership

Runtime data must never be written into the installed desklet directory.
Persistent data, if added, should use an appropriate user state/cache
directory keyed by the SpeedPup UUID.
