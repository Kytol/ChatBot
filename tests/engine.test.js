"use strict";

const fs = require("fs");
const path = require("path");
const Cortex = require("../js/engine.js");

const brain = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/brain.json"), "utf8"));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok  ", msg);
  }
}

function session() {
  const s = Cortex.createSession(brain);
  s.resetMemory();
  return s;
}

const s = session();

let r = s.reply("hi");
assert(r.intent === "greet", "greet on hi, got " + r.intent);
assert(r.traces.length === 10, "ten phase traces, got " + r.traces.length);
assert(/Cortex|JSON/.test(r.text), "greeting mentions local identity");

r = s.reply("cat");
assert(r.intent === "show_media", "cat shows media, got " + r.intent);
assert(/sprite/.test(r.html) && /aria-label="cat"/.test(r.html), "cat svg present");

r = s.reply("both");
assert(r.intent === "show_media", "both is media");
assert(/aria-label="cat"/.test(r.html) && /aria-label="dog"/.test(r.html), "both sprites");

r = s.reply("kissa");
assert(r.lang === "fi", "finnish detection for kissa, got " + r.lang);
assert(/kissa|paikallisesti/.test(r.text), "finnish cat reply");

r = s.reply("tell me about dogs");
assert(r.intent === "animal_fact", "dog facts, got " + r.intent);
assert(/Canis|scent|dog/i.test(r.text), "dog knowledge graph text");

r = s.reply("is a cat a mammal");
assert(r.intent === "yes_no", "yes/no graph, got " + r.intent);
assert(/^Yes/i.test(r.text), "cat is mammal: " + r.text);

r = s.reply("what is 12 * 7");
assert(r.intent === "math", "math intent, got " + r.intent);
assert(/84/.test(r.text), "12*7=84 got " + r.text);

r = s.reply("my name is Aino");
assert(r.intent === "remember_name", "remember name, got " + r.intent);
r = s.reply("what is my name");
assert(/Aino/.test(r.text), "recall name: " + r.text);

r = s.reply("I like dogs");
assert(r.intent === "remember_pref", "remember pref, got " + r.intent);
r = s.reply("do you remember me");
assert(/dog/i.test(r.text), "recall favorite: " + r.text);

r = s.reply("when I say ping reply pong");
assert(r.intent === "teach", "teach intent, got " + r.intent);
r = s.reply("ping");
assert(r.text.trim() === "pong", "learned ping->pong, got " + r.text);

r = s.reply("how do you work");
assert(r.intent === "how_works", "how_works, got " + r.intent);
assert(/Ten phases|no backend/i.test(r.text), "explains local pipeline");

r = s.reply("cat vs dog");
assert(r.intent === "compare", "compare, got " + r.intent);

const s2 = session();
r = s2.reply("show me a picture");
assert(s2.getState().awaiting === "animal", "clarifies missing animal slot");
r = s2.reply("koira");
assert(r.intent === "show_media", "slot fill from finnish dog, got " + r.intent);
assert(/aria-label="dog"/.test(r.html), "dog sprite after clarify");

assert(Cortex.cosine(Cortex.charNgrams("cat picture", 3), Cortex.charNgrams("cat pic", 3)) > 0.3, "n-gram cosine works");
assert(Cortex.applyMath({ left: "2", op: "+", right: "3" }).pretty === "5", "math helper");

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall checks passed");
