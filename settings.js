// Small switches that survive restarts: AI on/off per chat, Divine protection on/off.
const config = require('../config');
const { createStore } = require('./utils/jsonStore');

const store = createStore('settings', { aiOff: {}, protectEnabled: null });

const isAiOn = (chatId) => !store.data.aiOff[chatId];
function setAi(chatId, on) {
  if (on) delete store.data.aiOff[chatId]; else store.data.aiOff[chatId] = true;
  store.save();
}
const isProtectOn = () => (store.data.protectEnabled === null ? config.protectedContact.enabled : store.data.protectEnabled);
function setProtect(on) { store.data.protectEnabled = Boolean(on); store.save(); }

module.exports = { isAiOn, setAi, isProtectOn, setProtect, init: async () => { await store.load(); store.data.aiOff = store.data.aiOff || {}; if (store.data.protectEnabled === undefined) store.data.protectEnabled = null; } };
