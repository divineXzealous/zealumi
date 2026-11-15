// Small saved data for the extras: affinity (how much Lumi tolerates each person) and game wins.
const { createStore } = require('./jsonStore');

const store = createStore('extras', { affinity: {}, wins: {} });
function d() {
  const s = store.data;
  s.affinity = s.affinity || {};
  s.wins = s.wins || {};
  return s;
}

// --- Affinity -----------------------------------------------------------------
const LEVELS = [[0, 'stranger'], [10, 'tolerated'], [40, 'familiar'], [100, 'trusted'], [200, 'favorite']];

function levelFor(pts) {
  let cur = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (pts >= LEVELS[i][0]) { cur = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  return { level: cur[1], next: next ? { level: next[1], need: next[0] - pts } : null };
}

const lastGain = new Map(); // number -> time of last point (max one point per 30 s per person)

function getAffinity(num) {
  const pts = d().affinity[num] || 0;
  return { pts, ...levelFor(pts) };
}

function gainAffinity(num, n = 1) {
  if (!num) return 0;
  const now = Date.now();
  if (now - (lastGain.get(num) || 0) < 30000) return getAffinity(num).pts;
  lastGain.set(num, now);
  d().affinity[num] = Math.min(1000, (d().affinity[num] || 0) + n);
  store.save();
  return d().affinity[num];
}

function resetAffinity(nums) {
  let count = 0;
  for (const n of nums) {
    lastGain.delete(n);
    if (d().affinity[n] !== undefined) { delete d().affinity[n]; count++; }
  }
  if (count) store.save();
  return count;
}

function resetAllAffinity() {
  const count = Object.keys(d().affinity).length;
  d().affinity = {};
  lastGain.clear();
  store.save();
  return count;
}

// --- Game wins ----------------------------------------------------------------
function addWin(num, name) {
  if (!num) return;
  const w = d().wins[num] || (d().wins[num] = { n: 0, name: '' });
  w.n += 1;
  if (name) w.name = name;
  store.save();
}

const topWins = (k = 10) =>
  Object.entries(d().wins).map(([num, w]) => ({ num, name: w.name, n: w.n })).sort((a, b) => b.n - a.n).slice(0, k);

module.exports = { getAffinity, gainAffinity, resetAffinity, resetAllAffinity, addWin, topWins, init: () => store.load() };
