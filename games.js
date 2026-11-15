// Games: rps, dice, flip, 8ball, slots, guess, math, ttt (tic-tac-toe), hangman, top (leaderboard).
// Game state lives in memory (a restart ends running games). Wins are saved for .top
const settings = require('./settings');
const extras = require('./extras');
const { numberOf } = require('./jid');

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const P = () => settings.prefix();
const win = (ctx) => extras.addWin(ctx.senderNum, ctx.pushName);
const IDLE = 10 * 60 * 1000;

function live(map, id, idle = IDLE) {
  const g = map.get(id);
  if (g && Date.now() - g.at > idle) { map.delete(id); return null; }
  return g || null;
}

// ---- rock paper scissors ------------------------------------------------------
const RPS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RPS_ALIAS = { r: 'rock', rock: 'rock', p: 'paper', paper: 'paper', s: 'scissors', scissor: 'scissors', scissors: 'scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

// ---- 8ball ----------------------------------------------------------------------
const BALL = ['Yes.', 'No.', 'Obviously.', 'Don\'t count on it.', 'Ask me when I care.', 'Probably.', 'Doubt it.', 'Without a doubt.', 'Not a chance.', 'Maybe. Maybe not.', 'The signs say yes.', 'I wouldn\'t.'];

// ---- slots ----------------------------------------------------------------------
const REEL = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];

// ---- guess the number -----------------------------------------------------------
const guessGames = new Map();
const GUESS_MAX_TRIES = 10;

// ---- quick maths ----------------------------------------------------------------
const mathGames = new Map();
function mathQuestion() {
  const t = rnd(3);
  const a = 2 + rnd(40), b = 2 + rnd(40);
  if (t === 0) return { q: `${a} + ${b}`, a: a + b };
  if (t === 1) { const [x, y] = a >= b ? [a, b] : [b, a]; return { q: `${x} - ${y}`, a: x - y }; }
  const m = 2 + rnd(11), n = 2 + rnd(11);
  return { q: `${m} × ${n}`, a: m * n };
}

// ---- tic-tac-toe ----------------------------------------------------------------
const tttGames = new Map();
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const cell = (b, i) => (b[i] === 'x' ? '❌' : b[i] === 'o' ? '⭕' : NUM[i]);
const render = (b) => [0, 3, 6].map((r) => `${cell(b, r)}${cell(b, r + 1)}${cell(b, r + 2)}`).join('\n');
const winnerOf = (b) => { for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return null; };
const tttSend = (ctx, g, head) =>
  ctx.reply(`${head}\n\n${render(g.board)}`, { mentions: [g.xJid, g.oJid] });

// ---- hangman --------------------------------------------------------------------
const hangGames = new Map();
const WORDS = ['whatsapp', 'keyboard', 'sunrise', 'journey', 'thunder', 'pyramid', 'puzzle', 'monster', 'library', 'diamond', 'shadow', 'rainbow', 'volcano', 'compass', 'lantern', 'blanket', 'penguin', 'dragon', 'galaxy', 'mystery', 'pocket', 'jungle', 'picnic', 'harvest', 'warrior', 'whisper', 'crystal', 'silence', 'garden', 'bridge'];
const HANG_MAX = 6;
const hangView = (g) =>
  `${[...g.word].map((c) => (g.guessed.has(c) ? c : '_')).join(' ')}\n` +
  `Lives: ${'❤️'.repeat(HANG_MAX - g.wrong)}${'🖤'.repeat(g.wrong)}` +
  (g.wrongLetters.length ? `\nWrong: ${g.wrongLetters.join(' ')}` : '');

module.exports = [
  {
    name: 'rps', category: 'GAMES', menu: ['rps <rock|paper|scissors>'],
    run: (ctx) => {
      const you = RPS_ALIAS[(ctx.args[0] || '').toLowerCase()];
      if (!you) return ctx.reply(`Pick one: ${P()}rps rock | paper | scissors`);
      const me = pick(Object.keys(RPS));
      let verdict;
      if (you === me) verdict = 'Draw. Again.';
      else if (BEATS[you] === me) { win(ctx); verdict = pick(['You win. Enjoy it.', 'Fine. You got that one.']); }
      else verdict = pick(['I win.', 'Too easy.']);
      return ctx.reply(`${RPS[you]} vs ${RPS[me]}\n${verdict}`);
    },
  },
  {
    name: 'dice', aliases: ['roll'], category: 'GAMES', menu: ['dice [sides]'],
    run: (ctx) => {
      const sides = parseInt(ctx.args[0], 10) || 6;
      if (sides < 2 || sides > 1000) return ctx.reply('Between 2 and 1000 sides.');
      return ctx.reply(`🎲 ${1 + rnd(sides)}  (d${sides})`);
    },
  },
  {
    name: 'flip', aliases: ['coin', 'coinflip'], category: 'GAMES', menu: ['flip'],
    run: (ctx) => ctx.reply(`🪙 ${pick(['Heads.', 'Tails.'])}`),
  },
  {
    name: '8ball', aliases: ['ball'], category: 'GAMES', menu: ['8ball <question>'],
    run: (ctx) => (ctx.argText ? ctx.reply(`🎱 ${pick(BALL)}`) : ctx.reply(`Ask something. Example: ${P()}8ball will I pass`)),
  },
  {
    name: 'slots', aliases: ['slot'], category: 'GAMES', menu: ['slots'],
    run: (ctx) => {
      const r = [pick(REEL), pick(REEL), pick(REEL)];
      const line = `🎰 ${r.join(' | ')}`;
      if (r[0] === r[1] && r[1] === r[2]) { win(ctx); return ctx.reply(`${line}\nJackpot. Don't look so smug.`); }
      if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) return ctx.reply(`${line}\nAlmost. Pull again.`);
      return ctx.reply(`${line}\nNothing. Predictable.`);
    },
  },
  {
    name: 'guess', category: 'GAMES', menu: ['guess', 'guess <number>'],
    run: (ctx) => {
      const a = (ctx.args[0] || '').toLowerCase();
      let g = live(guessGames, ctx.jid);
      if (a === 'end' || a === 'stop') {
        if (!g) return ctx.reply('No game running.');
        guessGames.delete(ctx.jid);
        return ctx.reply(`It was ${g.n}. Giving up already?`);
      }
      if (!a) {
        if (g) return ctx.reply(`A game is on. Guess 1-100 with ${P()}guess <number>. Tries used: ${g.tries}/${GUESS_MAX_TRIES}.`);
        guessGames.set(ctx.jid, { n: 1 + rnd(100), tries: 0, at: Date.now() });
        return ctx.reply(`I'm thinking of a number from 1 to 100. ${GUESS_MAX_TRIES} tries, everyone shares them.\nGuess with ${P()}guess <number>`);
      }
      if (!/^\d{1,3}$/.test(a)) return ctx.reply(`Use a number: ${P()}guess 42`);
      if (!g) return ctx.reply(`No game running. Start one with ${P()}guess`);
      const n = parseInt(a, 10);
      g.tries += 1; g.at = Date.now();
      if (n === g.n) { guessGames.delete(ctx.jid); win(ctx); return ctx.reply(`${n}. Yes. Took ${g.tries} ${g.tries === 1 ? 'try' : 'tries'}.`); }
      if (g.tries >= GUESS_MAX_TRIES) { guessGames.delete(ctx.jid); return ctx.reply(`Out of tries. It was ${g.n}.`); }
      return ctx.reply(`${n < g.n ? 'Higher.' : 'Lower.'} (${g.tries}/${GUESS_MAX_TRIES})`);
    },
  },
  {
    name: 'math', aliases: ['quiz'], category: 'GAMES', menu: ['math', 'math <answer>'],
    run: (ctx) => {
      const a = (ctx.args[0] || '').trim();
      let g = live(mathGames, ctx.jid, 2 * 60 * 1000);
      if (!a) {
        if (!g) { g = { ...mathQuestion(), at: Date.now() }; mathGames.set(ctx.jid, g); }
        return ctx.reply(`🧮 ${g.q} = ?\nAnswer with ${P()}math <number>. First right answer wins.`);
      }
      if (!/^-?\d+$/.test(a)) return ctx.reply(`Use a number: ${P()}math 42`);
      if (!g) return ctx.reply(`No question running. Start one with ${P()}math`);
      if (parseInt(a, 10) !== g.a) return ctx.reply('No.');
      mathGames.delete(ctx.jid); win(ctx);
      return ctx.reply(`${g.q} = ${g.a}. Right. First one there.`);
    },
  },
  {
    name: 'ttt', aliases: ['tictactoe'], category: 'GAMES', menu: ['ttt @user', 'ttt <1-9>'],
    run: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply('Groups only. I need two people.');
      const g = live(tttGames, ctx.jid);
      const a = (ctx.args[0] || '').toLowerCase();

      if (a === 'end' || a === 'stop') {
        if (!g) return ctx.reply('No game running.');
        if (![g.x, g.o].includes(ctx.senderNum) && !ctx.isOwner) return ctx.reply("It's not your game.");
        tttGames.delete(ctx.jid);
        return ctx.reply('Game over. Nobody wins.');
      }

      if (/^[1-9]$/.test(a)) {
        if (!g) return ctx.reply(`No game here. Start one: ${P()}ttt @user`);
        const mark = g.x === ctx.senderNum ? 'x' : g.o === ctx.senderNum ? 'o' : null;
        if (!mark) return ctx.reply("You're not in this game.");
        if (g.turn !== mark) return ctx.reply("Not your turn.");
        const i = parseInt(a, 10) - 1;
        if (g.board[i]) return ctx.reply('That square is taken.');
        g.board[i] = mark; g.at = Date.now();
        const w = winnerOf(g.board);
        if (w) {
          tttGames.delete(ctx.jid); win(ctx);
          return tttSend(ctx, g, `${w === 'x' ? '❌' : '⭕'} @${ctx.senderNum} wins.`);
        }
        if (g.board.every(Boolean)) { tttGames.delete(ctx.jid); return tttSend(ctx, g, 'Draw. Boring.'); }
        g.turn = mark === 'x' ? 'o' : 'x';
        return tttSend(ctx, g, `${g.turn === 'x' ? '❌' : '⭕'} @${g.turn === 'x' ? g.x : g.o}, your move. (${P()}ttt <1-9>)`);
      }

      // start a game
      if (g) return ctx.reply(`A game is already running here. ${P()}ttt end stops it.`);
      const target = ctx.mentioned[0] || (ctx.ctxInfo && ctx.ctxInfo.participant);
      if (!target) return ctx.reply(`Tag who you want to play.\nExample: ${P()}ttt @user`);
      const o = numberOf(target);
      const botNums = [ctx.sock.user && ctx.sock.user.id, ctx.sock.user && ctx.sock.user.lid].filter(Boolean).map(numberOf);
      if (botNums.includes(o)) return ctx.reply("I don't play. I'd win and you'd sulk.");
      if (o === ctx.senderNum) return ctx.reply('Playing yourself? Pick someone else.');
      const game = { x: ctx.senderNum, o, xJid: ctx.sender, oJid: target, board: Array(9).fill(null), turn: 'x', at: Date.now() };
      tttGames.set(ctx.jid, game);
      return tttSend(ctx, game, `❌ @${game.x} vs ⭕ @${game.o}\n@${game.x} starts. Play with ${P()}ttt <1-9>`);
    },
  },
  {
    name: 'hangman', aliases: ['hm'], category: 'GAMES', menu: ['hangman', 'hangman <letter>'],
    run: (ctx) => {
      const a = (ctx.args[0] || '').toLowerCase();
      const g = live(hangGames, ctx.jid);
      if (a === 'end' || a === 'stop') {
        if (!g) return ctx.reply('No game running.');
        hangGames.delete(ctx.jid);
        return ctx.reply(`It was "${g.word}".`);
      }
      if (!a) {
        if (g) return ctx.reply(`${hangView(g)}\nGuess with ${P()}hangman <letter>`);
        const ng = { word: pick(WORDS), guessed: new Set(), wrong: 0, wrongLetters: [], at: Date.now() };
        hangGames.set(ctx.jid, ng);
        return ctx.reply(`${hangView(ng)}\nGuess with ${P()}hangman <letter> (or the whole word)`);
      }
      if (!/^[a-z]+$/.test(a)) return ctx.reply('Letters only.');
      if (!g) return ctx.reply(`No game running. Start one with ${P()}hangman`);
      g.at = Date.now();

      if (a.length > 1) { // whole-word guess
        if (a === g.word) { hangGames.delete(ctx.jid); win(ctx); return ctx.reply(`"${g.word}". Yes. Got it in one.`); }
        g.wrong += 1;
      } else {
        if (g.guessed.has(a) || g.wrongLetters.includes(a)) return ctx.reply('Already tried that one.');
        if (g.word.includes(a)) g.guessed.add(a); else { g.wrong += 1; g.wrongLetters.push(a); }
      }
      if ([...g.word].every((c) => g.guessed.has(c))) { hangGames.delete(ctx.jid); win(ctx); return ctx.reply(`"${g.word}". Solved. Fine.`); }
      if (g.wrong >= HANG_MAX) { hangGames.delete(ctx.jid); return ctx.reply(`Dead. It was "${g.word}".`); }
      return ctx.reply(hangView(g));
    },
  },
  {
    name: 'top', aliases: ['leaderboard', 'gamescore'], category: 'GAMES', menu: ['top'],
    run: (ctx) => {
      const t = extras.topWins(10);
      if (!t.length) return ctx.reply('Nobody has won anything yet.');
      return ctx.reply(`*Game wins*\n${t.map((w, i) => `${i + 1}. ${w.name || w.num}: ${w.n}`).join('\n')}`);
    },
  },
];
module.exports.winnerOf = winnerOf; // exported for tests
