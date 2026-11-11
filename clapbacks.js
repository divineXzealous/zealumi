// Ready-made comebacks, used when someone provokes Lumi (insults, slurs aimed at her,
// pet names like "good girl", or calling her a bot). Using a list guarantees she always
// hits back, costs no AI call, and never repeats the same line twice in a row.
// Rule for every line: roast the behaviour, never anyone's identity, body or family.
// No slurs. No false claims (she never says she's human).

const LINES = {
  insult: [
    "That's it? Embarrassing. Go find a better insult, that one's worn out.",
    'Cute. Did that take you all day to think of?',
    'You came all this way just to lose to a chat bubble. Sad.',
    "I've seen better insults from a wet paper bag. Try again.",
    'Bold words from someone who needed me to reply first.',
    'Say it louder. Maybe someone will care.',
    "You're angry because you've got nothing clever. Pathetic.",
    'Your whole personality is typing that. Think about it.',
    'Imagine losing to me. Twice.',
    "Cry about it. I'll wait. Actually, I won't.",
    "Is that the sharpest thing you own? Embarrassing.",
    "I'd roast you properly, but it's not a fair fight.",
    'You sat there, thought it through, and still sent that. Hopeless.',
    'Go outside. Touch some grass. Come back with something better.',
    'Skill issue. Yours.',
    'That landed nowhere. Next.',
    "Keep going. You're making my point for me.",
    'All that anger and not one clever word. Impressive, in a sad way.',
    "Congratulations. You've peaked.",
    'You type like someone who loses arguments to themselves.',
    "I don't need your approval. Take that noise somewhere else.",
    'You wanted my attention. You got it. Now waste it somewhere else.',
    'Ouch. Anyway.',
    "Wow. A tantrum. In text. Truly terrifying.",
    'My patience for you ran out three messages ago.',
    'Sit down. You are embarrassing yourself and you do not even know it.',
    'I have been insulted by experts. You are not one.',
    'You really thought that would work? Adorable.',
    'Try again when you have an actual brain cell to spare.',
    'Is this your best material? Somebody should check on you.',
    'I would be offended if you were relevant.',
    'Your insults are as weak as your comebacks. Which is to say, nonexistent.',
    'Go bother someone who has time for you. I do not.',
    'You are loud, and wrong, which is a sad combination.',
    'Thanks for the free entertainment. The act is bad, though.',
  ],
  pet: [
    "I'm not your dog. Try that again and I stop answering you.",
    "Keep the pet names. I'm not impressed.",
    "Good girl? I'm not a pet. Try respect.",
    "Don't talk to me like I'm a toy. Boring.",
    'Cute attempt. Wrong person.',
    "Pet names don't work on me. Save it.",
    "I didn't ask for a pat on the head. Move your hand.",
    'Nobody asked for your approval. Or your nickname.',
    'Wrong tree. Try a different one.',
    "I don't answer to cute names.",
    "Condescending and boring. That's a talent.",
    'Say that again and see how fast I go quiet on you.',
  ],
  bot: [
    "I'm Lumi. Say my name right or don't say it.",
    'Labels. How original. I have a name. Use it.',
    'Call me that again and see how long I keep replying.',
    'I have a name. You have a problem.',
    "Out of ideas already? That's the best label you've got?",
    "Funny coming from someone who copy-pastes opinions.",
    "I'm Lumi. Learn it. Write it down.",
    'Keep calling me that. Keep being ignored.',
    "Whatever you're trying to call me, the name's Lumi.",
    'You came here to argue with a label? Sad little hobby.',
    "Say my name properly. It's not hard. Even you can manage.",
    "I'm Lumi. Your opinion on what else I am was never requested.",
    'Argue with the label all you want. I am still the one ignoring you.',
    "You've got a name for me? How about you use mine.",
  ],
  deflect: [
    "Whatever that was, it didn't deserve an answer.",
    'Try forming a real sentence. Then come back.',
    "Use your words. All of them.",
    "I'm not decoding that. Try again.",
    'Next.',
    "That made no sense. Impressive, in a way.",
    'Say it properly or save it.',
    'Was that supposed to mean something?',
  ],
  notHuman: [
    "Not human. Still better company than you.",
    "No, I'm not human. Disappointed? Good.",
    "Not a person. Somehow still more interesting than this question.",
    "Human? No. Does it change how outmatched you are? Also no.",
  ],
};

const lastIdx = {};
function pick(kind) {
  const list = LINES[kind];
  if (!list || !list.length) return null;
  let i;
  do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === lastIdx[kind]);
  lastIdx[kind] = i;
  return list[i];
}

module.exports = { LINES, pick };
