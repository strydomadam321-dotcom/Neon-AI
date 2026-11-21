// The Riddle Gate: 300 riddles in a row stand between a visitor and the sign-up form.
// Riddles are made on the server (the browser never sees an answer): about 80 classic hand-written ones mixed with generated
// maths, sequences, word puzzles, odd-one-outs, binary, Roman numerals and more. One gate = one seed = one fixed 300-riddle run.
export const TOTAL = 300;

const HAND = [
  ["I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", ["echo"]],
  ["What has keys but can't open locks?", ["piano", "keyboard", "a piano", "computer keyboard"]],
  ["What has hands but can't clap?", ["clock", "watch", "a clock"]],
  ["The more you take, the more you leave behind. What am I?", ["footsteps", "steps", "footstep"]],
  ["What can travel around the world while staying in a corner?", ["stamp", "postage stamp"]],
  ["What has a head and a tail but no body?", ["coin"]],
  ["What gets wetter the more it dries?", ["towel"]],
  ["What has many teeth but can't bite?", ["comb"]],
  ["I'm tall when I'm young and short when I'm old. What am I?", ["candle"]],
  ["What goes up but never comes down?", ["age", "your age"]],
  ["What has one eye but can't see?", ["needle"]],
  ["What can you catch but not throw?", ["cold", "a cold"]],
  ["What has words but never speaks?", ["book"]],
  ["What runs but never walks, and has a mouth but never talks?", ["river"]],
  ["What has a neck but no head?", ["bottle"]],
  ["What belongs to you but is used more by other people than by you?", ["name", "your name"]],
  ["What comes once in a minute, twice in a moment, but never in a thousand years?", ["m", "letter m", "the letter m"]],
  ["What is full of holes but still holds water?", ["sponge"]],
  ["What can fill a room but takes up no space?", ["light"]],
  ["What has a thumb and four fingers but is not alive?", ["glove"]],
  ["What building has the most stories?", ["library"]],
  ["What begins with T, ends with T, and has T in it?", ["teapot"]],
  ["What is always in front of you but can't be seen?", ["future", "the future"]],
  ["What has four legs in the morning, two at noon and three in the evening?", ["human", "man", "person", "a human", "a man", "humans"]],
  ["I'm light as a feather, yet the strongest person can't hold me for more than a few minutes. What am I?", ["breath", "your breath"]],
  ["What word becomes shorter when you add two letters to it?", ["short"]],
  ["What can you keep after giving it to someone?", ["word", "your word", "promise", "a promise"]],
  ["What is so fragile that saying its name breaks it?", ["silence"]],
  ["The person who makes it doesn't need it. The person who buys it doesn't use it. What is it?", ["coffin", "casket"]],
  ["What has legs but doesn't walk?", ["table", "chair", "bed", "desk"]],
  ["What has a ring but no finger?", ["telephone", "phone", "a phone"]],
  ["Forward I am heavy, backward I am not. What am I?", ["ton"]],
  ["What has 13 hearts but no other organs?", ["deck of cards", "cards", "playing cards", "a deck of cards"]],
  ["What is black and white and read all over?", ["newspaper", "a newspaper"]],
  ["I shave every day, but my beard stays the same. Who am I?", ["barber", "a barber"]],
  ["What gets bigger when more is taken away?", ["hole", "a hole"]],
  ["If you have me, you want to share me. If you share me, you no longer have me. What am I?", ["secret", "a secret"]],
  ["What has a bottom at the top?", ["legs", "leg", "your legs"]],
  ["I fly without wings and cry without eyes. What am I?", ["cloud", "a cloud", "clouds"]],
  ["What do you throw out when you want to use it, and take in when you don't want to use it?", ["anchor", "an anchor"]],
  ["What goes up when the rain comes down?", ["umbrella", "an umbrella"]],
  ["What kind of room has no doors or windows?", ["mushroom", "a mushroom"]],
  ["What type of cheese is made backward?", ["edam"]],
  ["What has cities but no houses, mountains but no trees, and water but no fish?", ["map", "a map"]],
  ["What starts with E, ends with E, but only contains one letter?", ["envelope", "an envelope"]],
  ["I am not alive, but I grow. I don't have lungs, but I need air. Water kills me. What am I?", ["fire"]],
  ["What can you hold in your left hand but never in your right?", ["right hand", "your right hand", "your right elbow", "right elbow"]],
  ["What flies around all day but never goes anywhere?", ["flag", "a flag"]],
  ["What comes down but never goes up?", ["rain"]],
  ["Mary's father has five daughters: Nana, Nene, Nini and Nono. What is the fifth daughter's name?", ["mary"]],
  ["A farmer has 17 sheep and all but 9 run away. How many sheep are left?", ["9", "nine"]],
  ["How many months of the year have 28 days?", ["12", "twelve", "all", "all of them", "every month", "all twelve"]],
  ["Which weighs more: a kilogram of feathers or a kilogram of steel?", ["neither", "same", "the same", "they weigh the same", "they are the same", "equal", "they weigh the same amount"]],
  ["A plane crashes on the border of two countries. Where do they bury the survivors?", ["nowhere", "you dont bury survivors", "they dont", "you dont", "survivors arent buried", "no where"]],
  ["How many times can you subtract 10 from 100?", ["once", "1", "one", "one time", "1 time"]],
  ["Which word in the dictionary is always spelled wrong?", ["wrong", "the word wrong"]],
  ["I have branches, but no fruit, trunk or leaves. What am I?", ["bank", "a bank"]],
  ["What can be broken but never held?", ["promise", "a promise"]],
  ["What has to be broken before you can use it?", ["egg", "an egg"]],
  ["What gets sharper the more you use it?", ["brain", "mind", "your brain", "your mind", "the brain"]],
  ["What can you see in the dark that you can't see in the light?", ["stars", "the stars", "star"]],
  ["What word contains 26 letters but has only three syllables?", ["alphabet", "the alphabet"]],
  ["What starts with P, ends with E, and has thousands of letters?", ["post office", "the post office", "postoffice"]],
  ["What is the longest word in the dictionary?", ["smiles"]],
  ["What goes up and down but doesn't move?", ["stairs", "staircase", "stair", "the stairs"]],
  ["I am taken from a mine and shut up in a wooden case, never released, yet used by almost everyone. What am I?", ["pencil lead", "pencil", "lead", "graphite", "a pencil"]],
  ["The more of me there is, the less you see. What am I?", ["darkness", "dark", "fog", "the dark"]],
  ["What has a heart that doesn't beat?", ["artichoke", "an artichoke"]],
  ["What is at the end of a rainbow?", ["w", "the letter w", "letter w"]],
  ["What has an eye, but cannot see, and is the centre of a storm?", ["hurricane", "a hurricane", "cyclone", "typhoon"]],
  ["What can run but never walks, has a bed but never sleeps, and a mouth but never eats?", ["river"]],
  ["What can you put in a barrel to make it lighter?", ["hole", "a hole"]],
  ["What invention lets you see right through a wall?", ["window", "a window"]],
  ["What is made of water but dies when you put it in water?", ["ice cube", "ice", "an ice cube", "a ice cube"]],
  ["What has a spine but no bones?", ["book", "a book"]],
  ["What kind of band never plays music?", ["rubber band", "a rubber band", "rubber"]],
  ["What has a bark but no bite, and roots but no soil?", ["tree", "a tree"]],
  ["What is lighter than a feather but even the strongest man cannot hold it for long?", ["breath", "your breath"]],
  ["What do you call a fish with no eyes?", ["fsh", "a fsh"]],
  ["What can you add to a bucket of water to make it weigh less?", ["hole", "a hole"]],
];

// ---------- helpers ----------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = (seed, i, salt) => mulberry((seed ^ Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0);
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const shuffle = (r, a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(a|an|the) /, "");

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(n) {                                   // 0..9999 in English, so "forty two" counts as 42
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + words(n % 100) : "");
  return words(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + (n % 1000 < 100 ? "and " : "") + words(n % 1000) : "");
}
const num = (n) => { const w = n >= 0 && n < 10000 ? words(n) : null; return w ? [String(n), w, w.replace(/ and /g, " "), w.replace(/-/g, " ")] : [String(n)]; };

const WORDS = ["neon", "laser", "pixel", "circuit", "binary", "monitor", "keyboard", "network", "galaxy", "planet", "rocket", "comet", "meteor", "orbit", "cosmos", "thunder", "lantern", "harbor", "canyon", "meadow", "glacier", "volcano", "island", "jungle", "desert", "forest", "river", "mountain", "castle", "bridge", "garden", "window", "pillow", "blanket", "candle", "mirror", "ladder", "bucket", "basket", "button", "pocket", "pencil", "marker", "eraser", "folder", "ticket", "wallet", "guitar", "violin", "trumpet", "drumbeat", "melody", "rhythm", "chorus", "dancer", "singer", "painter", "writer", "farmer", "pilot", "doctor", "teacher", "wizard", "knight", "dragon", "pirate", "robot", "ghost", "tiger", "zebra", "koala", "panda", "otter", "falcon", "parrot", "turtle", "salmon", "lizard", "spider", "beetle", "orange", "banana", "cherry", "mango", "lemon", "peach", "grape", "melon", "carrot", "potato", "tomato", "pepper", "butter", "cheese", "cookie", "waffle", "noodle", "pickle", "sunset", "sunrise", "rainbow", "blizzard", "breeze", "puddle", "shadow", "silver", "golden", "purple", "yellow", "winter", "summer", "autumn", "morning", "evening", "midnight", "journey", "mystery", "puzzle", "riddle", "secret", "treasure", "compass", "anchor", "voyage", "captain", "sailor"];
// scramble words must have exactly one valid anagram in the list, so any answer can be checked fairly
const sortLetters = (w) => w.split("").sort().join("");
const GROUPS = new Map(); for (const w of WORDS) GROUPS.set(sortLetters(w), (GROUPS.get(sortLetters(w)) || 0) + 1);
const SCRAMBLE = WORDS.filter((w) => GROUPS.get(sortLetters(w)) === 1 && w.length >= 5);

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CATS = {
  fruits: ["apple", "banana", "cherry", "grape", "mango", "peach", "lemon", "melon", "plum", "pear"],
  animals: ["tiger", "zebra", "koala", "panda", "otter", "falcon", "turtle", "salmon", "lizard", "rabbit"],
  colours: ["red", "blue", "green", "yellow", "purple", "orange", "pink", "silver", "gold", "brown"],
  planets: ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"],
  instruments: ["guitar", "violin", "trumpet", "piano", "flute", "drums", "cello", "harp", "banjo", "oboe"],
  tools: ["hammer", "wrench", "screwdriver", "saw", "drill", "chisel", "pliers", "shovel", "spanner", "axe"],
  vehicles: ["car", "bus", "train", "bicycle", "tram", "truck", "scooter", "ferry", "van", "taxi"],
  countries: ["australia", "brazil", "canada", "denmark", "egypt", "france", "germany", "india", "japan", "kenya"],
};
const ROMAN = [[40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
const toRoman = (n) => { let s = ""; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

// ---------- generated riddles: each returns { kind, text, answers[] , anagram? } ----------
const GEN = [
  (r) => { const a = int(r, 12, 99), b = int(r, 12, 99); return { kind: "Maths", text: `What is ${a} + ${b}?`, answers: num(a + b) }; },
  (r) => { const a = int(r, 6, 19), b = int(r, 3, 12); return { kind: "Maths", text: `What is ${a} × ${b}?`, answers: num(a * b) }; },
  (r) => { const a = int(r, 60, 150), b = int(r, 11, 59); return { kind: "Maths", text: `What is ${a} − ${b}?`, answers: num(a - b) }; },
  (r) => { const a = int(r, 2, 9), b = int(r, 2, 9), c = int(r, 2, 6); return { kind: "Maths", text: `What is (${a} + ${b}) × ${c}?`, answers: num((a + b) * c) }; },
  (r) => { const n = int(r, 3, 9), m = int(r, 6, 12), k = int(r, 2, n * m - 3); return { kind: "Bakery", text: `A baker bakes ${n} trays with ${m} buns on each tray, then sells ${k} buns. How many buns are left?`, answers: num(n * m - k) }; },
  (r) => { const s = pick(r, [2, 3, 4, 5, 6, 10, 12, 15, 20, 30]), m = int(r, 2, 10); return { kind: "Blink", text: `A neon sign blinks once every ${s} seconds. How many blinks happen in ${m} minute${m > 1 ? "s" : ""}?`, answers: num((m * 60) / s) }; },
  (r) => { const x = int(r, 2, 9), y = int(r, 2, 9), z = int(r, 1, 6); return { kind: "Zoo", text: `How many legs are there in total on ${x} spiders, ${y} cats and ${z} birds?`, answers: num(x * 8 + y * 4 + z * 2) }; },
  (r) => { const a = int(r, 2, 40), d = int(r, 2, 9), s = [0, 1, 2, 3, 4].map((k) => a + d * k); return { kind: "Sequence", text: `What comes next? ${s.join(", ")}, ?`, answers: num(a + d * 5) }; },
  (r) => { const a = int(r, 1, 6), m = pick(r, [2, 3]), s = [0, 1, 2, 3].map((k) => a * m ** k); return { kind: "Sequence", text: `What comes next? ${s.join(", ")}, ?`, answers: num(a * m ** 4) }; },
  (r) => { const k = int(r, 1, 8), s = [0, 1, 2, 3, 4].map((j) => (k + j) ** 2); return { kind: "Sequence", text: `What comes next? ${s.join(", ")}, ?`, answers: num((k + 5) ** 2) }; },
  (r) => { const a = int(r, 1, 5), b = int(r, 2, 6), s = [a, b]; for (let k = 2; k < 6; k++) s.push(s[k - 1] + s[k - 2]); return { kind: "Sequence", text: `Each number is the sum of the two before it. What comes next? ${s.join(", ")}, ?`, answers: num(s[4] + s[5]) }; },
  (r) => { const w = pick(r, SCRAMBLE).toUpperCase(), l = shuffle(r, w.split("")); const t = l.join("") === w ? l.reverse().join("") : l.join(""); return { kind: "Scramble", text: `Unscramble these letters to make a word: ${t}`, answers: [w.toLowerCase()], anagram: sortLetters(w.toLowerCase()) }; },
  (r) => { const w = pick(r, WORDS); return { kind: "Backwards", text: `Spell the word "${w}" backwards.`, answers: [w.split("").reverse().join("")] }; },
  (r) => { const w = pick(r, WORDS); return { kind: "Letters", text: `How many letters are in the word "${w}"?`, answers: num(w.length) }; },
  (r) => { const w = pick(r, WORDS), n = int(r, 1, Math.min(5, w.length)); return { kind: "Letters", text: `What is the ${ord(n)} letter of the word "${w}"?`, answers: [w[n - 1], `letter ${w[n - 1]}`] }; },
  (r) => { const w = pick(r, WORDS); return { kind: "Vowels", text: `How many vowels (a, e, i, o, u) are in the word "${w}"?`, answers: num((w.match(/[aeiou]/g) || []).length) }; },
  (r) => { const d = int(r, 0, 6), n = int(r, 8, 40), f = r() < 0.7; return { kind: "Calendar", text: f ? `If today is ${DAYS[d]}, what day will it be in ${n} days?` : `If today is ${DAYS[d]}, what day was it ${n} days ago?`, answers: [DAYS[(((f ? d + n : d - n) % 7) + 7) % 7].toLowerCase()] }; },
  (r) => { const n = int(r, 5, 62); if (r() < 0.5) return { kind: "Binary", text: `What is the binary number ${n.toString(2)} in ordinary decimal?`, answers: num(n) }; return { kind: "Binary", text: `Write the number ${n} in binary (just the 0s and 1s).`, answers: [n.toString(2)] }; },
  (r) => { const n = int(r, 4, 49); return { kind: "Roman", text: `Which number is the Roman numeral ${toRoman(n)}?`, answers: num(n) }; },
  (r) => { const up = r() < 0.5, k = int(r, 2, 6), base = int(r, 6, 19), L = "abcdefghijklmnopqrstuvwxyz"; const from = up ? base : base + k, ans = L[up ? base + k : base]; return { kind: "Alphabet", text: `Which letter comes ${k} place${k > 1 ? "s" : ""} ${up ? "after" : "before"} the letter ${L[from].toUpperCase()} in the alphabet?`, answers: [ans, `letter ${ans}`] }; },
  (r) => { const keys = Object.keys(CATS), a = pick(r, keys), b = pick(r, keys.filter((k) => k !== a)), odd = pick(r, CATS[b]), rest = shuffle(r, CATS[a]).slice(0, 3); const list = shuffle(r, [...rest, odd]); return { kind: "Odd one out", text: `Which one does not belong? ${list.join(", ")}`, answers: [odd] }; },
  (r) => { const a = int(r, 100, 999), b = int(r, 100, 999); return { kind: "Compare", text: `Which number is bigger: ${a} or ${b}?`, answers: num(Math.max(a, b)) }; },
  (r) => { const h = int(r, 1, 11), m = pick(r, [15, 30, 45]), add = pick(r, [20, 40, 50, 75, 90]); const t = h * 60 + m + add, hh = ((Math.floor(t / 60) - 1) % 12) + 1, mm = t % 60; const f = (x, y) => `${x}:${String(y).padStart(2, "0")}`; return { kind: "Clock", text: `It is ${f(h, m)} on a 12-hour clock. What time will it be in ${add} minutes? (write it like 4:05)`, answers: [f(hh, mm), f(hh, mm).replace(":", " ")] }; },
];

// which slots in the run are hand-written riddles, in which order (the same for the whole run)
function layout(seed) {
  const r = mulberry(seed ^ 0x9e3779b9), slots = shuffle(r, Array.from({ length: TOTAL }, (_, i) => i)).slice(0, HAND.length), order = shuffle(r, HAND.map((_, i) => i));
  const map = new Map(); slots.forEach((s, j) => map.set(s, order[j])); return map;
}
const layoutCache = new Map();
export function riddleAt(seed, i, salt = 0) {
  if (!layoutCache.has(seed)) { if (layoutCache.size > 200) layoutCache.clear(); layoutCache.set(seed, layout(seed)); }
  const h = salt === 0 ? layoutCache.get(seed).get(i) : undefined;
  if (h !== undefined) return { kind: "Classic", text: HAND[h][0], answers: HAND[h][1].map(norm) };
  const r = R(seed, i, salt), g = GEN[Math.floor(r() * GEN.length)](r);
  return { ...g, answers: g.answers.map(norm) };
}
// is this answer right? (spaces don't matter, articles are ignored, scrambles accept any listed anagram)
export function isRight(q, raw) {
  const a = norm(raw); if (!a) return false;
  if (q.answers.includes(a) || q.answers.some((x) => x.replace(/ /g, "") === a.replace(/ /g, ""))) return true;
  if (q.anagram) { const w = a.replace(/ /g, ""); return WORDS.includes(w) && sortLetters(w) === q.anagram; }
  return false;
}
export const publicRiddle = (q) => ({ kind: q.kind, text: q.text });
export const HAND_COUNT = HAND.length;
