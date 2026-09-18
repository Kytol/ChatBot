(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const PACKS_KEY = "cortex.packs.v1";
  const FAIL_KEY = "cortex.failures.v1";

  let session = null;
  let rawBrain = null;
  let baseBrain = null;
  let packCatalog = [];
  let packBodies = Object.create(null);
  let lastFocus = { nodes: [], edge: null };
  let lastUserText = "";
  let pendingImport = null;
  let speakOn = false;

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v === false || v == null) return;
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (kids || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function loc(block, lang) {
    if (!block) return "";
    if (typeof block === "string") return block;
    return block[lang] || block.en || Object.values(block)[0] || "";
  }

  function enabledPacks() {
    try {
      const raw = localStorage.getItem(PACKS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function setEnabledPacks(ids) {
    localStorage.setItem(PACKS_KEY, JSON.stringify(ids));
  }

  function mergedBrain() {
    let next = JSON.parse(JSON.stringify(baseBrain || rawBrain));
    enabledPacks().forEach((id) => {
      if (packBodies[id]) next = Cortex.mergeBrains(next, packBodies[id]);
    });
    return next;
  }

  function compileSession() {
    rawBrain = mergedBrain();
    session = Cortex.createSession(rawBrain);
    $("#brain-json").value = JSON.stringify(baseBrain, null, 2);
    renderPhases(rawBrain.roadmap, []);
    renderRoadmap(rawBrain.roadmap);
    renderGraph(rawBrain, lastFocus);
    renderPacks();
  }

  function renderPhases(roadmap, traces) {
    const rail = $("#phase-list");
    rail.innerHTML = "";
    const byId = Object.create(null);
    (traces || []).forEach((t) => {
      byId[t.id] = t;
    });
    roadmap.forEach((p) => {
      const t = byId[p.id];
      const node = el("div", { class: "phase" + (t ? " on" : ""), "data-phase": String(p.phase) }, [
        el("div", { class: "num" }, [String(p.phase).padStart(2, "0")]),
        el("div", {}, [
          el("div", { class: "title" }, [p.title]),
          el("div", { class: "detail" }, [t ? t.detail : p.summary]),
          el("div", { class: "meter" }, [el("span", { style: `width:${Math.round(((t && t.activation) || 0) * 100)}%` })])
        ])
      ]);
      rail.appendChild(node);
    });
  }

  function renderRoadmap(roadmap) {
    const box = $("#roadmap-list");
    box.innerHTML = "";
    roadmap.forEach((p) => {
      box.appendChild(
        el("article", { class: "roadmap-item" }, [
          el("h3", {}, [`Phase ${p.phase} — ${p.title}`]),
          el("p", {}, [p.summary])
        ])
      );
    });
  }

  function addMessage(role, text, extra) {
    const log = $("#transcript");
    const msg = el("div", { class: "msg " + role }, [
      el("div", { class: "who" }, [role === "user" ? "You" : "Cortex"])
    ]);
    const body = el("div", { class: "body" });
    body.textContent = text || "";
    msg.appendChild(body);
    if (extra && extra.html) {
      const wrap = el("div", { class: "sprites" });
      wrap.innerHTML = extra.html;
      msg.appendChild(wrap);
    }
    if (extra && extra.intent) {
      msg.appendChild(
        el("div", { class: "intent" }, [
          `${extra.intent} · confidence ${extra.score != null ? extra.score.toFixed(2) : "—"} · ${extra.lang || ""}`
        ])
      );
    }
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
  }

  function saveFailure(input) {
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(FAIL_KEY) || "[]");
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
    list.push({ input: input, got: "fallback", want: "" });
    localStorage.setItem(FAIL_KEY, JSON.stringify(list));
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "failures.json" });
    a.click();
    addMessage(
      "bot",
      "Saved a fallback fixture and downloaded failures.json. Fill \"want\" with an intent id, drop it in data/failures.json, then add a pattern. Node runner skips rows until want is set. Snippet: check(" +
        JSON.stringify(input) +
        ", \"animal_fact\", /…/);"
    );
  }

  function renderChips(list) {
    const chips = $("#chips");
    chips.innerHTML = "";
    (list || []).forEach((label) => {
      chips.appendChild(
        el(
          "button",
          {
            class: "chip",
            type: "button",
            onclick: () => {
              if (label === "Save as test") {
                saveFailure(lastUserText);
                return;
              }
              $("#input").value = label;
              send();
            }
          },
          [label]
        )
      );
    });
  }

  function renderTrace(traces) {
    const box = $("#trace-list");
    box.innerHTML = "";
    (traces || []).forEach((t) => {
      box.appendChild(
        el("div", { class: "trace-line" }, [
          el("strong", {}, [`P${t.phase} ${t.title}`]),
          document.createTextNode(" — " + t.detail)
        ])
      );
    });
  }

  function renderMemory() {
    $("#mem-view").innerHTML = "";
    const store = session.getStore();
    const dl = el("dl", {});
    const lastPet = (store.profiles || [])[(store.profiles || []).length - 1];
    const rows = [
      ["Name", store.userName || "—"],
      ["Favorite", store.favoriteAnimal || "—"],
      ["Language lock", store.lang || "auto"],
      ["Taught rules", String((store.learned || []).length)],
      ["Notes", String((store.facts || []).length)],
      ["Pets", lastPet ? lastPet.name + ", " + lastPet.species + ", " + lastPet.age : "—"],
      ["Quiz last", store.quiz && store.quiz.lastAsked ? store.quiz.lastCorrect + "/" + store.quiz.lastAsked : "—"],
      ["Quiz best", store.quiz && store.quiz.bestAsked ? store.quiz.bestCorrect + "/" + store.quiz.bestAsked : "—"]
    ];
    rows.forEach(([k, v]) => {
      dl.appendChild(el("dt", {}, [k]));
      dl.appendChild(el("dd", {}, [v]));
    });
    if (store.learned && store.learned.length) {
      dl.appendChild(el("dt", {}, ["Triggers"]));
      dl.appendChild(el("dd", {}, [store.learned.map((r) => r.trigger).join(", ")]));
    }
    $("#mem-view").appendChild(dl);
  }

  function renderGraph(brain, focus) {
    const host = $("#graph-svg");
    if (!host) return;
    const nodes = (brain.graph && brain.graph.nodes) || [];
    const edges = (brain.graph && brain.graph.edges) || [];
    const W = 320;
    const H = 280;
    const cx = W / 2;
    const cy = H / 2;
    const R = nodes.length > 2 ? 108 : 40;
    const pos = Object.create(null);
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
      pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    const focusNodes = (focus && focus.nodes) || [];
    const focusEdge = focus && focus.edge;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="kg" role="img" aria-label="knowledge graph">`;
    edges.forEach((e) => {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) return;
      const on =
        focusEdge &&
        ((focusEdge.from === e.from && focusEdge.to === e.to) || (focusEdge.from === e.to && focusEdge.to === e.from));
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${on ? "on" : ""}"/>`;
    });
    nodes.forEach((n) => {
      const p = pos[n.id];
      const on = focusNodes.indexOf(n.id) >= 0;
      svg += `<g data-id="${n.id}" class="kg-node${on ? " on" : ""}"><circle cx="${p.x}" cy="${p.y}" r="16"/><text x="${p.x}" y="${p.y + 3}" text-anchor="middle">${n.id}</text></g>`;
    });
    svg += "</svg>";
    host.innerHTML = svg;
    host.querySelectorAll(".kg-node").forEach((g) => {
      g.addEventListener("click", () => {
        const id = g.getAttribute("data-id");
        const n = nodes.find((x) => x.id === id);
        if (!n) return;
        const bits = [loc(n.label, "en") + " (" + n.id + ")", loc(n.summary, "en")];
        if (n.attrs) {
          Object.keys(n.attrs).forEach((k) => bits.push(k + ": " + loc(n.attrs[k], "en")));
        }
        $("#graph-detail").textContent = bits.filter(Boolean).join("\n");
      });
    });
  }

  function renderPacks() {
    const box = $("#pack-list");
    if (!box) return;
    box.innerHTML = "";
    if (!packCatalog.length) return;
    box.appendChild(el("p", { class: "hint" }, ["Skill packs (static JSON, not a model API). Enabled packs merge into the core brain."]));
    const on = new Set(enabledPacks());
    packCatalog.forEach((p) => {
      const id = "pack-" + p.id;
      const row = el("label", { class: "pack-item", for: id }, [
        el("input", {
          type: "checkbox",
          id: id,
          checked: on.has(p.id)
        }),
        el("span", {}, [el("strong", {}, [p.name || p.id]), document.createTextNode(" — " + (p.blurb || ""))])
      ]);
      row.querySelector("input").addEventListener("change", (ev) => {
        const ids = enabledPacks().filter((x) => x !== p.id);
        if (ev.target.checked) ids.push(p.id);
        setEnabledPacks(ids);
        compileSession();
        addMessage(
          "bot",
          ev.target.checked
            ? (p.name || p.id) + " pack enabled locally. Try a phrase from that JSON file."
            : "Pack disabled. Core brain only."
        );
      });
      box.appendChild(row);
    });
  }

  function showTab(id) {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    $$(".panel-body[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== id));
    if (id === "graph") renderGraph(rawBrain || baseBrain, lastFocus);
  }

  function animatePhases(traces) {
    const phases = $$("#phase-list .phase");
    phases.forEach((p) => p.classList.remove("on"));
    traces.forEach((t, i) => {
      window.setTimeout(() => {
        const node = phases[t.phase - 1];
        if (!node) return;
        node.classList.add("on");
        const meter = node.querySelector(".meter > span");
        const detail = node.querySelector(".detail");
        if (meter) meter.style.width = Math.round(t.activation * 100) + "%";
        if (detail) detail.textContent = t.detail;
      }, 28 * i);
    });
  }

  function maybeSpeak(result) {
    if (!speakOn || !window.speechSynthesis) return;
    if (result.html) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(result.text || "");
    u.lang = result.lang === "fi" ? "fi-FI" : "en-GB";
    window.speechSynthesis.speak(u);
  }

  function send() {
    const input = $("#input");
    const text = input.value.trim();
    if (!text || !session) return;
    lastUserText = text;
    addMessage("user", text);
    input.value = "";
    const result = session.reply(text);
    addMessage("bot", result.text, result);
    lastFocus = result.graphFocus || lastFocus;
    animatePhases(result.traces);
    renderTrace(result.traces);
    renderMemory();
    renderChips(result.suggestions);
    renderGraph(rawBrain, lastFocus);
    maybeSpeak(result);
    if (result.openTab) showTab(result.openTab);
  }

  function applyBrainJson() {
    const err = $("#brain-error");
    err.textContent = "";
    try {
      baseBrain = JSON.parse($("#brain-json").value);
      compileSession();
      renderChips(rawBrain.suggestions.en);
      addMessage("bot", "Brain JSON recompiled locally. No server involved.");
    } catch (e) {
      err.textContent = "Invalid JSON: " + e.message;
    }
  }

  function showDiff(next) {
    const diff = Cortex.diffBrains(rawBrain, next);
    pendingImport = { next: next, diff: diff };
    $("#diff-summary").textContent = diff.summary || "(no structural delta)";
    const ul = $("#diff-list");
    ul.innerHTML = "";
    (diff.addedIntents || []).forEach((id) => ul.appendChild(el("li", {}, ["+ intent " + id])));
    (diff.removedIntents || []).forEach((id) => ul.appendChild(el("li", {}, ["− intent " + id])));
    (diff.addedNodes || []).forEach((id) => ul.appendChild(el("li", {}, ["+ node " + id])));
    (diff.removedNodes || []).forEach((id) => ul.appendChild(el("li", {}, ["− node " + id])));
    if (diff.quizDelta) ul.appendChild(el("li", {}, ["quiz delta " + diff.quizDelta]));
    $("#diff-modal").classList.remove("hidden");
  }

  function hideDiff() {
    pendingImport = null;
    $("#diff-modal").classList.add("hidden");
    $("#import-brain").value = "";
  }

  function wireVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $("#mic");
    if (SR) {
      mic.hidden = false;
      $(".row").classList.add("with-mic");
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const said = ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
        if (said) {
          $("#input").value = said;
          send();
        }
        mic.classList.remove("live");
      };
      rec.onerror = () => mic.classList.remove("live");
      rec.onend = () => mic.classList.remove("live");
      mic.addEventListener("click", () => {
        try {
          rec.start();
          mic.classList.add("live");
        } catch (e) {
          /* already started */
        }
      });
    }
    if (window.speechSynthesis) {
      $("#tts-wrap").hidden = false;
      $("#tts").addEventListener("change", (ev) => {
        speakOn = ev.target.checked;
      });
    }
  }

  function registerSW() {
    const host = location.hostname;
    const ok =
      "serviceWorker" in navigator &&
      (location.protocol === "https:" || host === "localhost" || host === "127.0.0.1");
    if (!ok) return;
    navigator.serviceWorker.register("sw.js").then(() => {
      const badge = $("#cache-badge");
      const show = () => {
        if (navigator.serviceWorker.controller) badge.hidden = false;
      };
      show();
      navigator.serviceWorker.addEventListener("controllerchange", show);
    });
  }

  async function loadPacks() {
    try {
      const res = await fetch("data/packs/index.json", { cache: "no-store" });
      if (!res.ok) return;
      packCatalog = await res.json();
      await Promise.all(
        packCatalog.map(async (p) => {
          const r = await fetch("data/packs/" + p.file, { cache: "no-store" });
          if (r.ok) packBodies[p.id] = await r.json();
        })
      );
    } catch (e) {
      packCatalog = [];
    }
  }

  async function boot() {
    renderPhases(
      Array.from({ length: 10 }, (_, i) => ({
        phase: i + 1,
        id: "p" + (i + 1),
        title: "Phase " + (i + 1),
        summary: "loading JSON brain…"
      })),
      []
    );

    try {
      const res = await fetch("data/brain.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      baseBrain = await res.json();
    } catch (e) {
      $("#transcript").appendChild(
        el("div", { class: "msg bot" }, [
          el("div", { class: "who" }, ["Cortex"]),
          el("div", { class: "body" }, [
            "Could not fetch data/brain.json. Serve this folder over HTTP (python3 -m http.server) so the JSON brain can load. Still no cloud AI — only a local static file."
          ])
        ])
      );
      return;
    }

    await loadPacks();
    compileSession();
    renderChips(rawBrain.suggestions.en);
    renderMemory();

    const name = session.getStore().userName;
    addMessage(
      "bot",
      name
        ? `Welcome back, ${name}. I'm still Cortex, still on-device. Say cat, quiz me, add a pet, or summarize our chat.`
        : "I'm Cortex. My intelligence is a JSON file plus a ten-phase engine in this browser — no cloud inference. Try “quiz me”, “add a pet”, “cat”, or “how do you work?”."
    );

    $("#say").addEventListener("click", send);
    $("#input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    $("#apply-brain").addEventListener("click", applyBrainJson);
    $("#reset-mem").addEventListener("click", () => {
      session.resetMemory();
      renderMemory();
      addMessage("bot", "Local memory cleared.");
    });
    $("#download-brain").addEventListener("click", () => {
      const blob = new Blob([$("#brain-json").value], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "brain.json" });
      a.click();
    });
    $("#import-brain").addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const next = JSON.parse(String(reader.result));
          if (!next.intents || !next.graph) {
            $("#brain-error").textContent = "Import needs intents and graph.";
            return;
          }
          showDiff(next);
        } catch (e) {
          $("#brain-error").textContent = "Invalid JSON: " + e.message;
        }
      };
      reader.readAsText(file);
    });
    $("#diff-cancel").addEventListener("click", hideDiff);
    $("#diff-apply").addEventListener("click", () => {
      if (!pendingImport) return;
      $("#brain-json").value = JSON.stringify(pendingImport.next, null, 2);
      hideDiff();
      applyBrainJson();
    });
    $("#diff-intents").addEventListener("click", () => {
      if (!pendingImport) return;
      const next = Cortex.applyIntentsOnly(baseBrain || rawBrain, pendingImport.next);
      $("#brain-json").value = JSON.stringify(next, null, 2);
      hideDiff();
      applyBrainJson();
    });

    wireVoice();
    registerSW();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
