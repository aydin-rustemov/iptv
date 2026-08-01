# Personal IPTV Local MVP

[x] Verified complete - `npm run typecheck` passes.
[x] Verified complete - `npm test` passes outside the sandbox; sandboxed Vitest cannot read `vitest.config.ts`.
[x] Verified complete - `npm run verify` passes outside the sandbox for the same Vitest sandbox limitation.
[x] Verified complete - `npm run scan` completed discover, check, and generate.
[x] Verified complete - Generated JSON artifacts parse and playlists start with `#EXTM3U`.
[x] Verified complete - Local server endpoints return HTTP 200 with CORS and no-cache headers.
[x] Verified complete - Encoded directory traversal is blocked.
[!] Blocked or partial - Azerbaijani priority objective is partial: Xəzər TV validated as stable portable; most other priority channels were invalid or undiscovered in this scan.
[!] Blocked or partial - Russian adapter objective is partial: `iptv-cat` ran safely but found no candidates because its configured URLs returned 404.
[!] Blocked or partial - Canlitv.com ran safely but found no candidates in the bounded scan.

## Phase 2 Coverage Improvement

[x] Verified complete - Replaced first-come global truncation with priority/source/country quota selection.
[x] Verified complete - Added bounded media segment sampling; AzTV and İctimai TV now validate as stable portable.
[x] Verified complete - Canlitv.com extracts Azerbaijani channel links first and produced candidates in the live scan.
[x] Verified complete - Added iptv-org Russian/Russian-language candidate adapter; Russian stable portable count reached 25.
[x] Verified complete - `npm run debug:channel -- "AzTV"` ran and showed stable portable validation.
[x] Verified complete - `npm run debug:channel -- "İctimai TV"` ran and showed stable portable validation.
[x] Verified complete - `npm run debug:channel -- "CBC Sport"` ran and classified the failure as `read_timeout` / `ECONNRESET`.
[x] Verified complete - Final Phase 2 scan generated 50 stable portable playlist entries.
[!] Blocked or partial - Turkish stable portable count reached 11, below the 15-channel target.
[!] Blocked or partial - Azerbaijani stable portable count reached 12 total AZ channels, but only 3 of the named priority channels are stable portable.
