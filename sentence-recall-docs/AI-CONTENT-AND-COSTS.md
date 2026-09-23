# Heron: AI behavior, future content and costs

Pricing and future-feature research below was checked September 22, 2026. Reading, listening and conversation features are **not implemented** in Heron v2.2. Costs are illustrative API charges in USD, not measured app usage or complete business costs. Check the linked provider pages before choosing a customer price.

## AI in Heron v2.2

Generation uses each language's goals and skill levels. Chinese learners choose simplified, traditional or both scripts; both supplies two translated references for newly generated exercises. Word groups drive Chinese/Japanese length hints, and the tested vocabulary is highlighted in the source sentence.

Translation checking is separate: it sends only the source sentence, learner answer and language pair to the grader. It does not send the shell, reference answer, target vocabulary or Chinese script preference. Instructions request brief English feedback and accept meaningful variations in word order, phrasing, regional usage and script. This is a prompt-based behavior, not a guarantee that every AI judgment is correct.

Capturing a clicked word from either sentence uses its context to generate a deck entry. It consumes the shared AI request allowance. Optional writing cards are scheduled locally; generating a Han-character story is a separate AI request. New Chinese exercises store AI-generated script variants. Older exercises can request missing variants and source-highlight metadata as needed, then cache them in the saved exercise; those calls also consume allowance. Brief feedback reduces response length, but actual token usage must be measured.

This release has not used live provider calls to validate teaching quality or measure cost. Saved samples, review scheduling and drawing remain usable without AI. Hosted requests require verified accounts and durable quotas; character stories additionally require their server-checked entitlement. No checkout or subscription billing is included.

## Can the content be personalized?

Yes. A future generator can use the learner's language, goals, level, interests, known vocabulary and review history to create original reading passages, questions, explanations and dialogue scripts. It can also choose suitable existing lessons from a shared collection. Personalization does not require generating every lesson anew for every person.

For JLPT preparation, generated materials should be described as practice aimed at a level, with checked questions and answers. N1's official descriptors emphasize complex or abstract writing and naturally paced discourse. They are useful evaluation targets, not a guarantee that an AI-generated passage matches an exam. [Official JLPT level descriptors](https://www.jlpt.jp/e/about/levelsummary.html)

Spanish periodical-style practice can use original fictional or evergreen articles. An article presented as current factual news would also need current sources and fact checking.

## Must AI voices sound like a translation app?

No. Current speech tools already offer more expressive delivery:

- OpenAI's TTS accepts instructions for accent, emotion, intonation, speed, tone and whispering. Its voices are documented as optimized for English despite supporting other languages; this is not a promise of equal quality across languages. [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- Gemini supports single and multiple speakers, regional-accent directions, pace, emotional delivery and vocal tags. Its documentation also notes inconsistent instructions and quality drift in longer outputs. [Google speech guide](https://ai.google.dev/gemini-api/docs/speech-generation)
- ElevenLabs' dialogue API supports separate voices, laughter, hesitation, interrupted sentences and trailing speech; results can require regeneration. [ElevenLabs dialogue guide](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue)
- OpenAI's GPT-Live 1 supports simultaneous listening and speaking with interruption handling. [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1)

**Design inference:** separate controls could govern difficulty, colloquial register, speed, accent, hesitations and background noise. Casual scripts matter: speeding up a textbook sentence does not reproduce spontaneous speech. Izakaya-style Japanese or casual Mandarin can be approximated, but accurate reductions, dialect and overlap must be assessed by native speakers. The documentation establishes available controls, not human-indistinguishability or that every competing app exposes those controls.

## What would text cost?

The starter's GPT-4.1-mini costs **$0.40 per million input tokens and $1.60 per million output tokens**. Formula: `(input × 0.40 + output × 1.60) / 1,000,000`. [Official model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

| Illustrative request | Input / output tokens | Cost each | Cost for 1,000 |
|---|---:|---:|---:|
| Compact exercise | 1,000 / 200 | $0.00072 | $0.72 |
| More detailed exercise | 2,000 / 600 | $0.00176 | $1.76 |
| Longer exercise with structured fields | 3,000 / 1,200 | $0.00312 | $3.12 |
| One grading call | 1,000 / 150 | $0.00064 | $0.64 |
| Passage, questions and explanations | 1,000 / 1,500 | $0.00280 | $2.80 |

These are scenarios, not a forecast or bounded range. **200 output tokens may be too few for this app's full JSON response**, especially translations, revealable chunks and explanations. Instructions, schemas and history count too. Language and content length change token usage. For 1,000 detailed exercises plus one illustrative grading call each, the arithmetic is **$1.76 + $0.64 = $2.40**. Additional grading attempts, retries and verification add costs. Measure actual usage before setting customer prices.

## What would audio cost?

For a documented controllable TTS example, **Gemini 3.1 Flash TTS Preview** charges $1/million input text tokens and $20/million output audio tokens, with 25 audio tokens per second. Ten minutes of newly generated audio and 2,000 total input text tokens therefore costs:

`600 seconds × 25 × $20 / 1,000,000 + 2,000 × $1 / 1,000,000 = $0.302`.

Script generation is additional. Replaying the saved file does not generate audio again. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-tts-preview)

For a same-provider comparison, **OpenAI GPT-4o-mini-TTS** currently lists $0.60/million input text tokens and $12/million output audio tokens. The fetched official pages did not establish a current per-minute conversion, so no per-minute estimate is asserted here. Given actual usage of `T` text and `A` audio tokens, the cost is `(0.60T + 12A) / 1,000,000`. [Official TTS pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)

**GPT-Live 1** instead bills $0.05 per elapsed session minute, by the second. A ten-minute conversation is **$0.50 for the voice session**, plus separately billed backend models and tools. Ten minutes daily for 30 days means **$15/month/user before those extras**. This does not depend on assuming a particular split between user speech and AI speech. [Official live pricing](https://developers.openai.com/api/docs/models/gpt-live-1)

## How to keep it economical

Cache completed sentences, character stories and audio. Generate and validate shared lessons, then personalize selection; reserve fresh generation for missing combinations. A $0.30 audio lesson used by 100 learners amortizes to $0.003 each before storage, delivery and review costs. Live conversations cannot share that benefit, so paid minute allowances are sensible.

Use batch generation for material needed later: supported OpenAI Batch requests receive a 50% token-price reduction. [Batch documentation](https://developers.openai.com/api/docs/guides/batch)

Recommended order: personalized text, then reviewed reusable listening lessons, then metered live conversation. Include hosting, quality review, retries, payments and support in the business budget.
