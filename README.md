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

Docs: [OVERVIEW.md](OVERVIEW.md) (architecture) · [ROADMAP.md](ROADMAP.md) (ten product ideas, all implemented).

The original one-file bot remains at [`chatBot.html`](chatBot.html).

## Ten phases (implemented)

| Phase | Name | What it does |
| --- | --- | --- |
| 1 | Perception | Normalize, tokenize, language detect (EN/FI), n-grams, sentiment |
| 2 | Intent | Score JSON intents with regex, weighted keywords, example overlap |
| 3 | Entities | Gazetteers (cat/dog/both, languages) plus names and arithmetic |
| 4 | Semantics | Character 3-grams blended with hashed bag-of-words + IDF — no remote embeddings |
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

- `cat` / `dog` / `both` / `kissa` / `molemmat` / typos like `cta` — local SVG
- `show me a horse` / `tell me about foxes` — facts without a drawing
- `tell me about dogs` · `is a cat a mammal` · `how many legs does a dog have`
- `what is 12 * 7` · `two plus two` · `2+2+2` · `10% of 50` · `square root of 9`
- `10 km to miles` · `100 F to C`
- `my name is Aino` · `call me Sam` · `when I say ping reply pong`
- `how are you` · `good morning` · `what's the weather` (honest offline)
- `quiz me` / `quiz me about cats` — local graph quiz (`skip`, `stop quiz`)
- `add a pet` — species → age → name, stored in this browser
- `summarize our chat` — extractive recap of recent turns
- `how do I boil eggs?` — after enabling the Cooking pack on the Brain tab
- `how are you learning?` — local rehearsal stats, adapter learning rates (Loop tab)
- `that's wrong` then `meant:animal_fact` — correct the last turn in this browser
- `how do you work?` — the pipeline in plain language

Fallback replies offer **Save as test**. That downloads `failures.json`. Fill `"want"` with an intent id and either drop the file in `data/failures.json` (the runner skips empty `want`) or paste:

```js
check("your leftover phrase", "animal_fact", /expected snippet/);
```
