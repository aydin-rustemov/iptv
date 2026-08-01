# MASTER IMPLEMENTATION PROMPT

You are the principal engineer responsible for implementing a complete new project from the documentation in this workspace.

The workspace initially contains only this implementation prompt and the approved Markdown specifications under `docs/`.

## Mission

Build a production-quality, official-source-only IPTV playlist automation system from scratch.

The finished project must:

- use Node.js 24 LTS and TypeScript with native ESM;
- maintain a curated registry of official Azerbaijani, Turkish, and Russian TV channel candidates;
- resolve supported official source types;
- securely validate actual HLS media playback rather than trusting HTTP status alone;
- generate a stable M3U playlist containing only currently acceptable streams;
- generate status and research reports;
- generate a static HTML dashboard;
- include a scheduled GitHub Actions workflow that runs every three hours;
- publish generated files through a `gh-pages` branch;
- preserve the previous successful output when a new run is unsafe or invalid;
- include comprehensive automated tests using local fixtures and local mock servers;
- pass formatting, linting, type checking, tests, build, and local generation checks.

## Required first action

Before creating or modifying project files:

1. Read every Markdown file in `docs/`.
2. Read them in filename order.
3. Treat `docs/00_DECISIONS.md` as binding.
4. Produce a concise internal implementation checklist.
5. Inspect the workspace to ensure it does not already contain source code that would be overwritten.

Do not ask the user to repeat information already contained in the documents.

## Execution mode

This is a one-session end-to-end implementation task.

Work through the implementation phases sequentially, but do not stop after each phase for approval. Continue until the full version 1 implementation is complete or a genuine external blocker makes completion impossible.

After each phase:

- run the relevant tests;
- fix failures within the approved architecture;
- verify that later work has not broken earlier acceptance criteria.

Do not merely create placeholders and claim completion.

## Non-negotiable constraints

You must not:

- initialize Git;
- create a GitHub repository;
- configure a remote;
- commit or push;
- add pirate, leaked, paid-provider, credential-based, or unverified streams;
- bypass DRM, authentication, login, cookies, geographic restrictions, or access controls;
- proxy or restream television content;
- store stream content in the repository;
- use arbitrary web scraping to auto-publish unknown links;
- execute JavaScript from broadcaster pages;
- use a headless browser in version 1;
- implement YouTube stream extraction;
- implement ffprobe in version 1;
- add a database;
- add Docker;
- add a frontend framework;
- weaken SSRF controls to make a stream pass;
- silently ignore a failing security test;
- generate fake channel records to reach 250–300 entries;
- claim all channels are permanently available.

## Documentation authority

Implement exactly what is specified in the documents. When documents conflict, use the precedence in `START_HERE.md`.

If a requirement is impossible in the current environment:

1. continue all independent work;
2. implement a safe degraded path;
3. record the limitation in the final report;
4. do not fabricate success.

## Technology baseline

Use the stack approved in the documentation:

- Node.js 24 LTS;
- npm;
- TypeScript;
- native ESM;
- strict TypeScript;
- Vitest;
- ESLint flat config;
- Prettier;
- Zod;
- YAML parser;
- Node core networking wherever practical;
- a maintained HLS manifest parser if required;
- vanilla generated HTML, CSS, and JavaScript for the dashboard.

Choose stable package versions available at implementation time. Save exact dependency versions and generate `package-lock.json` through npm.

Avoid unnecessary dependencies.

## Required repository outcome

Create the repository structure described in `docs/02_ARCHITECTURE.md`.

At minimum, the final project must include:

- project tooling and scripts;
- typed configuration models;
- country-separated channel registry files;
- registry schema validation;
- official-source evidence validation;
- source adapters approved for version 1;
- SSRF-safe URL and redirect validation;
- HLS master/media manifest validation;
- media segment checks;
- retries, timeout handling, concurrency limits, and per-domain limits;
- channel status classification;
- deterministic M3U generation;
- JSON status output;
- failed/unsupported/research reports;
- static dashboard generation;
- state history loading and updating;
- catastrophic-output safety guard;
- GitHub Actions workflow;
- GitHub Pages branch deployment script or workflow steps;
- automated tests;
- README and operator instructions.

## Channel population requirement

Populate the registry only with sources that can be supported by evidence.

For each accepted channel record:

- identify the broadcaster;
- record an official website or official live page;
- record source evidence;
- classify the source type;
- record the stream or the approved official resolver configuration;
- record geographic expectations;
- mark the verification state accurately.

Use available browsing or research tools when present.

Community lists may be used only to discover candidates. They are not proof of official authorization.

When a source cannot be proven or technically supported:

- do not place it in the main active registry as publishable;
- add it to a research backlog or unsupported official source report;
- explain why it was excluded.

The target is approximately 250–300 candidate records, not 250–300 guaranteed playable channels. Do not sacrifice policy compliance to reach the target.

If the environment does not allow reliable source research, complete the platform and add only genuinely verified records, then clearly report the remaining channel research gap.

## Version 1 source support

Implement:

- permanent direct official HLS URLs;
- official HLS master playlists;
- official HLS media playlists;
- curated official JSON endpoint resolution using explicit configured paths;
- curated official HTML text extraction only when an exact, documented pattern is configured and no JavaScript execution is required.

Detect and exclude:

- DRM;
- DASH-only streams;
- login-required streams;
- cookie-dependent streams;
- short-lived signed/tokenized streams that cannot be refreshed through an approved official endpoint;
- iframe-only unsupported players;
- application-only streams;
- YouTube live streams;
- unknown or unverified sources.

## Validation behavior

A stream is not working merely because it returns HTTP 200.

The checker must enforce the pipeline in `docs/06_STREAM_VALIDATION.md`, including:

- secure DNS resolution;
- public-IP enforcement;
- secure redirect validation;
- response size limits;
- manifest parsing;
- variant resolution;
- media playlist checks;
- at least two recent media segment checks;
- non-empty media validation;
- HTML/error-page detection;
- detailed failure reasons.

## Output policy

The primary playlist is the user-facing stable playlist.

Version 1 must:

- add a new channel after two consecutive successful validation runs;
- keep an existing channel after one transient failure;
- remove or quarantine it after two consecutive failures;
- immediately exclude policy violations, private-address redirects, malformed sources, DRM, login requirements, and security failures;
- never replace a valid deployed playlist with an unexpectedly empty or catastrophically reduced result.

Generate an additional diagnostic `current-working.m3u` only if required by the documentation. Do not label it as the primary user playlist.

## State and deployment

Do not write generated state into the main branch during scheduled runs.

Use the `gh-pages` branch for generated public output and runtime state as specified.

The workflow must:

- support `workflow_dispatch`;
- run at `17 */3 * * *`;
- prevent overlapping runs;
- use minimal permissions;
- pin official GitHub Actions to immutable commit SHAs where practical;
- use deterministic installation;
- run validation before deployment;
- preserve the prior deployment when generation fails;
- publish a useful job summary.

The local implementation must not initialize Git. The workflow files and scripts may still be created and tested structurally.

## Testing

Tests must not depend on real television streams.

Use local fixtures and temporary local HTTP servers.

Include the complete critical test matrix in `docs/10_TESTING.md`, especially:

- SSRF and redirect attacks;
- HLS master/media parsing;
- segment failures;
- timeout and retry behavior;
- deterministic playlist generation;
- Unicode metadata;
- state transitions;
- catastrophic deployment guard;
- generated dashboard escaping;
- registry schema and duplicate validation.

## Required scripts

Provide clear npm scripts including, where appropriate:

- `dev`
- `build`
- `start`
- `format`
- `format:check`
- `lint`
- `typecheck`
- `test`
- `test:watch`
- `test:coverage`
- `registry:validate`
- `streams:check`
- `generate`
- `pipeline`
- `check`

The `check` script must be non-mutating.

## Verification loop

Before completion, run and fix until successful:

1. dependency installation;
2. formatting;
3. linting;
4. type checking;
5. full tests;
6. coverage;
7. production build;
8. registry validation;
9. an offline/local-fixture generation smoke test;
10. complete `npm run check`.

Do not run live-source checks in automated unit tests.

A separate live verification command may be run when network access is available, but failures caused by region restrictions must be classified rather than hidden.

## Final audit

Before reporting completion:

- list the complete file tree;
- inspect for secrets;
- inspect for hardcoded tokens;
- inspect for private or localhost URLs in active channel records;
- ensure generated directories are correctly ignored;
- verify that no documentation was silently weakened;
- verify Git was not initialized;
- verify no unauthorized network proxy or restream service was added;
- verify the workflow cannot overwrite a valid deployment with invalid output.

## Required final report

Return a detailed report with exactly these headings:

1. `Implementation Verdict`
2. `Documentation Reviewed`
3. `Architecture Implemented`
4. `Files Created`
5. `Files Modified`
6. `Dependencies`
7. `Channel Registry Summary`
8. `Official Source Evidence Summary`
9. `Validation Pipeline`
10. `Security Controls`
11. `Generated Outputs`
12. `GitHub Workflow`
13. `Tests Added`
14. `Commands Run`
15. `Failures Found and Fixed`
16. `Final Verification Results`
17. `Known Limitations`
18. `Manual GitHub Setup Required`
19. `Git Status Confirmation`
20. `Primary Playlist URL Format`

The final report must be truthful. Do not claim that live channels work unless they were actually validated from the current environment.

No Git initialization, commit, push, or remote creation.
