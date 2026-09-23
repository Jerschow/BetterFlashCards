# Heron v2.2 — release verification

Verified on September 23, 2026 in an isolated Next.js 16.2.6 / React 19.2.6 / TypeScript 5.9.3 project. Application dependencies remain ts-fsrs 5.4.2 and @supabase/supabase-js 2.116.0.

Passed checks:

- Optimized production build and strict TypeScript checking.
- 31 domain checks for migration, incomplete preference drafts, explicit skill selections, per-language daily goals, preservation of existing decks/reviews/exclusions/pending attempts, FSRS scheduling, Unicode masks and validated backups.
- 9 controlled API tests covering flexible English grading, exclusion of the reference/shell/target/script from grading input, exact source highlights, Chinese script variants, CJK grouping, contextual word capture, malformed output and authorization gates on every new AI action.
- 6 production Chromium browser scenarios covering welcome/account entry points, registration visibility during setup, language-appropriate goal examples, one radio selection per skill, per-language targets, Chinese script selection, draft/return persistence, source highlighting, clickable source and translated words, optional writing cards, brief feedback, legacy exercise enrichment, and independent daily-goal pauses.
- Desktop welcome and practice screens and the 390-pixel mobile skill grid were visually inspected. No horizontal mobile overflow or browser runtime errors occurred. The runner lacks a CJK font, so Chinese text was additionally verified through DOM assertions rather than its screenshot glyphs.
- Installer file-copy checks passed for both app/ and src/app/ layouts: new routes/helpers/components are copied, replaced files are backed up, and an existing .env.local is preserved. npm was stubbed for these file-copy checks; real pinned dependencies were installed in the verification project.

The model and API tests are included under tests/. They require esbuild in the development environment. Browser scenarios ran in a separate verification harness.

## Integration limits

AI responses were mocked: no live paid model call was used, so real teaching quality, latency, English-feedback consistency and multilingual/script accuracy still depend on the configured model. No real account email, cross-device Supabase session, payment checkout or public deployment was performed. Account sync and server authorization retain their existing design; this release adds account-entry controls but does not provision those services. Chromium was tested; Safari/iOS has not been checked for this release.
