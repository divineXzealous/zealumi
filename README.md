# Lumi — WhatsApp chatbot

Built with Node.js, Express and Baileys (unofficial WhatsApp Web library).
AI: Groq (primary) -> DeepSeek -> Gemini, with automatic fallback.

## Read this first
- Baileys is NOT the official WhatsApp API. It breaks Meta's terms and the number can be banned.
  Use a spare number, not your main one.
- Use a SEPARATE number for Lumi. Messages you send from the linked account itself are ignored.
- Nothing here has been run against live WhatsApp/Groq/DeepSeek/Gemini yet. See "Test status".

## Setup on iPhone (Replit)
1. Make a free account in the Replit app/website and create a new Node.js Repl. Keep it PRIVATE
   (the `auth` folder holds your WhatsApp login).
2. Upload `lumi-bot.zip` in the Files panel, open Shell, run: `unzip -o lumi-bot.zip`
   (if files land in a `lumi` subfolder, move them to the Repl root).
3. Get free API keys: Groq (console.groq.com), DeepSeek (platform.deepseek.com),
   Gemini (aistudio.google.com). One key is enough to start.
4. Replit Secrets (padlock icon) — add: GROQ_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY,
   PAIRING_NUMBER (Lumi's number, digits only with country code, e.g. 2348012345678),
   OWNER_NUMBER (your number, digits), PROTECTED_CONTACT_ID (Divine's number, digits).
   Optional names are listed in `.env.example`.
5. Shell: `npm install` then `npm start`.
6. The Console prints `PAIRING CODE: XXXX-XXXX`. On the phone with Lumi's number:
   WhatsApp > Settings > Linked Devices > Link a Device > "Link with phone number instead" > enter the code.
7. Message Lumi's number. Try `.menu`.

## Staying online
Free Repls sleep. For 24/7, use a Replit deployment that keeps running (e.g. Reserved VM — check
current options/pricing) and keep the `auth` folder. Autoscale-style hosting is a poor fit.

## Divine protection and LIDs
In groups WhatsApp sometimes identifies people by a hidden "LID" instead of a phone number. If
Divine's tags don't trigger Lumi, add his LID too: `PROTECTED_CONTACT_ID=phone,lid` (same for OWNER_NUMBER).
Switch it off/on with `.protect off` / `.protect on` (owner only) or PROTECTED_ENABLED.

## Adding a command
Add an object to one of the command files (`general.js`, `ai.js`, `sticker.js`, `music.js`, `profile.js`) with `name`, `category`, `menu`, `run(ctx)`.
The menu rebuilds itself from the registry.

## Folders
- `server.js` / `config.js` — start-up and settings
- All code files sit together in one folder (flat layout, needs Node 20+):
  `providers.js` + `fallback.js` (AI) · `connection.js`, `messageHandler.js` (WhatsApp)
  `index.js` + `general.js`, `ai.js`, `sticker.js`, `music.js`, `profile.js` (commands)
  `personality.js`, `memory.js`, `divine.js`, `menu.js`
- `data/` — memory and settings (private) · `auth/` — WhatsApp session (private)

## Test status
Run `npm test` for offline tests (fallback logic, memory, Divine, menu, dedupe, key scrubbing).
Everything else needs real credentials/devices and must be tested by you:
.ping .about .status .owner .ai .clear .menu .help (WhatsApp login) · .s .toimg .take (needs sharp + ffmpeg
to install correctly; animated conversion is best-effort) · .play (iTunes API: preview + links, no full songs) ·
.getpp (works only if the person's privacy settings allow it).
