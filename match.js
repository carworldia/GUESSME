// Decides whether a guess "matches" the host's answer. Forgiving on purpose:
// case, accents, punctuation, spacing, "the/a/an", small typos and number formats
// are ignored. The host can always override a call after the reveal.

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

function normalize(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')           // mcdonald's -> mcdonalds
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

function asNumber(s) {
  const n = normalize(s).replace(/,/g, '').replace(/\s/g, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  const w = normalize(s);
  if (w in WORD_NUMBERS) return WORD_NUMBERS[w];
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function isMatch(guess, answer) {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g || !a) return false;

  const gn = asNumber(guess);
  const an = asNumber(answer);
  if (gn !== null && an !== null) return gn === an;

  if (g === a) return true;
  const gs = g.replace(/[\s.]/g, '');
  const as = a.replace(/[\s.]/g, '');
  if (gs === as) return true;

  // Allow small typos on longer words.
  const len = Math.max(gs.length, as.length);
  const allowed = len >= 9 ? 2 : len >= 5 ? 1 : 0;
  return allowed > 0 && levenshtein(gs, as) <= allowed;
}

module.exports = { isMatch, normalize };
