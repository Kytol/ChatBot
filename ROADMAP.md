# Cortex roadmap — 10 implementation ideas

The **ten phases** in the chat UI are already built (see [OVERVIEW.md](OVERVIEW.md)). This file is the **build list of ten product ideas**. All of them stay on-device — HTML, CSS, JS, JSON. No cloud model API. **Ideas 1–10 are implemented** in this repo.

---

## 1. Graph quiz (implemented)

**Goal.** Turn the knowledge graph into a short oral quiz without a server.

**Shipped.** `quiz me`, `quiz me about cats`, `skip`, `stop quiz`. Deck comes from `data/brain.json` `quiz[]`, `is_a` edges, and `attrs.legs`. Scores live in `localStorage` (`store.quiz`).

**Files.** `js/engine.js` (`buildQuizDeck`, `gradeQuizAnswer`, handler `quiz`), `data/brain.json` (`intents.quiz`, `quiz[]`), `js/app.js` (Memory tab).

**Accept.** `node tests/engine.test.js` covers start / correct JSON answer / stop. In the UI, a round shows `Q1/n` and chips `skip`, `stop quiz`.

---

## 2. JSON skill packs (implemented)

**Goal.** Load extra brains (`data/packs/cooking.json`) without replacing the core animal pack.

**Shipped.** `Cortex.mergeBrains` concatenates intents (fallback last), nodes, edges, quiz. Brain tab checklist “Cooking” is remembered in `localStorage` (`cortex.packs.v1`). Fetch is static JSON only.

**Accept.** Enabling the pack makes `how do I boil eggs?` hit `boil_eggs`; disabling restores fallback.

---

## 3. Visual knowledge-graph inspector (implemented)

**Goal.** Draw nodes and `is_a` edges in the inspector so the JSON is not only a textarea.

**Shipped.** Graph pane: SVG circles + edges. Click a node for `summary` / `attrs`. Last reply highlights `graphFocus` (entities + yes/no edge).

**Accept.** After `is a cat a mammal`, the cat→mammal edge is selected.

---

## 4. Extractive recap of the transcript (implemented)

**Goal.** `summarize our chat` returns a local recap, not a cloud summary.

**Shipped.** Intent `recap`. `recapTurns` scores user+bot pairs with n-grams plus bonuses for quiz / math / animals, then takes up to three diverse turns. No `eval` on user text.

**Accept.** After cat + `12*7` + quiz, recap mentions those three.

---

## 5. PWA / service worker (true airplane mode) (implemented)

**Goal.** Second visit works with the network off, including `brain.json`.

**Shipped.** `manifest.webmanifest` (Cortex, standalone, `#161410`). `sw.js` precaches the shell, brain, packs, and docs. Registered from `js/app.js` on `https:` or localhost. Badge “cached shell” when the worker controls the page.

**Accept.** DevTools → Offline → reload still chats and quizzes (after the worker has claimed the page).

---

## 6. Dialogue scripts (forms as JSON) (implemented)

**Goal.** Multi-slot flows beyond “which animal?” — e.g. a pet profile: name, species, age.

**Shipped.** `dialogue.flows[]` supports `ask[slot]` and `onComplete`. Engine maps the next utterance into `state.flowId` / `state.awaiting`. Complete writes `store.profiles[]`. `cancel` / `nevermind` clears `flowId`.

**Accept.** “Add a pet” → “What species?” → “cat” → “How old (years)?” → “3” → name “Miso” → “Saved Miso, cat, 3.”

---

## 7. Stronger local vectors (hashing trick) (implemented)

**Goal.** Better retrieval than raw 3-grams for longer facts, still no GPU/cloud.

**Shipped.** 256-dim hashed bag-of-words (`hash(token) % 256`) blended with char 3-grams; IDF from compiled `_docs`. Cosine retrieval uses 0.5 n-gram + 0.5 blended hash.

**Accept.** `nocturnal bushy tail` retrieves the fox node without the word “fox”.

---

## 8. Voice in / voice out (device APIs) (implemented)

**Goal.** Speak to Cortex using the **browser** speech APIs — still no Cortex cloud.

**Shipped.** Mic uses `SpeechRecognition` / `webkitSpeechRecognition` → `#input` → `send()`. Optional TTS via `speechSynthesis` (skips SVG-only turns). Buttons hide when APIs are missing. Hint: the OS recognizer may be vendor-hosted; Cortex does not upload audio itself.

**Accept.** Keyboard path unchanged. Mic, when present, fills the box and sends.

---

## 9. Brain import diff (implemented)

**Goal.** Importing JSON shows what would change before Apply.

**Shipped.** `diffBrains(current, next)` → added/removed intents, nodes, quiz. Modal: Apply all / Apply intents only / Cancel. Validator still requires `intents` + `graph`.

**Accept.** Importing a pack that adds fox facts lists “+1 node fox” (or egg from the cooking pack) before compile.

---

## 10. Failed-turn test authoring (implemented)

**Goal.** When fallback fires, one click adds a failing phrase to a `data/failures.json` fixture.

**Shipped.** Planner shows chip “Save as test” on fallback. Click appends `{ input, got: "fallback", want: "" }` to `localStorage` and downloads `failures.json`. Node runner asserts `want` once the author fills it. README has the `check("…", "animal_fact", /…/)` snippet.

**Accept.** A leftover fallback can be exported and turned into a red test, then green after a JSON pattern is added.

---

## Order that stayed cheap

Packs and the graph view reuse `compileBrain` and the inspector. PWA is a small reliability win. Hashed vectors improved fox retrieval. Voice is last among “no Cortex cloud” features because OS speech recognition may still leave the device.
