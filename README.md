# Cortex — on-device JSON intelligence

A sophisticated alternative to the original regex `chatBot.html`: the same idea (patterns and replies as data, no AI server), expanded into a **10-phase local NLU pipeline** driven by [`data/brain.json`](data/brain.json).

There is **no backend request to a cloud model**. HTML, CSS, and JavaScript read a JSON brain and produce replies in the browser. Memory uses `localStorage`.

## Run

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`. Fetching `data/brain.json` needs HTTP; inference itself still never leaves the machine.

```bash
node tests/engine.test.js
```

The original one-file bot remains at [`chatBot.html`](chatBot.html).

## Ten phases (implemented)

| Phase | Name | What it does |
| --- | --- | --- |
| 1 | Perception | Normalize, tokenize, language detect (EN/FI), n-grams, sentiment |
| 2 | Intent | Score JSON intents with regex, weighted keywords, example overlap |
| 3 | Entities | Gazetteers (cat/dog/both, languages) plus names and arithmetic |
| 4 | Semantics | Character 3-gram vectors and cosine similarity — no remote embeddings |
| 5 | Dialogue | Topic, pronouns, missing-slot questions, multi-turn follow-ups |
| 6 | Knowledge | JSON graph: nodes, edges, facts, yes/no relation checks |
| 7 | Reasoning | Rules, templates, local math, comparisons, media sprites |
| 8 | Memory | Name, favorites, taught “when I say…” rules, notes in this browser |
| 9 | Persona | English/Finnish phrasing, tone, light safety filters |
| 10 | Planner | Final reply, SVG media, suggestion chips, explainable trace |

## JSON as the brain

Intents, entities, dialogue flows, knowledge graph, jokes, and copy all live in JSON. The Brain tab can **edit, apply, export, and import** that document; the engine recompiles in-page.

Teach a rule without editing JSON:

```text
when I say ping reply pong
```

Then `ping` is answered from local memory, still with no cloud call.

## What to try

- `cat` / `dog` / `both` / `kissa` / `molemmat` — local SVG, successor to the old image replies
- `tell me about dogs` — graph retrieval
- `is a cat a mammal` — edge check
- `what is 12 * 7` — local arithmetic
- `my name is Aino` then `what is my name`
- `how do you work?` — the pipeline in plain language
