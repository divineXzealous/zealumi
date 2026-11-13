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

## Pairing problems
Watch the Console after pressing Start. Lumi now prints what she is doing:
- `Linking number 234******78 (13 digits)`: the number she read from PAIRING_NUMBER. If this is empty or wrong, fix `.env`.
- `PAIRING CODE: XXXX-XXXX`: type it in WhatsApp (Settings > Linked Devices > Link a Device > Link with phone number
  instead) on the phone that owns that number. Open that screen BEFORE you press Start. The code lasts about a minute.
- `Connection closed. Code 405`: WhatsApp refused the connection (old library, or a blocked server address).
- `Code 428` / `408`: the connection dropped; Lumi retries by herself.
- `Asked for 3 pairing codes already`: she stopped on purpose. Wait ~30 minutes, then press Start once. Many restarts in a
  row can make WhatsApp refuse new codes for a while.
Tips: number = digits only with country code (no +, no spaces, no leading 0); use a normal WhatsApp or WhatsApp Business
account; keep WhatsApp updated; if a login is stuck, stop Lumi, delete the `auth` folder, start once. Some hosting
addresses (data centres) are treated with suspicion by WhatsApp; if every attempt fails with the same code, that may be why.

## Owner and Divine
Send `.claim <CLAIM_PASSPHRASE>` to Lumi in a PRIVATE chat. She stores your phone number and your
hidden WhatsApp id (LID), so tags in groups are recognised. `.unclaim` (owner) clears claims.
Once she has seen the owner in a group she also learns the hidden id automatically.

## Commands
General: menu help ping about status owner · AI: chatbot on/off (ai on/off works too), clear, protect on/off (owner)
Sticker: s take toimg · Media: play · Profile: getpp @user · Group (admins): add <number>, kick @user
Utility: afk [reason] · Owner: addsubowner/delsubowner, setprefix <symbol|reset>, setprofilepic (reply to an image),
  d <time> (reply to a message: deletes it after e.g. 5s / 2m / 1h), sleep / wake (or "lumi sleep" / "lumi wake up")
Hidden: claim, unclaim

## Owners: no prefix needed
Owners and sub-owners can skip the prefix: `ping`, `menu`, `afk lunch`, `kick @user`, `add 2348012345678`,
`d 5s` (reply), `s` (reply to an image), `chatbot off`, `setprefix !` ... In groups plain words like `ping` need her name
(`Lumi ping`); commands with a real target (`kick @user`) work as they are. Everyone else must use the prefix.
Owners also get a kind Lumi: no insults. Everyone else gets the rude one.

## Notes
- Reasoning models (e.g. GROQ_MODEL=openai/gpt-oss-20b) can leak their thinking; Lumi strips it, but `llama-3.3-70b-versatile` is the safe choice.
- If you forget a custom prefix: `.setprefix reset`, `.claim` and `.wake` always answer to the default `.`

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
