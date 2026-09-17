(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let session = null;
  let rawBrain = null;

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    });
    (kids || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
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

  function renderChips(list) {
    const chips = $("#chips");
    chips.innerHTML = "";
    (list || []).forEach((label) => {
      chips.appendChild(
        el("button", {
          class: "chip",
          type: "button",
          onclick: () => {
            $("#input").value = label;
            send();
          }
        }, [label])
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

  function renderMemory(mem) {
    $("#mem-view").innerHTML = "";
    const store = session.getStore();
    const dl = el("dl", {});
    const rows = [
      ["Name", store.userName || "—"],
      ["Favorite", store.favoriteAnimal || "—"],
      ["Language lock", store.lang || "auto"],
      ["Taught rules", String((store.learned || []).length)],
      ["Notes", String((store.facts || []).length)]
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

  function showTab(id) {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    $$(".panel-body[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== id));
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

  function send() {
    const input = $("#input");
    const text = input.value.trim();
    if (!text || !session) return;
    addMessage("user", text);
    input.value = "";
    const result = session.reply(text);
    addMessage("bot", result.text, result);
    animatePhases(result.traces);
    renderTrace(result.traces);
    renderMemory(result.memory);
    renderChips(result.suggestions);
    if (result.openTab) showTab(result.openTab);
  }

  function applyBrainJson() {
    const err = $("#brain-error");
    err.textContent = "";
    try {
      rawBrain = JSON.parse($("#brain-json").value);
      session = Cortex.createSession(rawBrain);
      renderPhases(rawBrain.roadmap, []);
      renderRoadmap(rawBrain.roadmap);
      renderChips(rawBrain.suggestions.en);
      addMessage("bot", "Brain JSON recompiled locally. No server involved.");
    } catch (e) {
      err.textContent = "Invalid JSON: " + e.message;
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
      rawBrain = await res.json();
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

    session = Cortex.createSession(rawBrain);
    $("#brain-json").value = JSON.stringify(rawBrain, null, 2);
    renderPhases(rawBrain.roadmap, []);
    renderRoadmap(rawBrain.roadmap);
    renderChips(rawBrain.suggestions.en);
    renderMemory(session.getStore());

    const name = session.getStore().userName;
    addMessage(
      "bot",
      name
        ? `Welcome back, ${name}. I'm still Cortex, still on-device. Say cat, dog, or both — or ask how the ten phases work.`
        : "I'm Cortex. My intelligence is a JSON file plus a ten-phase engine in this browser — no cloud inference. Try “cat”, “kerro koirista”, “what is 12*7”, or “how do you work?”."
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
      renderMemory(session.getStore());
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
        $("#brain-json").value = String(reader.result);
        applyBrainJson();
      };
      reader.readAsText(file);
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
