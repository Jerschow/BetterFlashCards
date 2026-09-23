# Heron — version 2.2

A language-learning update for your existing Next.js App Router project, with personal vocabulary decks, sentence translation, FSRS reviews, accounts and optional writing practice.

## Install on your Mac

1. Export a vocabulary backup from your current app. Keep the same browser, address and port when opening the update: `localhost:3000` and `127.0.0.1:3000` have different browser storage.
2. Stop the development server with **Control-C** in Terminal.
3. Extract `heron-starter.zip`. If Finder adds a number to the extracted folder, use its actual name below.
4. Run:

```bash
cd ~/Projects/sentence-recall
bash ~/Downloads/heron-starter/install.sh
npm run dev -- --hostname 127.0.0.1
```

Requires Node.js 22 or newer. The installer supports `app` and `src/app`, installs pinned `ts-fsrs` and `@supabase/supabase-js` dependencies, and backs up replaced application files and package manifests. It preserves your layout, Next.js/React versions and `.env.local`. Keep your existing project folder name; the Heron rename does not change browser storage keys. Original v1 data is retained while a copy is migrated into decks.

## Welcome and preferences

New visitors first see **Welcome to Heron**, with **Get started** and **Sign in**. Setup collects:

- Your source language and learning languages.
- A goal for each language, with appropriate examples such as Spanish C1/C2, Japanese JLPT, and Chinese HSK/TOCFL.
- Separate speaking, writing, listening and reading levels. Select one circle per skill in the four-by-four grid: beginner, intermediate, advanced or native.
- A daily vocabulary target for each learning language.
- For Chinese, simplified, traditional or both scripts.

Unfinished preferences survive a refresh. Earlier users confirm the new skill selections once; existing decks, exclusions, reviews, writing schedules and pending answers are preserved. Returning learners then go straight to practice. Use **Settings → Edit learning preferences** to change your answers. Removing a learning language from preferences does not delete its decks.

Personalized setup generates five words for your first learning language; other language decks retain their own preferences and can generate words when selected. You can instead add your own words or choose the prepared English-to-Spanish examples. Failed generation preserves your setup answers.

**Sign in** is available in the header throughout the app. **Register** is available outside the preferences flow. Signed-in users see **Account**. These controls require the account configuration described below to authenticate users.

## Practice and vocabulary

Translate the source sentence, where the vocabulary being tested is highlighted. Reveal only the hints you need. Chinese/Japanese length hints use a box for each word group and an underscore for each character or kana; the target remains hidden until explicitly revealed.

**Check with AI** returns brief feedback in English. The grader receives the source sentence, your translation and the language pair—not the shell, target word, reference answer or chosen Chinese script. Its instructions accept valid word order, synonyms, regional variants such as 玩/玩儿, and either Chinese script. A reference sentence is one possible translation, not an exact-match answer key. AI feedback can still make mistakes.

Choosing **both** Chinese scripts displays simplified and traditional translated versions for newly generated exercises without changing grading criteria. For older saved exercises, Heron requests and saves missing script versions when you reveal or check the answer; a failed request can be retried. Missing source-word highlighting may also require a one-time AI request when the saved term is not an exact match in the sentence.

Click a word in a displayed source or translated sentence to add it to a compatible deck. AI uses its sentence context to propose the meaning and an exercise. Chinese/Japanese words can also be added to writing practice. This generation uses the same AI request allowance as other features. Excluded or duplicate vocabulary is handled by the deck's existing rules.

**Again**, **A little bit**, and **Remembered** map to FSRS's Again/Hard/Good scheduling ratings. The wording changes; existing schedules remain intact. Hints disable **Remembered**, and revealing the target before committing an answer counts as **Again**. AI judges translation meaning; you assess your recall. Switching context does not erase hint use.

Each language's daily goal counts distinct vocabulary items reviewed that local calendar day across its decks. Repeated reviews of an item count once; writing reviews have a separate schedule. Reaching a goal offers a pause or a choice to continue. A target does not guarantee that many words will be due.

The Writing tab supports Chinese characters and Japanese kanji/kana. Draw with a mouse, pen or finger, or practice on paper; compare with the reference and self-rate. Han characters offer optional AI component stories. Stories are imaginative memory aids, not verified etymology. Heron does not recognize handwriting or check stroke order.

## AI and accounts

Keep server settings in your project's `.env.local`, then restart the server:

```dotenv
OPENAI_API_KEY=your_actual_key
OPENAI_MODEL=gpt-4.1-mini
ENABLE_MNEMONIC_PREVIEW=true
```

Never prefix the OpenAI secret with `NEXT_PUBLIC_` or commit it. The included `env.example` lists settings. Samples, saved exercises, reviews and drawing work without a key. Personalized words, new contexts, captured vocabulary, feedback and character stories require an API key and provider billing. `ENABLE_MNEMONIC_PREVIEW` enables stories only on a local development server.

Follow **ACCOUNT-SETUP.md** to connect Supabase, configure email and enable cloud snapshots. No database project, public deployment or checkout has been provisioned. Hosted AI requires verified authentication and a durable quota; character stories also require a server-checked `mnemonics` entitlement. There is no payment collection yet.

Local development allows 12 AI requests/minute and 200/day per running server. Hosted accounts allow 30/minute and 200/day per account, shared across generation, capture, grading, supplemental script/highlight requests and stories. These are request limits, not dollar budgets. **AI-CONTENT-AND-COSTS.md** explains cost assumptions and future content options.

## Backups and sync

**Settings → Your backup → Export backup** downloads a JSON file containing your decks, preferences, schedules and review history. **Import backup** restores that file by replacing the current collection after confirmation. This is an independent copy you keep; it is not an automatic cloud backup or an Anki `.apkg` file.

Cloud sync asks which copy to use before connecting or resolving conflicting changes. It does not merge simultaneous reviews. Wait for **Cloud copy is up to date** before switching devices, and keep exports when choosing between copies. Signing out restores the guest collection.

## Developer notes

- `app/page.tsx`, `app/recall.css`, `components/Onboarding.tsx`: welcome, preferences, practice and settings.
- `lib/onboarding.ts`, `lib/languages.ts`, `lib/model.ts`, `lib/recall.ts`: preferences, validated data, migration, hints and scheduling.
- `components/SentenceText.tsx`, `components/VocabularyDialog.tsx`: word selection and capture.
- `components/AccountPanel.tsx`, `lib/cloud.ts`, `lib/server-access.ts`, `supabase/schema.sql`: accounts, snapshots, authorization and quotas.
- `app/api/*`, `lib/ai.ts`: server-side model requests and structured-output validation.
- `components/WritingPractice.tsx`, `components/CharacterText.tsx`, `components/MnemonicDialog.tsx`: writing and character stories.

See **VERIFICATION.md** for release checks and integration limits. Generated teaching quality has not been verified through live provider calls in this release. Test your configured accounts, email, hosting and AI before inviting users.

Reading passages, listening lessons, live voice conversation, official exam word lists, Anki package import/export, payment checkout and native/mobile packages remain future work. The serializable model and HTTP endpoints can support later clients, but this release is a responsive web app without a PWA service worker or push notifications.
