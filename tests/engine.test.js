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

function check(input, intent, re, msg) {
  const sess = session();
  const out = sess.reply(input);
  assert(out.intent === intent, (msg || input) + " intent " + out.intent + " want " + intent);
  if (re) assert(re.test(out.text + (out.html || "")), (msg || input) + " text: " + out.text);
}

check("how are you", "howdy", /on-device|phases|laitteella|vaihetta/i);
check("good morning", "daypart", /morning|huomenta/i);
check("are you chatgpt", "origin", /not chatgpt/i);
check("are you there", "origin", /here|täällä/i);
check("what is the weather", "weather", /weather|offline|sää/i);
check("show me a horse", "show_media", /only draw|vain/i);
check("cta", "show_media", /aria-label="cat"/);
check("dgo", "show_media", /aria-label="dog"/);
check("call me Sam", "remember_name", /Sam/);
check("i am sad", "emotion", /sad|ikävää/i);
check("what is two plus two", "math", /\b4\b/);
check("12 times 7", "math", /84/);
check("2 + 2 + 2", "math", /\b6\b/);
check("10% of 50", "math", /\b5\b/);
check("square root of 9", "math", /\b3\b/);
check("divide 10 by 0", "math", /zero/i);
check("calculate fifteen minus 3", "math", /\b12\b/);
check("do you like cats", "bot_opinion", /both/i);
check("how many legs does a dog have", "attr_qa", /dog/i);
check("what is a mammal", "animal_fact", /milk|warm/i);
check("what is json", "animal_fact", /notation|JSON/i);
check("tell me about foxes", "animal_fact", /fox|vulpes/i);
check("see ya", "farewell", /see you|bye|offline|nähdään|memory/i);
check("count to 5", "transform", /1, 2, 3, 4, 5/);
check("reverse hello", "transform", /^olleh$/);
check("spell cortex", "transform", /C-O-R-T-E-X/);
check("convert 10 km to miles", "convert", /10 km to miles/);
check("100 f to c", "convert", /37/);
check("", "empty", /type something|kirjoita/i);

{
  const sess = session();
  let out = sess.reply("quiz me");
  assert(out.intent === "quiz", "quiz start intent " + out.intent);
  assert(/Q1\/\d+/.test(out.text), "quiz asks Q1: " + out.text);
  out = sess.reply("stop quiz");
  assert(/Quiz over|Quiz cancelled/i.test(out.text), "stop quiz: " + out.text);
}

{
  const sess = session();
  let out = sess.reply("quiz me about json");
  assert(out.intent === "quiz", "json quiz intent " + out.intent);
  assert(/JSON|notation/i.test(out.text), "json quiz prompt: " + out.text);
  out = sess.reply("javascript object notation");
  assert(/Correct|Quiz over/i.test(out.text), "json quiz grade: " + out.text);
}

{
  const sess = session();
  sess.reply("cat");
  const out = sess.reply("repeat that");
  assert(out.intent === "repeat", "repeat intent " + out.intent);
  assert(/cat|kissa|toes|purr|clowder/i.test(out.text), "repeat last: " + out.text);
}

{
  const sess = session();
  sess.reply("show me a picture");
  const out = sess.reply("no");
  assert(out.intent === "deny", "deny after clarify, got " + out.intent);
}

assert(Cortex.parseMath("two plus two").pretty === "4", "parseMath words");
assert(Cortex.parseMath("2+2+2").pretty === "6", "parseMath chain");

const s2 = session();
r = s2.reply("show me a picture");
assert(s2.getState().awaiting === "animal", "clarifies missing animal slot");
r = s2.reply("koira");
assert(r.intent === "show_media", "slot fill from finnish dog, got " + r.intent);
assert(/aria-label="dog"/.test(r.html), "dog sprite after clarify");

assert(Cortex.cosine(Cortex.charNgrams("cat picture", 3), Cortex.charNgrams("cat pic", 3)) > 0.3, "n-gram cosine works");
assert(Cortex.applyMath({ left: "2", op: "+", right: "3" }).pretty === "5", "math helper");

{
  const cooking = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/packs/cooking.json"), "utf8"));
  const merged = Cortex.mergeBrains(brain, cooking);
  const d = Cortex.diffBrains(brain, merged);
  assert(d.addedIntents.indexOf("boil_eggs") >= 0, "diff lists boil_eggs intent: " + d.summary);
  assert(d.addedNodes.indexOf("egg") >= 0, "diff lists egg node: " + d.summary);

  let out = session().reply("how do I boil eggs?");
  assert(out.intent === "fallback", "without pack, boil eggs falls back, got " + out.intent);

  const packed = Cortex.createSession(brain);
  packed.resetMemory();
  packed.mergePack(cooking);
  out = packed.reply("how do I boil eggs?");
  assert(out.intent === "boil_eggs", "with cooking pack, boil eggs intent got " + out.intent);
  assert(/simmer|Hard|minutes/i.test(out.text), "boil eggs copy from pack: " + out.text);
}

{
  const compiled = Cortex.compileBrain(brain);
  const perceived = Cortex.perceive("nocturnal bushy tail", compiled);
  const hits = Cortex.semanticSearch(perceived, compiled, "en");
  const fox = hits.find((h) => h.id === "fox");
  assert(fox, "nocturnal bushy tail retrieves a fox doc: " + (hits[0] && hits[0].id));
  assert(hits[0].id === "fox", "top hit is fox, got " + hits[0].id + " " + hits[0].kind);
}

{
  const sess = session();
  sess.reply("cat");
  sess.reply("what is 12 * 7");
  sess.reply("quiz me");
  sess.reply("stop quiz");
  const out = sess.reply("summarize our chat");
  assert(out.intent === "recap", "recap intent got " + out.intent);
  assert(/cat/i.test(out.text), "recap mentions cat: " + out.text);
  assert(/12|84/.test(out.text), "recap mentions math: " + out.text);
  assert(/quiz/i.test(out.text), "recap mentions quiz: " + out.text);
}

{
  const sess = session();
  let out = sess.reply("add a pet");
  assert(out.intent === "add_pet", "add_pet start got " + out.intent);
  assert(/species/i.test(out.text), "asks species: " + out.text);
  out = sess.reply("cat");
  assert(/old|age|years/i.test(out.text), "asks age: " + out.text);
  out = sess.reply("3");
  assert(/name/i.test(out.text), "asks name: " + out.text);
  out = sess.reply("Miso");
  assert(/Saved Miso, cat, 3/i.test(out.text), "saved profile: " + out.text);
}

{
  const out = session().reply("is a cat a mammal");
  assert(out.graphFocus && out.graphFocus.edge && out.graphFocus.edge.from === "cat", "graphFocus cat→mammal");
}

{
  const out = session().reply("zzzz not a real utterance 12345");
  assert(out.intent === "fallback", "nonsense is fallback, got " + out.intent);
  assert((out.suggestions || []).indexOf("Save as test") >= 0, "fallback offers Save as test");
}

{
  const sess = session();
  let out = sess.reply("zzzz not a real utterance 12345");
  assert(out.intent === "fallback", "loop seed fallback");
  out = sess.reply("meant:animal_fact");
  assert(out.intent === "learn_status", "label uses learn_status, got " + out.intent);
  assert(sess.getLoop().corrections >= 1, "correction counted");
  out = sess.reply("zzzz not a real utterance 12345");
  assert(out.intent === "animal_fact", "labeled phrase now animal_fact, got " + out.intent);
  assert(/local example matched|Paikallinen esimerkki/i.test(out.text), "labeled reply acknowledges local example: " + out.text);
}

{
  const sess = session();
  sess.reply("cat");
  const before = sess.getLoop().lr.example;
  const out = sess.reply("thanks");
  assert(out.intent === "thanks", "thanks intent");
  assert(sess.getLoop().rewardsPos >= 1, "thanks rewards previous turn");
  assert(sess.getLoop().lr.example >= before, "example LR did not shrink after success");
}

{
  const sess = session();
  sess.reply("tell me about foxes");
  sess.reply("thanks");
  const report = sess.rehearse(12);
  assert(report.ran >= 1, "rehearse ran drills: " + report.ran);
  assert(sess.getLoop().rehearsals >= 1, "rehearsal counter");
  const snap = sess.getLoop();
  assert(snap.mut && Object.keys(snap.mut).some((k) => snap.mut[k].try > 0), "mutation policy recorded tries");
  assert(["synonym", "drop", "transpose", "repeat"].indexOf(snap.preferredMut) >= 0, "preferredMut " + snap.preferredMut);
  assert(snap.batch >= 1 && snap.batch <= 4, "adaptive batch " + snap.batch);
  assert((report.reports || []).some((r) => r.mode), "each drill names a mutation mode");
}

check("how are you learning", "learn_status", /local learning loop|rehearsal accuracy/i);
check("that's wrong", "critique", /downweight|meant/i);

{
  const out = session().reply("zzzz not a real utterance 12345");
  const meant = (out.suggestions || []).filter((s) => String(s).indexOf("meant:") === 0);
  assert(meant.length >= 1, "fallback still offers meant chips");
  meant.forEach((s) => {
    assert(
      !/^meant:(critique|learn_status|thanks|yes_no|fallback|empty|howdy|origin)$/.test(s),
      "meant chip should be a content intent, got " + s
    );
  });
}

{
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/failures.json"), "utf8"));
  fixtures.forEach((row, i) => {
    if (!row || !row.want) return;
    const out = session().reply(row.input);
    assert(out.intent === row.want, "failures.json[" + i + "] " + row.input + " got " + out.intent + " want " + row.want);
  });
}

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall checks passed");
