// Switches and small facts that survive restarts:
// AI on/off per chat, Divine protection, claimed owner ids, sub owners, prefix, AFK list.
const config = require('./config');
const { createStore } = require('./jsonStore');

const store = createStore('settings', { aiOff: {}, protectEnabled: null, claimed: [], subOwners: [], protectAlias: [], prefix: null, afk: {} });

function d() {
  const s = store.data;
  s.aiOff = s.aiOff || {};
  s.claimed = s.claimed || [];
  s.subOwners = s.subOwners || [];
  s.protectAlias = s.protectAlias || [];
  s.afk = s.afk || {};
  if (s.protectEnabled === undefined) s.protectEnabled = null;
  if (s.prefix === undefined) s.prefix = null;
  return s;
}
const uniq = (a) => [...new Set(a)];

// --- AI on/off per chat
const isAiOn = (chatId) => !d().aiOff[chatId];
function setAi(chatId, on) { if (on) delete d().aiOff[chatId]; else d().aiOff[chatId] = true; store.save(); }

// --- Divine protection switch
const isProtectOn = () => (d().protectEnabled === null ? config.protectedContact.enabled : d().protectEnabled);
function setProtect(on) { d().protectEnabled = Boolean(on); store.save(); }

// --- Command prefix
const prefix = () => d().prefix || config.prefix;
function setPrefix(p) { d().prefix = p && p !== config.prefix ? p : null; store.save(); }

// --- Owner / protected identities (phone numbers AND hidden LIDs, digits only)
const claimed = () => d().claimed.slice();
const isMainOwner = (num) => config.owner.ids.includes(num) || d().claimed.includes(num);
const isSubOwner = (num) => d().subOwners.includes(num);
const isOwner = (num) => isMainOwner(num) || isSubOwner(num);
function addClaimed(nums) {
  const before = d().claimed.length;
  d().claimed = uniq([...d().claimed, ...nums.filter(Boolean)]);
  if (d().claimed.length !== before) store.save();
  return d().claimed.length !== before;
}
function addSubOwners(nums) {
  const before = d().subOwners.length;
  d().subOwners = uniq([...d().subOwners, ...nums.filter(Boolean)]);
  if (d().subOwners.length !== before) store.save();
  return d().subOwners.length !== before;
}
function clearClaimed() { d().claimed = []; d().protectAlias = []; store.save(); }
function addProtectAlias(nums) {
  const before = d().protectAlias.length;
  d().protectAlias = uniq([...d().protectAlias, ...nums.filter(Boolean)]);
  if (d().protectAlias.length !== before) store.save();
}
const protectedIds = () => uniq([...config.protectedContact.ids, ...d().claimed, ...d().protectAlias]);

// --- AFK
const getAfk = (num) => d().afk[num] || null;
function setAfk(num, info) { d().afk[num] = info; store.save(); }
function clearAfk(num) { delete d().afk[num]; store.save(); }

module.exports = {
  isAiOn, setAi, isProtectOn, setProtect, prefix, setPrefix,
  claimed, isOwner, isMainOwner, isSubOwner, addClaimed, addSubOwners,
  clearClaimed, addProtectAlias, protectedIds,
  getAfk, setAfk, clearAfk,
  init: async () => { await store.load(); d(); },
};
