# Lumi — WhatsApp chatbot (v1.1)

Node.js + Express + Baileys (unofficial WhatsApp Web library). AI: Groq -> DeepSeek -> Gemini fallback.
Baileys breaks Meta's terms: use a spare number, never your main one. Messages sent from the
linked account itself are ignored, so use a SEPARATE number for Lumi.

## Install note (panels that block git)
Some panels block npm from fetching git packages (error EALLOWGIT). `package.json` has an
`overrides` entry that swaps Baileys' git dependency for the npm-published copy, so plain
`npm install` works. Delete any old `node_modules` and `package-lock.json` before starting.

## Setup (Spaceify / Pterodactyl-style panel)
1. Files: upload the zip to /home/container and Unarchive (this keeps your `.env`, `auth`, `data`).
2. Startup tab: JS FILE = `server.js`.
3. Create `.env` (see `.env.example`). Minimum: GROQ_API_KEY and/or GEMINI_API_KEY, PAIRING_NUMBER,
   CLAIM_PASSPHRASE.
4. Console > Start. First start installs packages (a few minutes).
5. On Lumi's phone: WhatsApp > Linked Devices > Link a Device > Link with phone number, enter
   the `PAIRING CODE` printed in the console.

## Owner and Divine
Send `.claim <CLAIM_PASSPHRASE>` to Lumi in a PRIVATE chat. She stores your phone number and your
hidden WhatsApp id (LID), so tags in groups are recognised. `.unclaim` (owner) clears claims.
Once she has seen the owner in a group she also learns the hidden id automatically.

## Commands
General: menu help ping about status owner · AI: chatbot on/off (ai on/off works too), clear, protect on/off (owner)
Sticker: s take toimg · Media: play · Profile: getpp @user · Group (admins): add <number>, kick @user
Utility: afk [reason] · Owner: setprefix <symbol|reset>, setprofilepic (reply to an image)
Hidden: claim, unclaim

## Layout
All code files sit together in one folder (flat layout, Node 20+). `index.js` is the command registry;
commands live in `general.js ai.js sticker.js music.js profile.js group.js afk.js owner.js`.

## Personality
`PERSONALITY=maki` (default: blunt, nonchalant) or `PERSONALITY=calm` (the original).

## Optional extras (more disk needed)
Video stickers and animated .toimg need `wa-sticker-formatter` and `ffmpeg-static`
(in the panel's "Additional Node packages" box, or `npm install` them). Without them Lumi
still makes image stickers (no pack name/author) and says clearly what she can't do.
For Render-style hosts with no disk, also install `pg` and set DATABASE_URL.

## Tests
`npm test` runs offline tests (fallback chain, memory, Divine, claim, prefix, AFK, kick, menu).
Everything that needs real WhatsApp, API keys or media must be tested on your server.
