/**
 * Cortex — 10-phase on-device conversational engine.
 * No remote model calls. Intelligence is JSON + this pipeline.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "cortex.local.v1";
  const INTENT_THRESHOLD = 0.42;

  const SPRITES = {
    cat: `<svg class="sprite" viewBox="0 0 240 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="cat">
      <rect width="240" height="200" rx="18" fill="#2a241c"/>
      <ellipse cx="120" cy="150" rx="62" ry="28" fill="#c4a35a"/>
      <ellipse cx="120" cy="118" rx="54" ry="40" fill="#d4b36a"/>
      <circle cx="120" cy="78" r="36" fill="#e0c484"/>
      <path d="M88 58 L86 28 L108 54 Z" fill="#e0c484"/>
      <path d="M152 58 L154 28 L132 54 Z" fill="#e0c484"/>
      <path d="M90 52 L88 34 L104 50 Z" fill="#6b3a3a"/>
      <path d="M150 52 L152 34 L136 50 Z" fill="#6b3a3a"/>
      <circle cx="108" cy="76" r="5" fill="#1c1814"/>
      <circle cx="132" cy="76" r="5" fill="#1c1814"/>
      <ellipse cx="120" cy="88" rx="6" ry="4" fill="#c46c54"/>
      <path d="M120 92 Q108 102 98 96" stroke="#3a3328" fill="none" stroke-width="2"/>
      <path d="M120 92 Q132 102 142 96" stroke="#3a3328" fill="none" stroke-width="2"/>
      <path d="M86 82 H58 M86 88 H54 M86 94 H60" stroke="#efe6d6" stroke-width="1.5"/>
      <path d="M154 82 H182 M154 88 H186 M154 94 H180" stroke="#efe6d6" stroke-width="1.5"/>
      <path d="M170 128 Q198 110 206 138" stroke="#c4a35a" fill="none" stroke-width="10" stroke-linecap="round"/>
    </svg>`,
    dog: `<svg class="sprite" viewBox="0 0 240 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="dog">
      <rect width="240" height="200" rx="18" fill="#2a241c"/>
      <ellipse cx="122" cy="154" rx="66" ry="26" fill="#8a6a45"/>
      <ellipse cx="122" cy="122" rx="58" ry="42" fill="#b08a58"/>
      <circle cx="128" cy="82" r="38" fill="#c49a64"/>
      <ellipse cx="92" cy="92" rx="16" ry="28" fill="#6a4a2e"/>
      <ellipse cx="160" cy="96" rx="14" ry="26" fill="#6a4a2e"/>
      <ellipse cx="136" cy="96" rx="16" ry="10" fill="#e6d0b0"/>
      <circle cx="118" cy="76" r="5" fill="#1c1814"/>
      <circle cx="142" cy="76" r="5" fill="#1c1814"/>
      <ellipse cx="136" cy="94" rx="7" ry="5" fill="#3a2a22"/>
      <path d="M136 100 Q128 110 118 106" stroke="#3a2a22" fill="none" stroke-width="2"/>
      <path d="M70 138 Q52 120 48 150" stroke="#8a6a45" fill="none" stroke-width="10" stroke-linecap="round"/>
      <circle cx="200" cy="148" r="10" fill="#c4a35a"/>
    </svg>`
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function pick(items) {
    if (!items || !items.length) return "";
    return items[Math.floor(Math.random() * items.length)];
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }

  function charNgrams(text, n) {
    const s = ` ${String(text).toLowerCase()} `;
    const map = Object.create(null);
    if (s.length < n) {
      map[s] = 1;
      return map;
    }
    for (let i = 0; i <= s.length - n; i++) {
      const g = s.slice(i, i + n);
      map[g] = (map[g] || 0) + 1;
    }
    return map;
  }

  function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((k) => {
      const x = a[k] || 0;
      const y = b[k] || 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    });
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function compileBrain(raw) {
    const brain = clone(raw);
    brain.intents.forEach((intent) => {
      intent._re = (intent.patterns || []).map((p) => {
        try {
          return new RegExp(p, "i");
        } catch (e) {
          return /$^/;
        }
      });
    });
    brain.safety._re = (brain.safety.block_patterns || []).map((p) => new RegExp(p, "i"));
    brain._nodeById = Object.create(null);
    brain.graph.nodes.forEach((n) => {
      brain._nodeById[n.id] = n;
    });
    brain._docs = [];
    brain.intents.forEach((intent) => {
      (intent.examples || []).forEach((ex) => {
        brain._docs.push({ kind: "intent", id: intent.id, text: ex, vec: charNgrams(ex, 3) });
      });
    });
    brain.graph.nodes.forEach((node) => {
      ["en", "fi"].forEach((lang) => {
        const summary = node.summary && node.summary[lang];
        if (summary) {
          brain._docs.push({ kind: "node", id: node.id, lang, text: summary, vec: charNgrams(summary, 3) });
        }
        ((node.facts && node.facts[lang]) || []).forEach((fact, i) => {
          brain._docs.push({
            kind: "fact",
            id: node.id,
            lang,
            i,
            text: fact,
            vec: charNgrams(fact, 3)
          });
        });
      });
    });
    return brain;
  }

  function loadStore() {
    if (typeof localStorage === "undefined") return defaultStore();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      return Object.assign(defaultStore(), JSON.parse(raw));
    } catch (e) {
      return defaultStore();
    }
  }

  function defaultStore() {
    return {
      userName: "",
      favoriteAnimal: "",
      lang: "",
      learned: [],
      facts: [],
      turns: []
    };
  }

  function saveStore(store) {
    if (typeof localStorage === "undefined") return;
    try {
      const slim = clone(store);
      slim.turns = (slim.turns || []).slice(-24);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (e) {
      /* quota */
    }
  }

  function stem(token, synonyms) {
    const t = token.toLowerCase();
    if (synonyms && synonyms[t]) return synonyms[t];
    if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
    if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
    return t;
  }

  function perceive(text, brain) {
    const raw = String(text || "");
    const normalized = raw
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[¡!?.]+$/g, "")
      .toLowerCase();
    const tokens = (normalized.match(/[\p{L}\p{N}]+/gu) || []).map((t) => t.toLowerCase());
    const synonyms = brain.lexicon.synonyms || {};
    const stems = tokens.map((t) => stem(t, synonyms));
    const fiHints = new Set(brain.lexicon.fiHints || []);
    let fi = 0;
    let en = 0;
    tokens.forEach((t) => {
      if (fiHints.has(t)) fi += 1;
      if (["the", "is", "you", "what", "how", "show", "cat", "dog", "hello", "please"].includes(t)) en += 1;
    });
    const lang = fi > en ? "fi" : "en";
    const stop = new Set((brain.lexicon.stopwords && brain.lexicon.stopwords[lang]) || []);
    const content = stems.filter((t) => !stop.has(t) && t.length > 1);
    const sentLex = brain.lexicon.sentiment || {};
    let sentiment = 0;
    tokens.forEach((t) => {
      if ((sentLex.positive || []).includes(t)) sentiment += 1;
      if ((sentLex.negative || []).includes(t)) sentiment -= 1;
    });
    return {
      raw,
      normalized,
      tokens,
      stems,
      content,
      lang,
      sentiment,
      vec: charNgrams(normalized, 3)
    };
  }

  function extractEntities(perceived, brain) {
    const found = Object.create(null);
    const hay = perceived.stems.concat(perceived.tokens);
    Object.keys(brain.entities || {}).forEach((slot) => {
      const spec = brain.entities[slot];
      if (spec.type !== "gazetteer") return;
      Object.keys(spec.values).forEach((canonical) => {
        spec.values[canonical].forEach((alias) => {
          const a = alias.toLowerCase();
          hay.forEach((tok) => {
            if (tok === a || tok === stem(a, brain.lexicon.synonyms)) {
              found[slot] = canonical;
            } else if (tok.length >= 4 && a.length >= 4 && levenshtein(tok, a) === 1) {
              found[slot] = canonical;
            }
          });
        });
      });
    });
    const math = perceived.normalized.match(/(-?\d+(?:[.,]\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:[.,]\d+)?)/);
    if (math) {
      found.left = math[1].replace(",", ".");
      found.op = math[2];
      found.right = math[3].replace(",", ".");
    }
    const name = perceived.raw.match(/\b(?:my name is|i am|i'm|nimeni on|olen)\s+([A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ-]{1,32})/i);
    if (name) found.personName = name[1];
    const teach = perceived.raw.match(/when i say\s+(.+?)\s+(?:reply|say|respond)\s+(.+)/i);
    const teachFi = perceived.raw.match(/kun sanon\s+(.+?)\s+(?:vastaa|sano)\s+(.+)/i);
    if (teach) {
      found.trigger = teach[1].trim();
      found.taught = teach[2].trim();
    } else if (teachFi) {
      found.trigger = teachFi[1].trim();
      found.taught = teachFi[2].trim();
    }
    const factTeach = perceived.raw.match(/remember that\s+(.+)/i);
    if (factTeach) found.note = factTeach[1].trim();
    return found;
  }

  function scoreIntent(perceived, intent) {
    if (intent.id === "fallback") return 0.05;
    let score = 0;
    (intent._re || []).forEach((re) => {
      re.lastIndex = 0;
      if (re.test(perceived.normalized) || re.test(perceived.raw)) score += 0.38;
    });
    const kw = intent.keywords || {};
    Object.keys(kw).forEach((word) => {
      const w = word.toLowerCase();
      if (perceived.stems.includes(w) || perceived.tokens.includes(w) || perceived.normalized.includes(w)) {
        score += kw[word];
      }
    });
    let bestEx = 0;
    (intent.examples || []).forEach((ex) => {
      bestEx = Math.max(bestEx, cosine(perceived.vec, charNgrams(ex, 3)));
    });
    score += bestEx * 0.55;
    score += (intent.priority || 0) * 0.012;
    if (intent.id === "show_media" && /^(cat|dog|both|kissa|koira|molemmat)$/i.test(perceived.normalized)) {
      score += 0.5;
    }
    if (intent.id === "teach" && !/\b(when i say|if i say|teach|remember that|kun sanon|opeta)\b/i.test(perceived.normalized)) {
      score *= 0.08;
    }
    return clamp(score, 0, 1.5);
  }

  function classifyIntents(perceived, brain) {
    const ranked = brain.intents
      .map((intent) => ({ id: intent.id, handler: intent.handler, score: scoreIntent(perceived, intent), intent }))
      .sort((a, b) => b.score - a.score);
    return ranked;
  }

  function semanticSearch(perceived, brain, lang) {
    return brain._docs
      .map((doc) => ({
        ...doc,
        score: cosine(perceived.vec, doc.vec) * (doc.lang && doc.lang !== lang ? 0.85 : 1)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  function loc(block, lang) {
    if (!block) return "";
    if (typeof block === "string") return block;
    return block[lang] || block.en || Object.values(block)[0] || "";
  }

  function fillTemplate(tpl, vars) {
    if (!tpl) return "";
    let out = String(tpl);
    out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = vars[k];
      return v != null && v !== "" ? String(v) : "";
    });
    return out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  }

  function animalLabel(id, lang) {
    const map = {
      cat: { en: "cat", fi: "kissa" },
      dog: { en: "dog", fi: "koira" },
      both: { en: "cat and dog", fi: "kissa ja koira" }
    };
    return (map[id] && map[id][lang]) || id || "";
  }

  function renderSprites(animal) {
    if (animal === "both") return SPRITES.cat + SPRITES.dog;
    if (animal === "cat" || animal === "dog") return SPRITES[animal];
    return "";
  }

  function graphLookup(brain, animal) {
    return brain._nodeById[animal] || null;
  }

  function yesNo(brain, perceived) {
    const text = perceived.normalized;
    const nodes = brain.graph.nodes;
    let a = null;
    let b = null;
    nodes.forEach((n) => {
      const labels = [n.id, loc(n.label, "en"), loc(n.label, "fi")].filter(Boolean).map((s) => s.toLowerCase());
      labels.forEach((lab) => {
        if (lab && text.includes(lab)) {
          if (!a) a = n;
          else if (n.id !== a.id) b = n;
        }
      });
    });
    if (a && b) {
      const hit = brain.graph.edges.find(
        (e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)
      );
      return { a, b, hit };
    }
    return null;
  }

  function applyMath(entities) {
    const left = parseFloat(entities.left);
    const right = parseFloat(entities.right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    const op = entities.op;
    let value = null;
    if (op === "+" || op === "plus") value = left + right;
    else if (op === "-" || op === "minus") value = left - right;
    else if (op === "*" || op === "x" || op === "×" || op === "times") value = left * right;
    else if (op === "/" || op === "÷") value = right === 0 ? null : left / right;
    if (value == null || !Number.isFinite(value)) return null;
    const pretty = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
    return { left, right, op, pretty };
  }

  function createSession(rawBrain) {
    const brain = compileBrain(rawBrain);
    const store = loadStore();
    const state = {
      topic: null,
      lastIntent: null,
      awaiting: null,
      slots: {},
      lang: store.lang || "en"
    };

    function tracesPush(traces, phase, id, title, detail, activation) {
      traces.push({ phase, id, title, detail, activation: clamp(activation, 0, 1) });
    }

    function reply(userText) {
      const traces = [];
      const perceived = perceive(userText, brain);
      tracesPush(
        traces,
        1,
        "perception",
        "Perception",
        `${perceived.lang} · ${perceived.tokens.length} tokens · sentiment ${perceived.sentiment >= 0 ? "+" : ""}${perceived.sentiment}`,
        0.95
      );

      const entities = extractEntities(perceived, brain);
      const ranked = classifyIntents(perceived, brain);
      tracesPush(
        traces,
        2,
        "intent",
        "Intent",
        ranked
          .slice(0, 3)
          .map((r) => `${r.id} ${r.score.toFixed(2)}`)
          .join(" · "),
        ranked[0] ? clamp(ranked[0].score, 0, 1) : 0.2
      );

      tracesPush(
        traces,
        3,
        "entities",
        "Entities",
        Object.keys(entities).length ? JSON.stringify(entities) : "none",
        Object.keys(entities).length ? 0.9 : 0.2
      );

      const langGuess = store.lang || perceived.lang;
      const hits = semanticSearch(perceived, brain, langGuess);
      ranked.forEach((row) => {
        const boost = hits.find((h) => h.kind === "intent" && h.id === row.id);
        if (boost) row.score += boost.score * 0.2;
      });
      ranked.sort((a, b) => b.score - a.score);
      tracesPush(
        traces,
        4,
        "semantics",
        "Semantics",
        hits[0] ? `${hits[0].kind}:${hits[0].id} ${hits[0].score.toFixed(2)}` : "no retrieval",
        hits[0] ? clamp(hits[0].score + 0.2, 0, 1) : 0.25
      );

      function prefer(id) {
        const row = ranked.find((r) => r.id === id);
        if (row) {
          row.score += 0.55;
          ranked.sort((a, b) => b.score - a.score);
        }
      }
      if (entities.left && entities.op && entities.right) prefer("math");
      else ranked.forEach((r) => {
        if (r.id === "math" && !entities.left) r.score *= 0.15;
      });
      if (/^(cat|dog|both|kissa|koira|molemmat)$/i.test(perceived.normalized)) prefer("show_media");
      if (/\b(tell me about|what is a|facts? about|kerro|tietoa)\b/i.test(perceived.normalized)) prefer("animal_fact");
      if (/\b(is a |are |onko )/.test(perceived.normalized) && !entities.left) prefer("yes_no");
      if (/\b(my name is|nimeni on)\b/i.test(perceived.normalized)) prefer("remember_name");
      if (/\b(i (like|love|prefer)|favorite)\b/i.test(perceived.normalized)) prefer("remember_pref");
      ranked.sort((a, b) => b.score - a.score);

      let top = ranked[0];
      if (!top || top.score < INTENT_THRESHOLD) {
        top = ranked.find((r) => r.id === "fallback") || { id: "fallback", handler: "fallback", score: 0, intent: { id: "fallback" } };
      }

      if (state.awaiting === "animal" && entities.animal) {
        top = ranked.find((r) => r.id === "show_media") || top;
        state.awaiting = null;
      }

      const looksLikeTeach = /\b(when i say|if i say|teach you|remember that|kun sanon|opeta)\b/i.test(
        perceived.normalized
      );
      const learnedHit = (store.learned || []).find((rule) => {
        const t = String(rule.trigger || "").toLowerCase().trim();
        if (!t) return false;
        return perceived.normalized === t || perceived.normalized.split(/\s+/).includes(t);
      });

      if (top.id === "more_info" && state.topic) {
        entities.animal = entities.animal || state.topic;
        if (state.lastIntent === "show_media") top = ranked.find((r) => r.id === "show_media") || top;
        else top = ranked.find((r) => r.id === "animal_fact") || top;
      }

      if (entities.animal) state.topic = entities.animal === "both" ? "cat" : entities.animal;
      if (["it", "them", "that", "se", "niitä"].some((p) => perceived.tokens.includes(p)) && state.topic) {
        entities.animal = entities.animal || state.topic;
      }

      const flow = (brain.dialogue.flows || []).find((f) => f.intent === top.id);
      let waiting = false;
      if (flow && flow.required) {
        const missing = flow.required.filter((slot) => !entities[slot] && !state.slots[slot]);
        if (missing.length) {
          state.awaiting = missing[0];
          waiting = true;
        }
      }

      tracesPush(
        traces,
        5,
        "dialogue",
        "Dialogue",
        `topic=${state.topic || "—"} · await=${state.awaiting || "—"} · intent=${top.id}`,
        0.85
      );

      const node = graphLookup(brain, entities.animal === "both" ? "cat" : entities.animal);
      const yn = yesNo(brain, perceived);
      tracesPush(
        traces,
        6,
        "knowledge",
        "Knowledge",
        node ? `node ${node.id}` : yn ? `edge ${yn.a.id}–${yn.b.id}` : hits[0] && hits[0].kind !== "intent" ? hits[0].id : "idle",
        node || yn ? 0.92 : 0.3
      );

      const lang = store.lang || perceived.lang;
      const vars = {
        userName: store.userName,
        nameSuffix: store.userName ? ", " + store.userName : "",
        animal: animalLabel(entities.animal, lang),
        favorite: animalLabel(store.favoriteAnimal, lang)
      };

      let draft = { text: "", html: "", suggestions: loc(brain.suggestions, lang) };
      let reasonNote = top.handler;

      if (waiting) {
        draft.text = loc(flow.ask, lang);
        reasonNote = "clarify-slot";
      } else if (learnedHit && !looksLikeTeach) {
        draft.text = learnedHit.response;
        reasonNote = "learned-rule";
        top = { id: "learned", handler: "learned", score: 1, intent: { id: "learned" } };
      } else {
        switch (top.handler) {
          case "template": {
            draft.text = fillTemplate(pick(loc(brain.responses[top.id], lang) || loc(brain.responses.fallback, lang)), vars);
            break;
          }
          case "explain": {
            draft.text =
              lang === "fi"
                ? "Kymmenen vaihetta, kaikki tässä selaimessa: 1 havainto, 2 aie, 3 entiteetit, 4 paikallinen n-grammi-kosini, 5 dialogitila, 6 JSON-tietoverkko, 7 säännöt ja laskenta, 8 muisti (localStorage), 9 persoona ja kieli, 10 suunnittelija. Ei backend-kutsua AI-palvelimelle."
                : "Ten phases, all in this browser: 1 perception, 2 intent, 3 entities, 4 local n-gram cosine, 5 dialogue state, 6 JSON knowledge graph, 7 rules and math, 8 memory (localStorage), 9 persona and language, 10 planner. No backend request to an AI server.";
            break;
          }
          case "media": {
            const animal = entities.animal;
            if (!animal) {
              draft.text = loc(flow && flow.ask, lang);
              state.awaiting = "animal";
            } else {
              draft.html = renderSprites(animal);
              draft.text =
                lang === "fi"
                  ? `Tässä ${animalLabel(animal, "fi")} — piirretty paikallisesti, ei kuva-APIa.`
                  : `Here is a ${animalLabel(animal, "en")} — drawn locally, no image API.`;
              if (node) {
                const extra = pick(node.facts[lang] || node.facts.en || []);
                if (extra) draft.text += " " + extra;
              }
            }
            break;
          }
          case "graph_qa": {
            const subj = entities.animal === "both" ? "cat" : entities.animal;
            const n = graphLookup(brain, subj) || (hits[0] && hits[0].kind !== "intent" && brain._nodeById[hits[0].id]);
            if (n) {
              const fact = pick(n.facts[lang] || n.facts.en || []) || loc(n.summary, lang);
              draft.text = loc(n.summary, lang) + (fact && fact !== loc(n.summary, lang) ? " " + fact : "");
              state.topic = n.id;
            } else {
              draft.text = pick(loc(brain.responses.fallback, lang));
            }
            break;
          }
          case "compare": {
            draft.text = loc(brain.compareNotes, lang);
            draft.html = renderSprites("both");
            break;
          }
          case "more": {
            const n = graphLookup(brain, state.topic);
            if (n) draft.text = pick(n.facts[lang] || n.facts.en || []) || loc(n.summary, lang);
            else draft.text = pick(loc(brain.responses.fallback, lang));
            break;
          }
          case "remember_name": {
            const name = entities.personName;
            if (name) {
              store.userName = name;
              draft.text =
                lang === "fi"
                  ? `Selvä, ${name}. Tallensin nimen tähän selaimeen.`
                  : `Got it, ${name}. I stored your name in this browser only.`;
            } else {
              draft.text = lang === "fi" ? "Mikä nimesi on?" : "What should I call you?";
            }
            break;
          }
          case "remember_pref": {
            if (entities.animal && entities.animal !== "both") {
              store.favoriteAnimal = entities.animal;
              draft.text =
                lang === "fi"
                  ? `Muistan: pidät lajista ${animalLabel(entities.animal, "fi")}.`
                  : `I'll remember you like ${animalLabel(entities.animal, "en")}s.`;
            } else if (entities.note) {
              store.facts.push({ text: entities.note, at: Date.now() });
              draft.text = lang === "fi" ? "Tallennettu paikallisiin muistiinpanoihin." : "Saved to local notes.";
            } else {
              draft.text = lang === "fi" ? "Kissa vai koira?" : "Cats or dogs?";
            }
            break;
          }
          case "recall": {
            const bits = [];
            if (store.userName) bits.push(lang === "fi" ? `Nimesi on ${store.userName}` : `Your name is ${store.userName}`);
            if (store.favoriteAnimal) {
              bits.push(
                lang === "fi"
                  ? `lempilajisi on ${animalLabel(store.favoriteAnimal, "fi")}`
                  : `your favorite is the ${animalLabel(store.favoriteAnimal, "en")}`
              );
            }
            if (store.facts.length) bits.push(store.facts[store.facts.length - 1].text);
            draft.text = bits.length
              ? bits.join(" · ") + "."
              : lang === "fi"
                ? "En ole vielä tallentanut nimeä tai suosikkia."
                : "I don't have a name or favorite stored yet.";
            break;
          }
          case "teach": {
            if (entities.trigger && entities.taught) {
              store.learned.push({ trigger: entities.trigger, response: entities.taught, at: Date.now() });
              draft.text =
                lang === "fi"
                  ? `Opittu: kun sanot “${entities.trigger}”, vastaan “${entities.taught}”.`
                  : `Learned: when you say “${entities.trigger}”, I’ll reply “${entities.taught}”.`;
            } else if (entities.note) {
              store.facts.push({ text: entities.note, at: Date.now() });
              draft.text = lang === "fi" ? "Fakta tallennettu." : "Fact stored locally.";
            } else {
              draft.text =
                lang === "fi"
                  ? "Sano: kun sanon ping vastaa pong"
                  : "Say: when I say ping reply pong";
            }
            break;
          }
          case "math": {
            const m = applyMath(entities);
            if (m) {
              draft.text = lang === "fi" ? `${m.left} ${m.op} ${m.right} = ${m.pretty}` : `${m.left} ${m.op} ${m.right} = ${m.pretty}`;
            } else {
              draft.text = lang === "fi" ? "Anna lasku kuten 12 * 7." : "Give me an expression like 12 * 7.";
            }
            break;
          }
          case "datetime": {
            const now = new Date();
            const locale = lang === "fi" ? "fi-FI" : "en-GB";
            draft.text =
              lang === "fi"
                ? `Paikallinen aika tässä laitteessa: ${now.toLocaleString(locale)}.`
                : `Local device time: ${now.toLocaleString(locale)}.`;
            break;
          }
          case "joke": {
            draft.text = pick(loc(brain.jokes, lang));
            break;
          }
          case "reset": {
            const fresh = defaultStore();
            Object.keys(store).forEach((k) => delete store[k]);
            Object.assign(store, fresh);
            state.topic = null;
            state.awaiting = null;
            state.slots = {};
            draft.text = lang === "fi" ? "Paikallinen muisti tyhjennetty." : "Local memory cleared.";
            break;
          }
          case "inspect": {
            draft.text =
              lang === "fi"
                ? "Avaa oikealta välilehti Brain — koko älykkyys on JSON, jota voit muokata ilman palvelinta."
                : "Open the Brain tab on the right — the whole intelligence is JSON you can edit with no server.";
            draft.openTab = "brain";
            break;
          }
          case "switch_lang": {
            if (entities.lang) store.lang = entities.lang;
            else if (/suomeksi|finnish/i.test(perceived.normalized)) store.lang = "fi";
            else store.lang = "en";
            draft.text = store.lang === "fi" ? "Puhun suomea." : "I'll speak English.";
            break;
          }
          case "yes_no": {
            if (yn && yn.hit) {
              draft.text =
                lang === "fi"
                  ? `Kyllä: ${loc(yn.a.label, lang)} —${yn.hit.rel.replace("_", " ")}→ ${loc(yn.b.label, lang)}.`
                  : `Yes: ${loc(yn.a.label, lang)} —${yn.hit.rel.replace("_", " ")}→ ${loc(yn.b.label, lang)}.`;
            } else if (yn) {
              draft.text =
                lang === "fi"
                  ? `Kaaviossa ei ole suoraa kaarta solmujen ${loc(yn.a.label, lang)} ja ${loc(yn.b.label, lang)} välillä.`
                  : `No direct edge in the graph between ${loc(yn.a.label, lang)} and ${loc(yn.b.label, lang)}.`;
            } else {
              draft.text = pick(loc(brain.responses.fallback, lang));
            }
            break;
          }
          default: {
            const factHit = hits.find((h) => h.kind !== "intent" && h.score > 0.28);
            if (factHit) draft.text = factHit.text;
            else draft.text = pick(loc(brain.responses.fallback, lang));
          }
        }
      }

      tracesPush(traces, 7, "reasoning", "Reasoning", reasonNote, 0.88);

      const memBits = [store.userName && "name", store.favoriteAnimal && "favorite", store.learned.length && `${store.learned.length} taught`]
        .filter(Boolean)
        .join(", ");
      tracesPush(traces, 8, "memory", "Memory", memBits || "empty", memBits ? 0.8 : 0.25);

      brain.safety._re.forEach((re) => {
        re.lastIndex = 0;
        if (re.test(perceived.raw)) draft.text = loc(brain.safety.blocked, lang);
      });
      tracesPush(traces, 9, "persona", "Persona", `lang=${lang} tone=${brain.meta.persona.tone}`, 0.7);

      if (!draft.suggestions) draft.suggestions = loc(brain.suggestions, lang);
      if (entities.animal === "cat") draft.suggestions = lang === "fi" ? ["kerro kissoista", "koira", "molemmat"] : ["tell me about cats", "dog", "both"];
      if (entities.animal === "dog") draft.suggestions = lang === "fi" ? ["kerro koirista", "kissa", "molemmat"] : ["tell me about dogs", "cat", "both"];

      tracesPush(traces, 10, "planner", "Planner", `handler=${top.handler || reasonNote} · ${draft.html ? "media" : "text"}`, 0.9);

      state.lastIntent = top.id;
      state.lang = lang;
      store.turns.push({ role: "user", text: perceived.raw, at: Date.now() });
      store.turns.push({ role: "assistant", text: draft.text, intent: top.id, at: Date.now() });
      saveStore(store);

      return {
        text: draft.text,
        html: draft.html || "",
        intent: top.id,
        score: clamp(top.score || 0, 0, 1),
        lang,
        traces,
        suggestions: draft.suggestions,
        openTab: draft.openTab || null,
        entities,
        memory: {
          userName: store.userName,
          favoriteAnimal: store.favoriteAnimal,
          learned: store.learned.length,
          facts: store.facts.length
        }
      };
    }

    function resetMemory() {
      const fresh = defaultStore();
      Object.keys(store).forEach((k) => delete store[k]);
      Object.assign(store, fresh);
      state.topic = null;
      state.awaiting = null;
      saveStore(store);
    }

    return {
      brain,
      reply,
      resetMemory,
      getStore: () => clone(store),
      getState: () => clone(state)
    };
  }

  async function loadBrainFrom(url, fallback) {
    if (url && typeof fetch === "function") {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) return compileBrain(await res.json());
      } catch (e) {
        /* file:// or offline */
      }
    }
    if (fallback) return compileBrain(fallback);
    throw new Error("No JSON brain available");
  }

  const Cortex = {
    STORAGE_KEY,
    SPRITES,
    compileBrain,
    createSession,
    loadBrainFrom,
    perceive,
    cosine,
    charNgrams,
    levenshtein,
    applyMath
  };

  root.Cortex = Cortex;
  if (typeof module !== "undefined" && module.exports) module.exports = Cortex;
})(typeof globalThis !== "undefined" ? globalThis : this);
