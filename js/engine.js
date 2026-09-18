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

  const WORD_NUM = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const NAME_STOP = new Set([
    "sad", "fine", "good", "ok", "okay", "hungry", "tired", "called", "not", "so", "just",
    "here", "back", "ready", "sorry", "happy", "cat", "dog", "a", "an", "the", "lost",
    "bored", "angry", "lonely", "stressed", "sick", "well", "great", "confused", "afraid"
  ]);
  const EMOTIONS = {
    sad: "sad", tired: "tired", angry: "angry", lonely: "lonely", stressed: "stressed",
    sick: "sick", afraid: "afraid", bored: "bored", happy: "happy", excited: "excited",
    surullinen: "sad", väsynyt: "tired", vihainen: "angry"
  };

  function formatNum(n) {
    if (!Number.isFinite(n)) return null;
    if (Number.isInteger(n)) return String(n);
    const r = Math.round(n * 10000) / 10000;
    return String(r);
  }

  function adjacentTranspose(a, b) {
    if (!a || !b || a.length !== b.length || a.length < 3) return false;
    const diffs = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }

  function hasKeyword(perceived, word) {
    const w = String(word).toLowerCase();
    if (perceived.tokens.includes(w) || perceived.stems.includes(w)) return true;
    return new RegExp("\\b" + escapeRe(w) + "\\b", "i").test(perceived.normalized);
  }

  function replaceWordNumbers(text) {
    let s = String(text);
    Object.keys(WORD_NUM)
      .sort((a, b) => b.length - a.length)
      .forEach((w) => {
        s = s.replace(new RegExp("\\b" + w + "\\b", "gi"), String(WORD_NUM[w]));
      });
    return s;
  }

  function rewriteMathWords(text) {
    return String(text)
      .toLowerCase()
      .replace(/\bplus\b/g, "+")
      .replace(/\bminus\b/g, "-")
      .replace(/\b(?:times|multiplied by)\b/g, "*")
      .replace(/\bdivided by\b/g, "/")
      .replace(/\bover\b/g, "/")
      .replace(/\bx\b/g, "*")
      .replace(/×/g, "*")
      .replace(/÷/g, "/");
  }

  function evalArithmetic(expr) {
    const tokens = [];
    const src = String(expr).replace(/\s+/g, "");
    const re = /([+\-*/])|(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[2] != null) {
        tokens.push({ type: "n", v: parseFloat(m[2]) });
      } else if (m[1]) {
        tokens.push({ type: "o", v: m[1] });
      }
    }
    if (tokens.length < 3) return null;
    const nums = [];
    const ops = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === "n") nums.push(tokens[i].v);
      else ops.push(tokens[i].v);
    }
    if (!nums.length || ops.length !== nums.length - 1) return null;
    function reduce(want) {
      let i = 0;
      while (i < ops.length) {
        if (want.includes(ops[i])) {
          const a = nums[i];
          const b = nums[i + 1];
          let v;
          if (ops[i] === "*") v = a * b;
          else if (ops[i] === "/") {
            if (b === 0) return { error: "div0" };
            v = a / b;
          } else if (ops[i] === "+") v = a + b;
          else v = a - b;
          if (!Number.isFinite(v)) return { error: "nan" };
          nums.splice(i, 2, v);
          ops.splice(i, 1);
        } else i += 1;
      }
      return null;
    }
    const err = reduce(["*", "/"]) || reduce(["+", "-"]);
    if (err) return err;
    if (nums.length !== 1) return null;
    return { pretty: formatNum(nums[0]), expr: src };
  }

  function parseMath(text) {
    const lowered = replaceWordNumbers(String(text).toLowerCase());
    const s = rewriteMathWords(lowered);
    const pct = s.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*(?:of\s*)?(-?\d+(?:[.,]\d+)?)/);
    if (pct) {
      const v = parseFloat(pct[1].replace(",", ".")) * parseFloat(pct[2].replace(",", ".")) / 100;
      return { pretty: formatNum(v), expr: pct[1] + "% of " + pct[2] };
    }
    const sqrt = s.match(/(?:square root (?:of )?|sqrt\s*)(-?\d+(?:[.,]\d+)?)/);
    if (sqrt) {
      const n = parseFloat(sqrt[1].replace(",", "."));
      if (n < 0) return { error: "sqrt" };
      return { pretty: formatNum(Math.sqrt(n)), expr: "√" + n };
    }
    const div = s.match(/divid(?:e|ed)\s+(-?\d+(?:[.,]\d+)?)\s+by\s+(-?\d+(?:[.,]\d+)?)/);
    if (div) {
      const a = parseFloat(div[1].replace(",", "."));
      const b = parseFloat(div[2].replace(",", "."));
      if (b === 0) return { error: "div0" };
      return { pretty: formatNum(a / b), expr: a + "/" + b };
    }
    const chain = s.match(/-?\d+(?:[.,]\d+)?(?:\s*[+\-*/]\s*-?\d+(?:[.,]\d+)?)+/);
    if (chain) return evalArithmetic(chain[0].replace(/,/g, "."));
    return null;
  }

  function parseConversion(text) {
    const s = replaceWordNumbers(String(text).toLowerCase());
    const rules = [
      { re: /(-?\d+(?:[.,]\d+)?)\s*(kilometers?|km)\s*(?:to|in)\s*(miles?|mi)/, fn: (n) => n * 0.621371, unit: "miles" },
      { re: /(-?\d+(?:[.,]\d+)?)\s*(miles?|mi)\s*(?:to|in)\s*(kilometers?|km)/, fn: (n) => n / 0.621371, unit: "km" },
      { re: /(-?\d+(?:[.,]\d+)?)\s*(?:°\s*)?(fahrenheit|f)\s*(?:to|in)\s*(?:°\s*)?(celsius|c)/, fn: (n) => (n - 32) * 5 / 9, unit: "°C" },
      { re: /(-?\d+(?:[.,]\d+)?)\s*(?:°\s*)?(celsius|c)\s*(?:to|in)\s*(?:°\s*)?(fahrenheit|f)/, fn: (n) => n * 9 / 5 + 32, unit: "°F" },
      { re: /(-?\d+(?:[.,]\d+)?)\s*(kilograms?|kg)\s*(?:to|in)\s*(pounds?|lbs|lb)/, fn: (n) => n * 2.20462, unit: "lb" },
      { re: /(-?\d+(?:[.,]\d+)?)\s*(pounds?|lbs|lb)\s*(?:to|in)\s*(kilograms?|kg)/, fn: (n) => n / 2.20462, unit: "kg" }
    ];
    for (let i = 0; i < rules.length; i++) {
      const m = s.match(rules[i].re);
      if (m) {
        const n = parseFloat(m[1].replace(",", "."));
        return { pretty: formatNum(rules[i].fn(n)), unit: rules[i].unit, from: m[0] };
      }
    }
    return null;
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

  function hashToken(t) {
    let h = 2166136261;
    const s = String(t);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 256;
  }

  function hashVec(text) {
    const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const vec = Object.create(null);
    tokens.forEach((t) => {
      const k = "h" + hashToken(t);
      vec[k] = (vec[k] || 0) + 1;
    });
    return vec;
  }

  function blendVec(ngram, hashed, idf, N) {
    const out = Object.create(null);
    Object.keys(ngram || {}).forEach((k) => {
      out["c:" + k] = ngram[k];
    });
    const n = N || 1;
    Object.keys(hashed || {}).forEach((k) => {
      const df = (idf && idf[k]) || 1;
      out[k] = hashed[k] * Math.log(1 + n / df);
    });
    return out;
  }

  function mergeBrains(base, pack) {
    const out = clone(base || {});
    if (!pack) return out;
    out.intents = (out.intents || []).slice();
    const fallback = out.intents.find((i) => i.id === "fallback");
    const withoutFb = out.intents.filter((i) => i.id !== "fallback");
    const have = new Set(withoutFb.map((i) => i.id));
    (pack.intents || []).forEach((intent) => {
      if (!have.has(intent.id)) {
        withoutFb.push(clone(intent));
        have.add(intent.id);
      }
    });
    if (fallback) withoutFb.push(fallback);
    out.intents = withoutFb;
    out.responses = Object.assign({}, out.responses || {}, clone(pack.responses || {}));
    out.graph = out.graph || { nodes: [], edges: [] };
    out.graph.nodes = (out.graph.nodes || []).slice();
    out.graph.edges = (out.graph.edges || []).slice();
    const nodeIds = new Set(out.graph.nodes.map((n) => n.id));
    ((pack.graph && pack.graph.nodes) || []).forEach((n) => {
      if (!nodeIds.has(n.id)) {
        out.graph.nodes.push(clone(n));
        nodeIds.add(n.id);
      }
    });
    const edgeKey = (e) => e.from + "|" + e.rel + "|" + e.to;
    const edges = new Set((out.graph.edges || []).map(edgeKey));
    ((pack.graph && pack.graph.edges) || []).forEach((e) => {
      const k = edgeKey(e);
      if (!edges.has(k)) {
        out.graph.edges.push(clone(e));
        edges.add(k);
      }
    });
    out.quiz = (out.quiz || []).concat(clone(pack.quiz || []));
    if (pack.dialogue && pack.dialogue.flows) {
      out.dialogue = out.dialogue || { flows: [] };
      out.dialogue.flows = (out.dialogue.flows || []).concat(clone(pack.dialogue.flows));
    }
    if (pack.lexicon && pack.lexicon.synonyms) {
      out.lexicon = out.lexicon || {};
      out.lexicon.synonyms = Object.assign({}, out.lexicon.synonyms || {}, pack.lexicon.synonyms);
    }
    out._packs = (out._packs || []).concat([(pack.meta && pack.meta.id) || "pack"]);
    return out;
  }

  function diffBrains(current, next) {
    const curI = new Set(((current && current.intents) || []).map((i) => i.id));
    const nextI = new Set(((next && next.intents) || []).map((i) => i.id));
    const curN = new Set((((current && current.graph) || {}).nodes || []).map((n) => n.id));
    const nextN = new Set((((next && next.graph) || {}).nodes || []).map((n) => n.id));
    const curQ = new Set(((current && current.quiz) || []).map((q) => q.id));
    const nextQ = new Set(((next && next.quiz) || []).map((q) => q.id));
    const addedIntents = [...nextI].filter((id) => !curI.has(id));
    const removedIntents = [...curI].filter((id) => !nextI.has(id));
    const addedNodes = [...nextN].filter((id) => !curN.has(id));
    const removedNodes = [...curN].filter((id) => !nextN.has(id));
    const addedQuiz = [...nextQ].filter((id) => !curQ.has(id));
    const removedQuiz = [...curQ].filter((id) => !nextQ.has(id));
    return {
      addedIntents,
      removedIntents,
      addedNodes,
      removedNodes,
      addedQuiz,
      removedQuiz,
      quizDelta: addedQuiz.length - removedQuiz.length,
      summary:
        (addedIntents.length ? "+" + addedIntents.length + " intent " + addedIntents.join(", ") : "") +
        (removedIntents.length ? " −" + removedIntents.length + " intent" : "") +
        (addedNodes.length ? "; +" + addedNodes.length + " node " + addedNodes.join(", ") : "") +
        (removedNodes.length ? "; −" + removedNodes.length + " node " + removedNodes.join(", ") : "") +
        (addedQuiz.length || removedQuiz.length ? "; quiz " + (addedQuiz.length - removedQuiz.length) : "")
    };
  }

  function recapTurns(turns, brain, lang) {
    const pairs = [];
    const list = turns || [];
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].role === "user" && list[i + 1].role === "assistant") {
        pairs.push({
          user: String(list[i].text || ""),
          bot: String(list[i + 1].text || ""),
          intent: list[i + 1].intent || ""
        });
      }
    }
    if (!pairs.length) {
      return lang === "fi" ? "Emme ole vielä ehtineet puhua paljoa." : "We haven't talked much yet — ask for a cat, some math, or a quiz.";
    }
    const bagBits = ["quiz", "math", "json", "cat", "dog", "mile", "pack", "pet"];
    ((brain && brain.graph && brain.graph.nodes) || []).forEach((n) => {
      bagBits.push(n.id);
      if (n.label) bagBits.push(loc(n.label, "en"), loc(n.label, "fi"));
    });
    const bagVec = charNgrams(bagBits.join(" "), 3);
    const scored = pairs.map((p, i) => {
      const blob = (p.user + " " + p.bot + " " + p.intent).toLowerCase();
      let bonus = 0;
      if (/quiz/.test(blob)) bonus += 0.15;
      if (/\d/.test(blob) || p.intent === "math") bonus += 0.18;
      if (/\b(cat|dog|kissa|koira)\b/.test(blob) || p.intent === "show_media") bonus += 0.12;
      const recency = ((i + 1) / pairs.length) * 0.35;
      return { p, score: cosine(charNgrams(blob, 3), bagVec) + bonus + recency };
    });
    const lastRow = scored[scored.length - 1];
    scored.sort((a, b) => b.score - a.score);
    const top = [];
    const seen = new Set();
    const seenIntent = new Set();
    function takeRow(row) {
      if (!row) return;
      const key = row.p.user.slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      if (row.p.intent) seenIntent.add(row.p.intent);
      top.push(row.p);
    }
    takeRow(lastRow);
    scored.forEach((row) => {
      if (top.length >= 3) return;
      if (row.p.intent && seenIntent.has(row.p.intent)) return;
      takeRow(row);
    });
    scored.forEach((row) => {
      if (top.length >= 3) return;
      takeRow(row);
    });
    const take = top.slice(0, 3);
    const lines = take.map((p) => {
      const u = p.user.replace(/\s+/g, " ").trim().slice(0, 72);
      const b = p.bot.replace(/\s+/g, " ").trim().slice(0, 88);
      return lang === "fi" ? "Kysyit “" + u + "”. Vastasin: " + b : "You asked “" + u + "”. I answered: " + b;
    });
    return (lang === "fi" ? "Paikallinen tiivistelmä (ei pilveä):\n" : "Local recap (no cloud model):\n") + lines.join("\n");
  }

  function defaultLoop() {
    return {
      episodes: [],
      examples: {},
      anti: {},
      keywordBoost: {},
      blendHash: 0.5,
      threshold: INTENT_THRESHOLD,
      note: "",
      meta: {
        lr: { example: 1, keyword: 1, blend: 1, threshold: 1 },
        credit: { example: 0, keyword: 0, blend: 0, threshold: 0 },
        lastAdapter: "example",
        emaReward: 0,
        emaFallback: 0.15,
        rehearsals: 0,
        rehearsalHits: 0,
        promotions: 0,
        corrections: 0,
        rewardsPos: 0,
        rewardsNeg: 0
      }
    };
  }

  function ensureLoop(store) {
    if (!store.loop) store.loop = defaultLoop();
    const loop = store.loop;
    const base = defaultLoop();
    if (!loop.examples) loop.examples = {};
    if (!loop.anti) loop.anti = {};
    if (!loop.keywordBoost) loop.keywordBoost = {};
    if (!loop.episodes) loop.episodes = [];
    if (loop.blendHash == null) loop.blendHash = base.blendHash;
    if (loop.threshold == null) loop.threshold = base.threshold;
    if (!loop.meta) loop.meta = base.meta;
    loop.meta.lr = Object.assign({}, base.meta.lr, loop.meta.lr || {});
    loop.meta.credit = Object.assign({}, base.meta.credit, loop.meta.credit || {});
    ["lastAdapter", "emaReward", "emaFallback", "rehearsals", "rehearsalHits", "promotions", "corrections", "rewardsPos", "rewardsNeg"].forEach((k) => {
      if (loop.meta[k] == null) loop.meta[k] = base.meta[k];
    });
    return loop;
  }

  function addUnique(list, item, cap) {
    const s = String(item || "").replace(/\s+/g, " ").trim();
    if (!s) return list;
    if (list.indexOf(s) < 0) list.push(s);
    while (list.length > (cap || 12)) list.shift();
    return list;
  }

  function bestAdapter(meta) {
    let id = meta.lastAdapter || "example";
    let best = -Infinity;
    Object.keys(meta.credit || {}).forEach((k) => {
      if (meta.credit[k] > best) {
        best = meta.credit[k];
        id = k;
      }
    });
    return id;
  }

  function tuneMeta(loop, reward) {
    const m = loop.meta;
    m.emaReward = 0.85 * m.emaReward + 0.15 * reward;
    const a = m.lastAdapter || "example";
    if (m.lr[a] == null) m.lr[a] = 1;
    if (reward > 0) {
      m.lr[a] = clamp(m.lr[a] * 1.1, 0.25, 2.5);
      m.credit[a] = (m.credit[a] || 0) + 1;
      m.rewardsPos += 1;
    } else {
      m.lr[a] = clamp(m.lr[a] * 0.88, 0.25, 2.5);
      m.credit[a] = (m.credit[a] || 0) - 0.5;
      m.rewardsNeg += 1;
    }
    if (m.emaFallback > 0.32) {
      m.lr.example = clamp(m.lr.example * 1.06, 0.25, 2.5);
      loop.blendHash = clamp(loop.blendHash + 0.03 * (m.lr.blend || 1), 0.2, 0.8);
      m.lastAdapter = "blend";
    } else if (m.emaReward > 0.35 && m.emaFallback < 0.12) {
      Object.keys(m.lr).forEach((k) => {
        m.lr[k] = clamp(m.lr[k] * 0.97, 0.25, 2.5);
      });
    } else {
      m.lastAdapter = bestAdapter(m);
    }
  }

  function applyReward(store, episode, reward, adapter) {
    const loop = ensureLoop(store);
    if (!episode || !episode.intent) return loop;
    const m = loop.meta;
    if (adapter) m.lastAdapter = adapter;
    const intent = episode.intent;
    const lrEx = m.lr.example || 1;
    const lrKw = m.lr.keyword || 1;
    if (reward > 0 && intent !== "fallback") {
      loop.examples[intent] = addUnique(loop.examples[intent] || [], episode.input, Math.round(8 + 4 * lrEx));
      loop.keywordBoost[intent] = loop.keywordBoost[intent] || {};
      (episode.tokens || []).forEach((tok) => {
        if (!tok || tok.length < 3) return;
        loop.keywordBoost[intent][tok] = clamp((loop.keywordBoost[intent][tok] || 0) + 0.045 * lrKw, -0.35, 0.55);
      });
    } else if (reward < 0) {
      loop.anti[intent] = addUnique(loop.anti[intent] || [], episode.input, 8);
      loop.keywordBoost[intent] = loop.keywordBoost[intent] || {};
      (episode.tokens || []).forEach((tok) => {
        if (!tok || tok.length < 3) return;
        loop.keywordBoost[intent][tok] = clamp((loop.keywordBoost[intent][tok] || 0) - 0.03 * lrKw, -0.35, 0.55);
      });
      loop.threshold = clamp(loop.threshold + 0.015 * (m.lr.threshold || 1) * (intent === "fallback" ? -1 : 1), 0.28, 0.6);
    }
    episode.reward = (episode.reward || 0) + reward;
    tuneMeta(loop, reward);
    loop.note =
      reward > 0
        ? "Rewarded " + intent + " locally (" + (m.lastAdapter || "example") + ")."
        : "Downweighted " + intent + " locally.";
    return loop;
  }

  function mutateUtterance(text, brain) {
    const synonyms = (brain && brain.lexicon && brain.lexicon.synonyms) || {};
    const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!tokens.length) return String(text || "");
    const mode = Math.floor(Math.random() * 4);
    const out = tokens.slice();
    if (mode === 0) {
      for (let i = 0; i < out.length; i++) {
        if (synonyms[out[i]] && synonyms[out[i]] !== out[i]) {
          out[i] = synonyms[out[i]];
          break;
        }
      }
    } else if (mode === 1 && out.length > 2) {
      out.splice(Math.floor(Math.random() * out.length), 1);
    } else if (mode === 2) {
      const i = Math.floor(Math.random() * out.length);
      const w = out[i];
      if (w.length > 3) out[i] = w[0] + w[2] + w[1] + w.slice(3);
    } else {
      out.push(out[out.length - 1]);
    }
    return out.join(" ");
  }

  function rehearseOnce(brain, store) {
    const loop = ensureLoop(store);
    const pool = (loop.episodes || []).filter((e) => e && e.intent && e.intent !== "fallback" && (e.reward || 0) >= 0);
    if (!pool.length) return null;
    const ep = pool[Math.floor(Math.random() * pool.length)];
    const mutant = mutateUtterance(ep.input, brain);
    if (!mutant || mutant === String(ep.input || "").toLowerCase()) return null;
    const perceived = perceive(mutant, brain);
    const ranked = classifyIntents(perceived, brain, loop);
    const top = ranked[0];
    const got = top && top.id;
    const hit = got === ep.intent;
    loop.meta.rehearsals += 1;
    if (hit) {
      loop.meta.rehearsalHits += 1;
      loop.keywordBoost[ep.intent] = loop.keywordBoost[ep.intent] || {};
      (perceived.content || []).forEach((tok) => {
        if (tok.length < 3) return;
        loop.keywordBoost[ep.intent][tok] = clamp((loop.keywordBoost[ep.intent][tok] || 0) + 0.01 * (loop.meta.lr.keyword || 1), -0.35, 0.55);
      });
      loop.meta.lastAdapter = "keyword";
      loop.note = "Rehearsal hit: “" + mutant.slice(0, 48) + "” still " + ep.intent + ".";
    } else if (got) {
      loop.examples[ep.intent] = addUnique(loop.examples[ep.intent] || [], mutant, 12);
      loop.anti[got] = addUnique(loop.anti[got] || [], mutant, 8);
      loop.meta.promotions += 1;
      loop.meta.lastAdapter = "example";
      loop.note = "Rehearsal miss → taught “" + mutant.slice(0, 40) + "” as " + ep.intent + ".";
    }
    return { mutant: mutant, want: ep.intent, got: got, hit: hit };
  }

  function loopSnapshot(store) {
    const loop = ensureLoop(store);
    const m = loop.meta;
    const acc = m.rehearsals ? m.rehearsalHits / m.rehearsals : 0;
    return {
      rehearsals: m.rehearsals,
      rehearsalHits: m.rehearsalHits,
      accuracy: acc,
      promotions: m.promotions,
      corrections: m.corrections,
      rewardsPos: m.rewardsPos,
      rewardsNeg: m.rewardsNeg,
      emaReward: m.emaReward,
      emaFallback: m.emaFallback,
      threshold: loop.threshold,
      blendHash: loop.blendHash,
      lr: clone(m.lr),
      credit: clone(m.credit),
      lastAdapter: m.lastAdapter,
      note: loop.note || "",
      exampleCount: Object.keys(loop.examples).reduce((n, k) => n + (loop.examples[k] || []).length, 0),
      episodes: (loop.episodes || []).length
    };
  }

  function compileBrain(raw) {
    const brain = clone(raw);
    brain.intents = brain.intents || [];
    brain.graph = brain.graph || { nodes: [], edges: [] };
    brain.graph.nodes = brain.graph.nodes || [];
    brain.graph.edges = brain.graph.edges || [];
    brain.lexicon = brain.lexicon || { synonyms: {}, stopwords: {}, fiHints: [] };
    brain.safety = brain.safety || { block_patterns: [], blocked: { en: "", fi: "" } };
    brain.dialogue = brain.dialogue || { flows: [] };
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
        brain._docs.push({
          kind: "intent",
          id: intent.id,
          text: ex,
          ngram: charNgrams(ex, 3),
          hash: hashVec(ex)
        });
      });
    });
    brain.graph.nodes.forEach((node) => {
      ["en", "fi"].forEach((lang) => {
        const summary = node.summary && node.summary[lang];
        if (summary) {
          brain._docs.push({
            kind: "node",
            id: node.id,
            lang,
            text: summary,
            ngram: charNgrams(summary, 3),
            hash: hashVec(summary)
          });
        }
        ((node.facts && node.facts[lang]) || []).forEach((fact, i) => {
          brain._docs.push({
            kind: "fact",
            id: node.id,
            lang,
            i,
            text: fact,
            ngram: charNgrams(fact, 3),
            hash: hashVec(fact)
          });
        });
      });
    });
    brain._idf = Object.create(null);
    brain._docs.forEach((doc) => {
      Object.keys(doc.hash || {}).forEach((k) => {
        brain._idf[k] = (brain._idf[k] || 0) + 1;
      });
    });
    brain._idfN = brain._docs.length || 1;
    brain._docs.forEach((doc) => {
      doc.vec = blendVec(doc.ngram, doc.hash, brain._idf, brain._idfN);
    });
    return brain;
  }

  function loadStore() {
    if (typeof localStorage === "undefined") return defaultStore();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      const merged = Object.assign(defaultStore(), JSON.parse(raw));
      merged.quiz = Object.assign(defaultStore().quiz, merged.quiz || {});
      merged.profiles = merged.profiles || [];
      merged.failures = merged.failures || [];
      ensureLoop(merged);
      return merged;
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
      turns: [],
      quiz: { lastCorrect: 0, lastAsked: 0, bestCorrect: 0, bestAsked: 0, rounds: 0 },
      profiles: [],
      failures: [],
      loop: defaultLoop()
    };
  }

  function saveStore(store) {
    if (typeof localStorage === "undefined") return;
    try {
      const slim = clone(store);
      slim.turns = (slim.turns || []).slice(-24);
      if (slim.loop) {
        slim.loop.episodes = (slim.loop.episodes || []).slice(-80);
      }
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
    let normalized = raw
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[¡!?.]+$/g, "")
      .toLowerCase()
      .replace(/\bwhat's\b/g, "what is")
      .replace(/\bwhats\b/g, "what is")
      .replace(/\bwho's\b/g, "who is")
      .replace(/\bhow's\b/g, "how is")
      .replace(/\bi'm\b/g, "i am")
      .replace(/\bcan't\b/g, "can not")
      .replace(/\baren't\b/g, "are not")
      .replace(/\bwon't\b/g, "will not")
      .replace(/\blet's\b/g, "let us")
      .replace(/\bsee ya\b/g, "see you")
      .replace(/\bcya\b/g, "see you")
      .replace(/\bhow r u\b/g, "how are you")
      .replace(/\br u\b/g, "are you")
      .replace(/\bwow+\b/g, "wow");
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
      empty: !normalized,
      vec: charNgrams(normalized, 3),
      hashVec: hashVec(normalized),
      blend: blendVec(charNgrams(normalized, 3), hashVec(normalized), brain && brain._idf, brain && brain._idfN)
    };
  }

  function extractEntities(perceived, brain) {
    const found = Object.create(null);
    const hay = perceived.stems.concat(perceived.tokens);
    const FUZZY_SKIP = new Set([
      "does", "have", "this", "that", "with", "from", "they", "them", "then", "than",
      "were", "been", "will", "what", "when", "where", "your", "you", "are", "and"
    ]);
    Object.keys(brain.entities || {}).forEach((slot) => {
      const spec = brain.entities[slot];
      if (spec.type !== "gazetteer") return;
      Object.keys(spec.values).forEach((canonical) => {
        spec.values[canonical].forEach((alias) => {
          const a = alias.toLowerCase();
          hay.forEach((tok) => {
            if (tok === a || tok === stem(a, brain.lexicon.synonyms)) found[slot] = canonical;
          });
        });
      });
      if (found[slot]) return;
      Object.keys(spec.values).forEach((canonical) => {
        spec.values[canonical].forEach((alias) => {
          const a = alias.toLowerCase();
          hay.forEach((tok) => {
            if (FUZZY_SKIP.has(tok)) return;
            if (tok.length >= 4 && a.length >= 4 && levenshtein(tok, a) === 1) found[slot] = canonical;
            else if (adjacentTranspose(tok, a) || adjacentTranspose(tok, stem(a, brain.lexicon.synonyms))) {
              found[slot] = canonical;
            }
          });
        });
      });
    });

    const attrs = brain.attributes || {};
    Object.keys(attrs).forEach((key) => {
      (attrs[key] || []).forEach((alias) => {
        if (hasKeyword(perceived, alias)) found.attr = key;
      });
    });

    const mathHit = parseMath(perceived.normalized);
    if (mathHit) {
      found.math = mathHit;
      if (mathHit.pretty && !mathHit.error) {
        const pair = perceived.normalized.match(/(-?\d+(?:[.,]\d+)?)\s*([+\-*/x×÷]|plus|minus|times)\s*(-?\d+(?:[.,]\d+)?)/i);
        if (pair) {
          found.left = pair[1].replace(",", ".");
          found.op = pair[2];
          found.right = pair[3].replace(",", ".");
        }
      }
    }

    const conv = parseConversion(perceived.normalized);
    if (conv) found.conversion = conv;

    const callMe = perceived.raw.match(/\b(?:call me|kutsu minua)\s+([A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ'-]{0,32})/i);
    const myName = perceived.raw.match(/\b(?:my name is|my name's|nimeni on|i am called|i'm called)\s+([A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ'-]{0,32})/i);
    const iAm = perceived.raw.match(/\bI am\s+([A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ'-]{0,32})/);
    let person = (callMe && callMe[1]) || (myName && myName[1]) || null;
    if (!person && iAm && /^[A-ZÀ-Ö]/.test(iAm[1]) && !NAME_STOP.has(iAm[1].toLowerCase())) person = iAm[1];
    if (person && !NAME_STOP.has(person.toLowerCase()) && !/^(called|a|an|the)$/i.test(person)) {
      found.personName = person;
    }

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

    const emotionTok = perceived.tokens.find((t) => EMOTIONS[t]);
    if (emotionTok) found.emotion = EMOTIONS[emotionTok];

    const countTo = perceived.normalized.match(/\bcount(?:ing)? to (\d{1,3})\b/);
    if (countTo) found.countTo = Math.min(40, parseInt(countTo[1], 10));

    const reverse = perceived.normalized.match(/\breverse(?:\s+word)?\s+(.+)/);
    if (reverse) found.reverse = reverse[1].trim();
    const spell = perceived.normalized.match(/\bspell\s+([a-zà-öø-ÿ-]+)/i);
    if (spell) found.spell = spell[1];

    const named = perceived.raw.match(/\bnamed\s+([A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ'-]{0,32})/i);
    if (named && !NAME_STOP.has(named[1].toLowerCase())) found.petName = named[1];
    const years = perceived.normalized.match(/(\d{1,2})\s*(?:years? old|year old|yo|vuotias)\b/);
    if (years) found.age = years[1];
    if (found.animal && found.animal !== "both") found.species = found.species || found.animal;

    const nodes = (brain.graph && brain.graph.nodes) || [];
    nodes.forEach((n) => {
      const labels = [n.id, loc(n.label, "en"), loc(n.label, "fi")].filter(Boolean).map((s) => String(s).toLowerCase());
      labels.forEach((lab) => {
        if (!lab) return;
        if (hasKeyword(perceived, lab) || perceived.stems.includes(lab) || perceived.tokens.includes(lab)) {
          found.node = n.id;
          if (n.type === "animal") found.animal = found.animal || n.id;
        }
      });
    });

    return found;
  }

  function foundPersonCue(perceived) {
    return /\b(my name is|my name's|nimeni on|call me|i am called|i'm called|kutsu minua)\b/i.test(perceived.raw) ||
      /\bI am\s+[A-ZÀ-Ö]/.test(perceived.raw);
  }

  function scoreIntent(perceived, intent, loop) {
    if (intent.id === "fallback") return 0.05;
    let score = 0;
    (intent._re || []).forEach((re) => {
      re.lastIndex = 0;
      if (re.test(perceived.normalized) || re.test(perceived.raw)) score += 0.38;
    });
    const kw = intent.keywords || {};
    Object.keys(kw).forEach((word) => {
      if (hasKeyword(perceived, word)) score += kw[word];
    });
    const boost = (loop && loop.keywordBoost && loop.keywordBoost[intent.id]) || {};
    Object.keys(boost).forEach((word) => {
      if (hasKeyword(perceived, word)) score += boost[word];
    });
    let bestEx = 0;
    (intent.examples || []).forEach((ex) => {
      bestEx = Math.max(bestEx, cosine(perceived.vec, charNgrams(ex, 3)));
    });
    ((loop && loop.examples && loop.examples[intent.id]) || []).forEach((ex) => {
      bestEx = Math.max(bestEx, cosine(perceived.vec, charNgrams(ex, 3)));
    });
    score += bestEx * 0.55;
    let antiBest = 0;
    ((loop && loop.anti && loop.anti[intent.id]) || []).forEach((ex) => {
      antiBest = Math.max(antiBest, cosine(perceived.vec, charNgrams(ex, 3)));
    });
    score -= antiBest * 0.42;
    score += (intent.priority || 0) * 0.012;
    if (intent.id === "show_media" && /^(cat|dog|both|kissa|koira|molemmat|kitty|puppy|dgo|cta)$/i.test(perceived.normalized)) {
      score += 0.5;
    }
    if (intent.id === "math" && !parseMath(perceived.normalized)) score *= 0.05;
    if (intent.id === "datetime" && /\btimes\b/.test(perceived.normalized) && !/\b(time|date|kello|day|year)\b/.test(perceived.normalized)) {
      score *= 0.05;
    }
    if (intent.id === "remember_name" && !foundPersonCue(perceived)) score *= 0.08;
    if (intent.id === "yes_no" && /\b(how are you|are you there|are you (chatgpt|gpt|online|offline|local|a bot))\b/.test(perceived.normalized)) {
      score *= 0.05;
    }
    if (intent.id === "teach" && !/\b(when i say|if i say|teach|remember that|kun sanon|opeta)\b/i.test(perceived.normalized)) {
      score *= 0.08;
    }
    if (intent.id === "quiz" && /\b(stop|end|quit) quiz\b/.test(perceived.normalized)) {
      score *= 0.05;
    }
    if (intent.id === "howdy" && !/\b(how are you|how is it going|what is up|mitä kuuluu)\b/.test(perceived.normalized)) {
      score *= 0.2;
    }
    if (intent.id === "how_works" && /\bhow do i\b/.test(perceived.normalized) && !/\b(work|pipeline|phase|cloud)\b/.test(perceived.normalized)) {
      score *= 0.15;
    }
    if (intent.id === "attr_qa" && !/\b(how many|does a |have|legs|toes|kuinka)\b/.test(perceived.normalized)) {
      score *= 0.1;
    }
    return clamp(score, 0, 1.5);
  }

  function classifyIntents(perceived, brain, loop) {
    const ranked = brain.intents
      .map((intent) => ({ id: intent.id, handler: intent.handler, score: scoreIntent(perceived, intent, loop), intent }))
      .sort((a, b) => b.score - a.score);
    return ranked;
  }

  function semanticSearch(perceived, brain, lang, loop) {
    const qBlend = perceived.blend || perceived.vec;
    const h = loop && loop.blendHash != null ? clamp(loop.blendHash, 0.2, 0.8) : 0.5;
    return brain._docs
      .map((doc) => {
        const ngramScore = cosine(perceived.vec, doc.ngram || doc.vec || {});
        const hashScore = cosine(qBlend, doc.vec || {});
        const score = ((1 - h) * ngramScore + h * hashScore) * (doc.lang && doc.lang !== lang ? 0.85 : 1);
        return { ...doc, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  function flowAsk(flow, slot, lang) {
    if (!flow || !flow.ask) return "";
    const ask = flow.ask;
    if (slot && ask[slot] && typeof ask[slot] === "object") return loc(ask[slot], lang);
    if (slot && typeof ask[slot] === "string") return ask[slot];
    if (ask.en || ask.fi) return loc(ask, lang);
    return "";
  }

  function fillFlowSlot(slot, perceived, entities) {
    if (!slot) return;
    if (slot === "species" || slot === "animal") {
      if (entities.animal && entities.animal !== "both") entities.species = entities.animal;
      else if (entities.node) entities.species = entities.node;
      else if (perceived.tokens[0]) entities[slot] = perceived.tokens[0];
      if (slot === "animal" && entities.species && !entities.animal) entities.animal = entities.species;
      return;
    }
    if (slot === "age") {
      const m = perceived.normalized.match(/(\d{1,2})/);
      if (m) entities.age = m[1];
      return;
    }
    if (slot === "petName") {
      const skip = new Set(["a", "an", "the", "named", "pet", "add", "my", "is", "called"]);
      const m = perceived.raw.match(/[A-Za-zÀ-öø-ÿ][\wÀ-öø-ÿ'-]{0,32}/g) || [];
      const name = m.find((w) => !skip.has(w.toLowerCase()) && !NAME_STOP.has(w.toLowerCase()));
      entities.petName = name || perceived.raw.trim().slice(0, 32);
      return;
    }
    if (!entities[slot]) entities[slot] = perceived.raw.trim().slice(0, 80);
  }

  function applyIntentsOnly(current, next) {
    return mergeBrains(current, { intents: (next && next.intents) || [], responses: (next && next.responses) || {} });
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

  function animalLabel(id, lang, brain) {
    const map = {
      cat: { en: "cat", fi: "kissa" },
      dog: { en: "dog", fi: "koira" },
      both: { en: "cat and dog", fi: "kissa ja koira" }
    };
    if (map[id] && map[id][lang]) return map[id][lang];
    const n = brain && brain._nodeById && brain._nodeById[id];
    if (n) return loc(n.label, lang) || id;
    return id || "";
  }

  function canDraw(animal) {
    return animal === "cat" || animal === "dog" || animal === "both";
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

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildQuizDeck(brain, topic) {
    const deck = [];
    const seen = new Set();
    function push(q) {
      if (!q || !q.id || seen.has(q.id)) return;
      if (topic && q.topic && q.topic !== topic && q.topic !== "any") return;
      seen.add(q.id);
      deck.push(clone(q));
    }
    (brain.quiz || []).forEach(push);
    ((brain.graph && brain.graph.edges) || []).forEach((e) => {
      if (e.rel !== "is_a") return;
      const from = brain._nodeById[e.from];
      const to = brain._nodeById[e.to];
      if (!from || !to) return;
      const fromEn = loc(from.label, "en");
      const toEn = loc(to.label, "en");
      const fromFi = loc(from.label, "fi");
      const toFi = loc(to.label, "fi");
      push({
        id: "isa_" + e.from + "_" + e.to,
        topic: e.from,
        q: {
          en: "Is a " + fromEn + " a " + toEn + "? (yes/no)",
          fi: "Onko " + fromFi + " " + toFi + "? (kyllä/ei)"
        },
        accept: ["yes", "y", "yeah", "kyllä", "joo", toEn, toFi].filter(Boolean),
        reject: ["no", "nope", "nah", "ei"],
        explain: {
          en: "Yes — in the JSON graph, " + e.from + " —is_a→ " + e.to + ".",
          fi: "Kyllä — JSON-kaaviossa " + e.from + " —is_a→ " + e.to + "."
        }
      });
    });
    Object.keys(brain._nodeById || {}).forEach((id) => {
      const n = brain._nodeById[id];
      const legs = n.attrs && n.attrs.legs;
      if (!legs) return;
      const val = String(loc(legs, "en")).replace(/[^\d].*/, "") || String(loc(legs, "en"));
      if (!/^\d+$/.test(val)) return;
      push({
        id: "legs_" + id,
        topic: id,
        q: {
          en: "How many legs does a " + loc(n.label, "en") + " typically have?",
          fi: "Kuinka monta jalkaa " + loc(n.label, "fi") + " yleensä?"
        },
        accept: [val, val === "4" ? "four" : "", val === "2" ? "two" : ""].filter(Boolean),
        explain: {
          en: loc(n.label, "en") + " — legs: " + val + ".",
          fi: loc(n.label, "fi") + " — jalkaa: " + val + "."
        }
      });
    });
    return shuffle(deck).slice(0, 5);
  }

  function gradeQuizAnswer(q, perceived) {
    const hay = perceived.normalized;
    const tokens = perceived.tokens.concat(perceived.stems);
    const accept = (q.accept || []).map((s) => String(s).toLowerCase());
    const reject = (q.reject || []).map((s) => String(s).toLowerCase());
    const hit = (list) =>
      list.some((a) => {
        if (!a) return false;
        if (hay === a || tokens.includes(a)) return true;
        return a.length > 2 && hay.includes(a);
      });
    if (hit(accept)) return true;
    if (hit(reject)) return false;
    let best = 0;
    accept.forEach((a) => {
      best = Math.max(best, cosine(perceived.vec, charNgrams(a, 3)));
    });
    return best >= 0.78;
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
    let raw = clone(rawBrain);
    let brain = compileBrain(raw);
    const store = loadStore();
    const state = {
      topic: null,
      lastIntent: null,
      awaiting: null,
      flowId: null,
      slots: {},
      lang: store.lang || "en",
      lastReply: "",
      quiz: null,
      lastEpisode: null,
      lastRanked: []
    };

    function tracesPush(traces, phase, id, title, detail, activation) {
      traces.push({ phase, id, title, detail, activation: clamp(activation, 0, 1) });
    }

    function reply(userText) {
      const traces = [];
      const loop = ensureLoop(store);
      const perceived = perceive(userText, brain);
      tracesPush(
        traces,
        1,
        "perception",
        "Perception",
        `${perceived.lang} · ${perceived.tokens.length} tokens · sentiment ${perceived.sentiment >= 0 ? "+" : ""}${perceived.sentiment}`,
        0.95
      );

      const meantHit = perceived.normalized.match(/^meant[:\s]+([a-z0-9_]+)$/);
      const entities = extractEntities(perceived, brain);
      const ranked = classifyIntents(perceived, brain, loop);
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
      const hits = semanticSearch(perceived, brain, langGuess, loop);
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
      if (entities.math) prefer("math");
      else if (entities.left && entities.op && entities.right) prefer("math");
      else ranked.forEach((r) => {
        if (r.id === "math" && !entities.math && !entities.left) r.score *= 0.15;
      });
      if (entities.conversion) prefer("convert");
      if (/^(cat|dog|both|kissa|koira|molemmat|kitty|puppy)$/i.test(perceived.normalized) || adjacentTranspose(perceived.normalized, "cat") || adjacentTranspose(perceived.normalized, "dog")) prefer("show_media");
      if (entities.node && /\b(what is|what is a|tell me about|facts? about|kerro)\b/.test(perceived.normalized) && !entities.math) prefer("animal_fact");
      if (/^(is|are|onko)\b/.test(perceived.normalized) && !entities.math && !/\bare you\b/.test(perceived.normalized)) prefer("yes_no");
      if (foundPersonCue(perceived)) prefer("remember_name");
      if (/\b(i (like|love|prefer)|favorite animal is|tykkään|rakastan)\b/i.test(perceived.normalized) && !/\b(do you|your favorite)\b/i.test(perceived.normalized)) prefer("remember_pref");
      if (/\b(how are you|how is it going|what is up|mitä kuuluu)\b/.test(perceived.normalized) && !/\blearning\b/.test(perceived.normalized)) prefer("howdy");
      if (/\bgood (morning|afternoon|evening|night|huomenta|päivää|iltaa|yötä)\b/.test(perceived.normalized)) prefer("daypart");
      if (/\b(weather|forecast|sää)\b/.test(perceived.normalized)) prefer("weather");
      if (/\b(are you (there|online|offline|local|chatgpt|gpt|a bot)|who made you|where are you)\b/.test(perceived.normalized)) prefer("origin");
      if (/\b(do you (like|love)|your favorite)\b/.test(perceived.normalized)) prefer("bot_opinion");
      if (/\b(how many|does a |do .+ have)\b/.test(perceived.normalized) && (entities.attr || entities.animal)) prefer("attr_qa");
      if (/\b(flip|coin|dice|die|noppa|kolikko)\b/.test(perceived.normalized)) prefer("play");
      if (/\b(reverse|spell|count to)\b/.test(perceived.normalized)) prefer("transform");
      if (/\b(repeat|say that again|what did you say|toista)\b/.test(perceived.normalized)) prefer("repeat");
      if (entities.emotion && !foundPersonCue(perceived)) prefer("emotion");
      if (/\b(quiz me|test me|kysy minulta)\b/.test(perceived.normalized) && !/\b(stop|end|quit) quiz\b/.test(perceived.normalized)) prefer("quiz");
      if (/\b(summarize|recap|what did we talk about|tiivistä|yhteenveto)\b/.test(perceived.normalized)) prefer("recap");
      if (/\b(add (a |my )?pet|new pet|pet profile|lisää lemmikki)\b/.test(perceived.normalized)) prefer("add_pet");
      if (/\b(how are you learning|learning loop|rehearsal|are you (getting|getting any) better)\b/.test(perceived.normalized)) prefer("learn_status");
      if (/\b(that('?s| is) wrong|not what i meant|bad answer|you got that wrong)\b/.test(perceived.normalized)) prefer("critique");
      if (perceived.empty) prefer("empty");
      ranked.sort((a, b) => b.score - a.score);

      let top = ranked[0];
      const thresh = loop.threshold != null ? loop.threshold : INTENT_THRESHOLD;
      if (!top || top.score < thresh) {
        top = ranked.find((r) => r.id === "fallback") || { id: "fallback", handler: "fallback", score: 0, intent: { id: "fallback" } };
      }

      if (perceived.empty) {
        top = ranked.find((r) => r.id === "empty") || { id: "empty", handler: "empty", score: 1, intent: { id: "empty" } };
      }

      const isAck = /^(yes|yep|yeah|ok|okay|sure|please|joo|kyllä)$/i.test(perceived.normalized);
      const isDeny = /^(no|nope|nah|nevermind|never mind|cancel|stop|ei|älä)$/i.test(perceived.normalized);

      if (state.awaiting === "animal" && !state.flowId && entities.animal) {
        top = ranked.find((r) => r.id === "show_media") || top;
        state.awaiting = null;
      } else if (state.awaiting === "animal" && !state.flowId && isAck) {
        if (state.topic) {
          entities.animal = state.topic;
          top = ranked.find((r) => r.id === "show_media") || { id: "show_media", handler: "media", score: 1 };
          state.awaiting = null;
        }
      } else if (state.awaiting && isDeny) {
        state.awaiting = null;
        state.flowId = null;
        state.slots = {};
        top = ranked.find((r) => r.id === "deny") || { id: "deny", handler: "deny", score: 1 };
      }

      if (state.flowId && !isDeny && !perceived.empty && !(state.quiz && state.quiz.active)) {
        const active = (brain.dialogue.flows || []).find((f) => f.id === state.flowId);
        if (active) {
          fillFlowSlot(state.awaiting, perceived, entities);
          const intentObj = (brain.intents || []).find((i) => i.id === active.intent);
          top = {
            id: active.intent,
            handler: (intentObj && intentObj.handler) || active.intent,
            score: 1,
            intent: intentObj || { id: active.intent }
          };
        }
      }

      if (state.quiz && state.quiz.active && !/\b(quiz me|start quiz|test me|kysy minulta)\b/.test(perceived.normalized)) {
        top = { id: "quiz", handler: "quiz", score: 1, intent: { id: "quiz" } };
        const n = perceived.normalized;
        if (/^(stop|end|quit|lopeta|enough)( quiz| tentti)?$/.test(n) || /\b(stop quiz|end quiz|quit quiz|lopeta tentti)\b/.test(n)) {
          entities.quizAct = "stop";
        } else if (/^(skip|next|ohita)$/.test(n) || /\b(skip|ohita)\b/.test(n)) {
          entities.quizAct = "skip";
        } else {
          entities.quizAct = "answer";
        }
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
        if (/\b(another|again|uudestaan)\b/.test(perceived.normalized) || state.lastIntent === "show_media" && /\banother\b/.test(perceived.normalized)) {
          top = ranked.find((r) => r.id === "show_media") || top;
        } else {
          top = ranked.find((r) => r.id === "animal_fact") || top;
        }
      }

      if (meantHit && !(state.quiz && state.quiz.active)) {
        const want = meantHit[1];
        const known = (brain.intents || []).some((i) => i.id === want);
        if (known && state.lastEpisode) {
          if (state.lastEpisode.intent && state.lastEpisode.intent !== want) {
            applyReward(store, { input: state.lastEpisode.input, intent: state.lastEpisode.intent, tokens: state.lastEpisode.tokens }, -1, "example");
          }
          state.lastEpisode.intent = want;
          applyReward(store, state.lastEpisode, 1, "example");
          loop.meta.corrections += 1;
          loop.examples[want] = addUnique(loop.examples[want] || [], state.lastEpisode.input, 12);
          top = { id: "learn_status", handler: "learn_status", score: 1, intent: { id: "learn_status" } };
        }
      } else if (
        state.lastEpisode &&
        state.lastEpisode.intent === "fallback" &&
        top.id !== "fallback" &&
        (top.score || 0) >= thresh &&
        !perceived.empty
      ) {
        const sim = cosine(charNgrams(state.lastEpisode.input, 3), perceived.vec);
        if (sim > 0.42) {
          loop.examples[top.id] = addUnique(loop.examples[top.id] || [], state.lastEpisode.input, 12);
          loop.meta.promotions += 1;
          loop.note = "Linked a rephrase to " + top.id + ".";
        }
      }

      if (entities.animal) state.topic = entities.animal === "both" ? "cat" : entities.animal;
      if (["it", "them", "that", "se", "niitä"].some((p) => perceived.tokens.includes(p)) && state.topic) {
        entities.animal = entities.animal || state.topic;
      }

      const flow = (brain.dialogue.flows || []).find((f) => f.intent === top.id);
      let waiting = false;
      if (flow && flow.required && top.id !== "deny") {
        flow.required.forEach((slot) => {
          if (entities[slot]) state.slots[slot] = entities[slot];
        });
        const missing = flow.required.filter((slot) => !entities[slot] && !state.slots[slot]);
        if (missing.length) {
          state.awaiting = missing[0];
          state.flowId = flow.id;
          waiting = true;
        } else {
          flow.required.forEach((slot) => {
            if (!entities[slot]) entities[slot] = state.slots[slot];
          });
          state.awaiting = null;
          state.flowId = null;
          state.slots = {};
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
        animal: animalLabel(entities.animal, lang, brain),
        favorite: animalLabel(store.favoriteAnimal, lang, brain)
      };

      let draft = { text: "", html: "", suggestions: loc(brain.suggestions, lang) };
      let reasonNote = top.handler;

      if (waiting) {
        draft.text = flowAsk(flow, state.awaiting, lang) || loc(flow.ask, lang);
        draft.suggestions = lang === "fi" ? ["ei", "peruuta"] : ["cancel", "nevermind"];
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
            } else if (!canDraw(animal)) {
              const n = graphLookup(brain, animal);
              const fact = n ? loc(n.summary, lang) : "";
              draft.text =
                lang === "fi"
                  ? `Osaan piirtää vain kissan ja koiran. ${fact}`.trim()
                  : `I only draw cats and dogs locally. ${fact}`.trim();
            } else {
              draft.html = renderSprites(animal);
              draft.text =
                lang === "fi"
                  ? `Tässä ${animalLabel(animal, "fi", brain)} — piirretty paikallisesti, ei kuva-APIa.`
                  : `Here is a ${animalLabel(animal, "en", brain)} — drawn locally, no image API.`;
              if (node && node.facts) {
                const extra = pick(node.facts[lang] || node.facts.en || []);
                if (extra) draft.text += " " + extra;
              }
            }
            break;
          }
          case "graph_qa": {
            const subj = entities.animal === "both" ? "cat" : entities.animal || entities.node;
            const n = graphLookup(brain, subj) || (hits[0] && hits[0].kind !== "intent" && brain._nodeById[hits[0].id]);
            if (n) {
              const fact = pick((n.facts && (n.facts[lang] || n.facts.en)) || []) || loc(n.summary, lang);
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
                  ? `Muistan: pidät lajista ${animalLabel(entities.animal, "fi", brain)}.`
                  : `I'll remember you like ${animalLabel(entities.animal, "en", brain)}s.`;
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
                  ? `lempilajisi on ${animalLabel(store.favoriteAnimal, "fi", brain)}`
                  : `your favorite is the ${animalLabel(store.favoriteAnimal, "en", brain)}`
              );
            }
            if (store.facts.length) bits.push(store.facts[store.facts.length - 1].text);
            if (store.profiles && store.profiles.length) {
              const p = store.profiles[store.profiles.length - 1];
              bits.push(lang === "fi"
                ? `lemmikki ${p.name} (${p.species}, ${p.age})`
                : `pet ${p.name} (${p.species}, ${p.age})`);
            }
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
            const m = entities.math || applyMath(entities);
            if (m && m.error === "div0") {
              draft.text = lang === "fi" ? "Nollalla ei voi jakaa." : "Division by zero isn't defined. Try another pair of numbers.";
            } else if (m && m.error === "sqrt") {
              draft.text = lang === "fi" ? "Negatiivisen neliöjuuri ei ole reaalinen tässä moottorissa." : "I only take real square roots of non-negative numbers.";
            } else if (m && m.pretty) {
              draft.text = m.expr ? `${m.expr} = ${m.pretty}` : m.pretty;
            } else {
              draft.text = lang === "fi" ? "Anna lasku kuten 12 * 7 tai two plus two." : "Give me an expression like 12 * 7, 2+2+2, or two plus two.";
            }
            break;
          }
          case "datetime": {
            const now = new Date();
            const locale = lang === "fi" ? "fi-FI" : "en-GB";
            if (/\b(year|vuosi)\b/.test(perceived.normalized)) {
              draft.text = String(now.getFullYear());
            } else if (/\b(day|date|päivä|päivämäärä)\b/.test(perceived.normalized) && !/\btime|kello\b/.test(perceived.normalized)) {
              draft.text =
                lang === "fi"
                  ? `Tänään on ${now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`
                  : `Today is ${now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
            } else {
              draft.text =
                lang === "fi"
                  ? `Paikallinen aika tässä laitteessa: ${now.toLocaleString(locale)}.`
                  : `Local device time: ${now.toLocaleString(locale)}.`;
            }
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
          case "empty": {
            draft.text =
              lang === "fi"
                ? "Kirjoita jotain — kissa, lasku, tai vaikka “mitä kuuluu”."
                : "Type something — cat, a sum, or even “how are you”.";
            break;
          }
          case "howdy": {
            draft.text = fillTemplate(
              pick(loc(brain.responses.howdy, lang) || ["I'm well — still fully on-device."]),
              vars
            );
            break;
          }
          case "daypart": {
            const hour = new Date().getHours();
            let part = "afternoon";
            if (/\b(night|yötä)\b/.test(perceived.normalized) || hour >= 21 || hour < 5) part = "night";
            else if (/\b(morning|huomenta)\b/.test(perceived.normalized) || hour < 12) part = "morning";
            else if (/\b(evening|iltaa)\b/.test(perceived.normalized) || hour >= 17) part = "evening";
            const block = brain.responses.daypart && brain.responses.daypart[part];
            draft.text = fillTemplate(pick(loc(block, lang) || ["Good " + part + "{{nameSuffix}}."]), vars);
            break;
          }
          case "weather": {
            draft.text = pick(loc(brain.responses.weather, lang) || [
              "I don't call weather APIs. This engine stays offline — check a window or a local app."
            ]);
            break;
          }
          case "origin": {
            const n = perceived.normalized;
            if (/\b(are you there|can you hear me)\b/.test(n) && !/\b(chatgpt|gpt|online)\b/.test(n)) {
              draft.text =
                lang === "fi"
                  ? "Täällä. Yhä tässä välilehdessä, yhä ilman pilvipäättelyä."
                  : "Here. Still in this tab, still no cloud inference.";
            } else if (/\b(chatgpt|gpt|openai)\b/.test(n)) {
              draft.text =
                lang === "fi"
                  ? "En ole ChatGPT. Olen Cortex: JSON ja JavaScript tässä sivussa."
                  : "I'm not ChatGPT. I'm Cortex: JSON plus JavaScript in this page.";
            } else if (/\b(online|offline|local|internet)\b/.test(n)) {
              draft.text =
                lang === "fi"
                  ? "Päättely on paikallista. En soita mallirajapintaan."
                  : "Inference is local. I don't call a model API — even if the browser can reach the internet.";
            } else if (/\bwhere are you\b/.test(n)) {
              draft.text =
                lang === "fi"
                  ? "Tässä selainvälilehdessä, tiedostossa brain.json plus engine.js."
                  : "In this browser tab — brain.json plus engine.js.";
            } else if (/\bwho made you\b/.test(n)) {
              draft.text =
                lang === "fi"
                  ? "Tämän reposetetin lähetti sen tekijä. Vastaukset kootaan täällä, ei pilvessä."
                  : "Whoever shipped this repo. Replies are assembled here, not in a datacenter.";
            } else {
              draft.text = pick(loc(brain.responses.origin, lang));
            }
            break;
          }
          case "ack": {
            draft.text =
              lang === "fi"
                ? "Selvä. Voit pyytää kissaa, faktaa tai laskua."
                : "Got it. Ask for a cat, a fact, or some math whenever you like.";
            break;
          }
          case "deny": {
            state.flowId = null;
            state.slots = {};
            state.awaiting = null;
            draft.text =
              lang === "fi" ? "Selvä, ei jatketa sitä. Mitä seuraavaksi?" : "Okay, dropping that. What instead — cat, fact, or math?";
            break;
          }
          case "critique": {
            if (state.lastEpisode) applyReward(store, state.lastEpisode, -1, "example");
            const opts = (state.lastRanked || [])
              .filter((r) => r.id && r.id !== "fallback" && r.id !== "critique")
              .slice(0, 4)
              .map((r) => "meant:" + r.id);
            draft.text =
              lang === "fi"
                ? "Selvä — heikennän tuota paikallisesti. Napauta intended-aietta (meant:…)."
                : "Noted — I downweighted that in this browser. Tap what it should have been (meant:…), still no cloud.";
            draft.suggestions = opts.length ? opts.concat(["how are you learning"]) : ["how are you learning", "Save as test"];
            break;
          }
          case "learn_status": {
            const snap = loopSnapshot(store);
            const acc = Math.round(snap.accuracy * 100);
            draft.text =
              lang === "fi"
                ? "Paikallinen oppimissilmukka (ei pilveä). Tenttitarkkuus " +
                  acc +
                  "%. Promootioita " +
                  snap.promotions +
                  ", korjauksia " +
                  snap.corrections +
                  ". Oppimisnopeudet example=" +
                  snap.lr.example.toFixed(2) +
                  " keyword=" +
                  snap.lr.keyword.toFixed(2) +
                  ". " +
                  (snap.note || "")
                : "Local learning loop — no cloud. Rehearsal accuracy " +
                  acc +
                  "%. Promotions " +
                  snap.promotions +
                  ", corrections " +
                  snap.corrections +
                  ", +" +
                  snap.rewardsPos +
                  "/−" +
                  snap.rewardsNeg +
                  " rewards. Adapter LRs example=" +
                  snap.lr.example.toFixed(2) +
                  " keyword=" +
                  snap.lr.keyword.toFixed(2) +
                  " blend=" +
                  snap.lr.blend.toFixed(2) +
                  ". Fallback EMA " +
                  snap.emaFallback.toFixed(2) +
                  ", threshold " +
                  snap.threshold.toFixed(2) +
                  ". " +
                  (snap.note || "Say thanks, “that's wrong”, or meant:animal_fact to teach me.");
            draft.openTab = "loop";
            draft.suggestions = lang === "fi" ? ["kiitos", "that's wrong"] : ["thanks", "that's wrong", "how are you learning"];
            break;
          }
          case "recap": {
            draft.text = recapTurns(store.turns, brain, lang);
            break;
          }
          case "add_pet": {
            const name = entities.petName;
            const species = entities.species || (entities.animal !== "both" ? entities.animal : "");
            const age = entities.age;
            store.profiles = store.profiles || [];
            store.profiles.push({ name, species, age, at: Date.now() });
            const complete = loc(flow && flow.onComplete, lang) || (lang === "fi"
              ? "Tallennettu {{petName}}, {{species}}, {{age}}."
              : "Saved {{petName}}, {{species}}, {{age}}.");
            draft.text = fillTemplate(complete, { petName: name, species, age });
            draft.suggestions = lang === "fi" ? ["lisää lemmikki", "muistatko minut"] : ["add a pet", "do you remember me"];
            break;
          }
          case "repeat": {
            draft.text = state.lastReply
              ? state.lastReply
              : lang === "fi"
                ? "Ei ole vielä mitään toistettavaa."
                : "I haven't said anything to repeat yet.";
            break;
          }
          case "play": {
            if (/\b(dice|die|noppa|roll)\b/.test(perceived.normalized)) {
              const n = 1 + Math.floor(Math.random() * 6);
              draft.text = lang === "fi" ? `Noppa: ${n}.` : `You rolled a ${n}.`;
            } else {
              const side = Math.random() < 0.5 ? "heads" : "tails";
              draft.text =
                lang === "fi"
                  ? `Kolikko: ${side === "heads" ? "kruuna" : "klaava"}.`
                  : `Coin flip: ${side}.`;
            }
            break;
          }
          case "transform": {
            if (entities.countTo) {
              const n = entities.countTo;
              const seq = [];
              for (let i = 1; i <= n; i++) seq.push(String(i));
              draft.text = seq.join(", ") + ".";
            } else if (entities.reverse) {
              draft.text = entities.reverse.split("").reverse().join("");
            } else if (entities.spell) {
              draft.text = entities.spell.toUpperCase().split("").join("-");
            } else {
              draft.text =
                lang === "fi"
                  ? "Kokeile: count to 5, reverse hello, spell cortex."
                  : "Try: count to 5, reverse hello, or spell cortex.";
            }
            break;
          }
          case "convert": {
            if (entities.conversion) {
              draft.text = `${entities.conversion.from} → ${entities.conversion.pretty} ${entities.conversion.unit}`;
            } else {
              draft.text =
                lang === "fi"
                  ? "Kokeile: 10 km to miles, 100 f to c, 5 kg to lb."
                  : "Try: 10 km to miles, 100 F to C, or 5 kg to lb.";
            }
            break;
          }
          case "bot_opinion": {
            const fav = store.favoriteAnimal
              ? lang === "fi"
                ? ` Sinun suosikkisi on ${animalLabel(store.favoriteAnimal, "fi", brain)}.`
                : ` Your favorite on file is the ${animalLabel(store.favoriteAnimal, "en", brain)}.`
              : "";
            draft.text =
              lang === "fi"
                ? "Tykkään molemmista — JSON-aivoissa kissa ja koira ovat tasavertaisia." + fav
                : "I like both: in this JSON brain, cat and dog are equal citizens." + fav;
            break;
          }
          case "attr_qa": {
            const subj = entities.animal === "both" ? "cat" : entities.animal || state.topic;
            const n = graphLookup(brain, subj);
            const key = entities.attr;
            if (n && key && n.attrs && n.attrs[key] != null) {
              const val = loc(n.attrs[key], lang);
              draft.text =
                lang === "fi"
                  ? `${loc(n.label, lang)} — ${key}: ${val}.`
                  : `${loc(n.label, lang)} — ${key}: ${val}.`;
              state.topic = n.id;
            } else if (n) {
              draft.text = loc(n.summary, lang);
              state.topic = n.id;
            } else {
              draft.text = pick(loc(brain.responses.fallback, lang));
            }
            break;
          }
          case "emotion": {
            const kind = entities.emotion;
            draft.text = pick(loc((brain.responses.emotion && brain.responses.emotion[kind]) || brain.responses.emotion && brain.responses.emotion.sad, lang) || [
              "That's heavy. I'm only a local script, but I'm here in this tab."
            ]);
            break;
          }
          case "quiz": {
            store.quiz = store.quiz || defaultStore().quiz;
            const ask = function (q, i, total) {
              return (lang === "fi" ? "Kysymys " + i + "/" + total + ": " : "Q" + i + "/" + total + ": ") + loc(q.q, lang);
            };
            const finish = function () {
              const asked = state.quiz.asked;
              const correct = state.quiz.correct;
              if (!asked) {
                state.quiz = null;
                draft.suggestions = lang === "fi" ? ["kysy minulta", "kissa"] : ["quiz me", "cat"];
                return lang === "fi" ? "Tentti keskeytetty." : "Quiz cancelled.";
              }
              store.quiz.lastCorrect = correct;
              store.quiz.lastAsked = asked;
              store.quiz.rounds += 1;
              if (correct > (store.quiz.bestCorrect || 0) || (correct === store.quiz.bestCorrect && asked <= (store.quiz.bestAsked || asked))) {
                store.quiz.bestCorrect = correct;
                store.quiz.bestAsked = asked;
              }
              state.quiz = null;
              draft.suggestions = lang === "fi" ? ["kysy minulta", "kissa", "miten toimit?"] : ["quiz me", "cat", "how do you work?"];
              return lang === "fi"
                ? "Tentti ohi: " + correct + "/" + asked + ". Paras tässä selaimessa: " + store.quiz.bestCorrect + "/" + (store.quiz.bestAsked || asked) + ". Sano “kysy minulta” uudestaan."
                : "Quiz over: " + correct + "/" + asked + ". Best in this browser: " + store.quiz.bestCorrect + "/" + (store.quiz.bestAsked || asked) + ". Say “quiz me” to go again.";
            };
            const nextQ = function () {
              if (!state.quiz.queue[state.quiz.index]) {
                draft.text = finish();
                return;
              }
              state.quiz.current = state.quiz.queue[state.quiz.index];
              draft.text = ask(state.quiz.current, state.quiz.index + 1, state.quiz.queue.length);
              draft.suggestions = lang === "fi" ? ["ohita", "lopeta tentti"] : ["skip", "stop quiz"];
            };

            if (entities.quizAct === "stop" && state.quiz && state.quiz.active) {
              draft.text = finish();
              break;
            }
            if (entities.quizAct === "skip" && state.quiz && state.quiz.active) {
              state.quiz.asked += 1;
              state.quiz.index += 1;
              const skipped = lang === "fi" ? "Ohitettu. " : "Skipped. ";
              nextQ();
              draft.text = skipped + (draft.text || "");
              break;
            }
            if (entities.quizAct === "answer" && state.quiz && state.quiz.current) {
              const ok = gradeQuizAnswer(state.quiz.current, perceived);
              state.quiz.asked += 1;
              if (ok) state.quiz.correct += 1;
              const verdict = ok
                ? lang === "fi" ? "Oikein. " : "Correct. "
                : lang === "fi" ? "Ei aivan. " : "Not quite. ";
              const why = loc(state.quiz.current.explain, lang) || "";
              state.quiz.index += 1;
              nextQ();
              draft.text = verdict + why + (why ? " " : "") + (draft.text || "");
              break;
            }

            const topic = entities.animal && entities.animal !== "both" ? entities.animal : entities.node || null;
            const deck = buildQuizDeck(brain, topic);
            if (!deck.length) {
              draft.text =
                lang === "fi"
                  ? "En löytänyt tenttikysymyksiä tästä JSON-aivoista."
                  : "No quiz items in this JSON brain yet.";
              break;
            }
            state.quiz = { active: true, queue: deck, index: 0, correct: 0, asked: 0, current: null };
            nextQ();
            const about = topic ? (lang === "fi" ? " Aihe: " + topic + "." : " Topic: " + topic + ".") : "";
            draft.text =
              (lang === "fi"
                ? "Paikallinen tentti tietoverkosta — ei pilveä." + about + " "
                : "Local graph quiz — no cloud." + about + " ") + draft.text;
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
      if (entities.animal === "cat" && top.id !== "add_pet") draft.suggestions = lang === "fi" ? ["kerro kissoista", "koira", "molemmat"] : ["tell me about cats", "dog", "both"];
      if (entities.animal === "dog" && top.id !== "add_pet") draft.suggestions = lang === "fi" ? ["kerro koirista", "kissa", "molemmat"] : ["tell me about dogs", "cat", "both"];
      if (top.id === "fallback") {
        const base = Array.isArray(draft.suggestions) ? draft.suggestions.slice() : loc(brain.suggestions, lang) || [];
        if (base.indexOf("Save as test") < 0) base.push("Save as test");
        ranked
          .filter((r) => r.id !== "fallback" && r.id !== "empty")
          .slice(0, 3)
          .forEach((r) => {
            const chip = "meant:" + r.id;
            if (base.indexOf(chip) < 0) base.push(chip);
          });
        draft.suggestions = base;
      }

      tracesPush(traces, 10, "planner", "Planner", `handler=${top.handler || reasonNote} · ${draft.html ? "media" : "text"}`, 0.9);

      if (top.id === "thanks" && state.lastEpisode) {
        applyReward(store, state.lastEpisode, 1, "example");
      }

      state.lastIntent = top.id;
      state.lang = lang;
      state.lastRanked = ranked.slice(0, 6).map((r) => ({ id: r.id, score: r.score }));
      const skipEpisode = { thanks: 1, critique: 1, learn_status: 1, empty: 1, repeat: 1, deny: 1 };
      if (!skipEpisode[top.id] && perceived.raw) {
        const ep = {
          input: perceived.raw,
          intent: top.id,
          score: top.score || 0,
          tokens: perceived.content || perceived.tokens || [],
          reward: 0,
          at: Date.now()
        };
        loop.episodes.push(ep);
        loop.episodes = loop.episodes.slice(-80);
        state.lastEpisode = ep;
      }
      loop.meta.emaFallback = 0.9 * loop.meta.emaFallback + 0.1 * (top.id === "fallback" ? 1 : 0);

      store.turns.push({ role: "user", text: perceived.raw, at: Date.now() });
      store.turns.push({ role: "assistant", text: draft.text, intent: top.id, at: Date.now() });
      if (top.id !== "repeat") state.lastReply = draft.text;
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
          facts: store.facts.length,
          quiz: store.quiz || defaultStore().quiz,
          profiles: (store.profiles || []).length
        },
        graphFocus: {
          nodes: [entities.node, entities.animal !== "both" ? entities.animal : null, yn && yn.a && yn.a.id, yn && yn.b && yn.b.id, state.topic]
            .filter(Boolean)
            .filter((id, i, arr) => arr.indexOf(id) === i),
          edge: yn && yn.hit ? { from: yn.a.id, to: yn.b.id, rel: yn.hit.rel } : null
        },
        loop: loopSnapshot(store)
      };
    }

    function resetMemory() {
      const fresh = defaultStore();
      Object.keys(store).forEach((k) => delete store[k]);
      Object.assign(store, fresh);
      state.topic = null;
      state.awaiting = null;
      state.flowId = null;
      state.slots = {};
      state.quiz = null;
      state.lastEpisode = null;
      state.lastRanked = [];
      saveStore(store);
    }

    function rehearse(n) {
      const reports = [];
      const steps = Math.max(1, Math.min(12, n || 3));
      for (let i = 0; i < steps; i++) {
        const row = rehearseOnce(brain, store);
        if (row) reports.push(row);
      }
      saveStore(store);
      return { ran: reports.length, hits: reports.filter((r) => r.hit).length, reports: reports, loop: loopSnapshot(store) };
    }

    function resetLoop() {
      store.loop = defaultLoop();
      state.lastEpisode = null;
      saveStore(store);
      return loopSnapshot(store);
    }

    function mergePack(pack) {
      raw = mergeBrains(raw, pack);
      brain = compileBrain(raw);
      return brain;
    }

    function replaceBrain(nextRaw) {
      raw = clone(nextRaw);
      brain = compileBrain(raw);
      return brain;
    }

    return {
      get brain() {
        return brain;
      },
      reply,
      resetMemory,
      resetLoop,
      rehearse,
      mergePack,
      replaceBrain,
      getRaw: () => clone(raw),
      getStore: () => clone(store),
      getState: () => clone(state),
      getLoop: () => loopSnapshot(store)
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
    hashVec,
    blendVec,
    semanticSearch,
    mergeBrains,
    diffBrains,
    applyIntentsOnly,
    recapTurns,
    rehearseOnce,
    mutateUtterance,
    ensureLoop,
    loopSnapshot,
    levenshtein,
    applyMath,
    parseMath,
    parseConversion
  };

  root.Cortex = Cortex;
  if (typeof module !== "undefined" && module.exports) module.exports = Cortex;
})(typeof globalThis !== "undefined" ? globalThis : this);
