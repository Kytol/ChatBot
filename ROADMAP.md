# Cortex roadmap — 10 implementation ideas

The **ten phases** in the chat UI are already built (see [OVERVIEW.md](OVERVIEW.md)). This file is a **build list of ten product ideas**: what to add next, which files to touch, and how to know it worked. All of them stay on-device — HTML, CSS, JS, JSON. No cloud model API.

Idea 1 is **implemented** in this repo. Ideas 2–10 are specified so they can be built the same way.

---

## 1. Graph quiz (implemented)

**Goal.** Turn the knowledge graph into a short oral quiz without a server.

**Shipped.** `quiz me`, `quiz me about cats`, `skip`, `stop quiz`. Deck comes from `data/brain.json` `quiz[]`, `is_a` edges, and `attrs.legs`. Scores live in `localStorage` (`store.quiz`).

**Files.** `js/engine.js` (`buildQuizDeck`, `gradeQuizAnswer`, handler `quiz`), `data/brain.json` (`intents.quiz`, `quiz[]`), `js/app.js` (Memory tab).

**Accept.** `node tests/engine.test.js` covers start / correct JSON answer / stop. In the UI, a round shows `Q1/n` and chips `skip`, `stop quiz`.

---

## 2. JSON skill packs

**Goal.** Load extra brains (`data/packs/cooking.json`) without replacing the core animal pack.

**Implementation.**

1. Add `data/packs/*.json` with the same shape as a subset of `brain.json` (intents, nodes, edges, quiz).  
2. In `js/engine.js`, `mergeBrains(base, pack)`: concat intents, merge `graph.nodes` by `id`, concat edges, concat quiz. Re-run `compileBrain`.  
3. UI: Brain tab checklist “Enable cooking pack”; `localStorage` remembers enabled pack ids.  
4. Fetch packs as static JSON (still not an AI API).

**Accept.** Enabling a pack makes `how do I boil eggs?` hit a new intent; disabling restores fallback.

---

## 3. Visual knowledge-graph inspector

**Goal.** Draw nodes and `is_a` edges in the inspector so the JSON is not only a textarea.

**Implementation.**

1. New pane `Graph` in `index.html`.  
2. SVG or canvas: one circle per `graph.nodes`, lines for `graph.edges`.  
3. Click a node → show `summary` + `attrs` (reuse `loc()`).  
4. Highlight the node used in the last reply (`entities.node` / `topic` from the trace).

**Accept.** After `is a cat a mammal`, the cat→mammal edge is visually selected.

---

## 4. Extractive recap of the transcript

**Goal.** `summarize our chat` returns a local recap, not a cloud summary.

**Implementation.**

1. Intent `recap` on `summarize`, `recap`, `what did we talk about`.  
2. Score `store.turns` sentences with the same char n-gram cosine against a bag of content words (animal names, math exprs, quiz scores).  
3. Take top 3 user+bot pairs; template: “You asked about X. I answered Y.”  
4. Cap length; never call `eval` on user text.

**Accept.** After cat + `12*7` + quiz, recap mentions those three.

---

## 5. PWA / service worker (true airplane mode)

**Goal.** Second visit works with the network off, including `brain.json`.

**Implementation.**

1. `manifest.webmanifest` (name Cortex, standalone, theme `#161410`).  
2. `sw.js` precaches `index.html`, `css/app.css`, `js/*.js`, `data/brain.json`.  
3. Register in `js/app.js` only on `https:` or localhost.  
4. Keep the existing “offline inference” badge; add “cached shell” when the SW is controlling the page.

**Accept.** DevTools → Offline → reload still chats and quizzes.

---

## 6. Dialogue scripts (forms as JSON)

**Goal.** Multi-slot flows beyond “which animal?” — e.g. a pet profile: name, species, age.

**Implementation.**

1. `dialogue.flows[]` already has `required` slots. Extend with `ask[slot]`, `validate`, `onComplete` template.  
2. Engine: if `state.flowId`, map the next utterance into the current slot (reuse `extractEntities`).  
3. On complete, write `store.profiles[]` and speak a filled template.  
4. `cancel` / `nevermind` already clears `awaiting`; bind that to `flowId`.

**Accept.** “Add a pet” → “what species?” → “cat” → “age?” → “3” → “Saved Miso, cat, 3.”

---

## 7. Stronger local vectors (hashing trick)

**Goal.** Better retrieval than raw 3-grams for longer facts, still no GPU/cloud.

**Implementation.**

1. Replace or blend `charNgrams` with a 256-dim hashed bag-of-words (`hash(token) % 256`).  
2. IDF from the compiled `_docs` list at `compileBrain`.  
3. Keep cosine; tune `INTENT_THRESHOLD` with the existing test file.  
4. Optional: store precomputed doc vectors next to `_docs` to skip rebuild per turn (already done for n-grams).

**Accept.** `nocturnal bushy tail` retrieves the fox node without the word “fox”.

---

## 8. Voice in / voice out (device APIs)

**Goal.** Speak to Cortex using the **browser** speech APIs — still no Cortex cloud.

**Implementation.**

1. Mic button: `webkitSpeechRecognition` / `SpeechRecognition` → fill `#input` → `send()`.  
2. Optional TTS: `speechSynthesis.speak(new SpeechSynthesisUtterance(result.text))` (skip SVG-only turns).  
3. Feature-detect; if missing, hide the button.  
4. Do not send audio to a custom server. (Some OS recognizers are vendor-hosted; document that in the UI hint.)

**Accept.** Click mic, say “cat”, sprite appears. Keyboard path unchanged.

---

## 9. Brain import diff

**Goal.** Importing JSON shows what would change before Apply.

**Implementation.**

1. Parse incoming JSON; `diffBrains(current, next)` → `{ addedIntents, removedNodes, quizDelta }`.  
2. Modal or inspector panel listing the delta.  
3. Buttons: Apply all / Apply intents only / Cancel.  
4. Keep the existing validator (`JSON.parse` + required `intents`, `graph`).

**Accept.** Importing a pack that adds `fox` facts lists “+1 node fox” before compile.

---

## 10. Failed-turn test authoring

**Goal.** When fallback fires, one click adds a failing phrase to `tests/engine.test.js` or a `data/failures.json` fixture.

**Implementation.**

1. Planner already knows `intent === "fallback"`. Show a chip “Save as test”.  
2. Append `{ input, got: "fallback" }` to `localStorage` and offer download of `failures.json`.  
3. Node test runner: for each fixture, assert the **new** intended id once the author fills `"want": "animal_fact"`.  
4. README snippet: paste into `check("…", "animal_fact", /…/)`.

**Accept.** A leftover fallback can be exported and turned into a red test, then green after a JSON pattern is added.

---

## Order that stays cheap

Ship **2 (packs)** and **3 (graph view)** next: they reuse `compileBrain` and the inspector. **5 (PWA)** is a small reliability win. **7 (vectors)** only if retrieval quality is the bottleneck. **8 (voice)** last if you care about keeping “no network at all” as a hard rule — speech recognition may leave the device even when Cortex does not.
