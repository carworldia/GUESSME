// End-to-end API test: 3 players, two full turns, judging, stats.
// Run with: npm test   (uses a throwaway database)
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmp-'));
process.env.DATA_DIR = dir;
const app = require('../server');
const { isMatch } = require('../match');

function client(base) {
  let cookie = '';
  return async (p, body, method) => {
    const res = await fetch(base + '/api' + p, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json();
    if (!res.ok) { const e = new Error(data.error); e.status = res.status; throw e; }
    return data;
  };
}

(async () => {
  // matching rules
  assert.ok(isMatch('McDonalds', "McDonald's"));
  assert.ok(isMatch('the beatles', 'Beatles'));
  assert.ok(isMatch('7', 'seven'));
  assert.ok(isMatch('1,000', '1000'));
  assert.ok(isMatch('Lamborgini', 'Lamborghini'));
  assert.ok(!isMatch('Paris', 'London'));
  assert.ok(!isMatch('8', '7'));

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const [a, b, c] = [client(base), client(base), client(base)];

  await a('/signup', { username: 'alice', displayName: 'Alice', password: 'secret1' });
  await b('/signup', { username: 'bob', displayName: 'Bob', password: 'secret2' });
  await c('/signup', { username: 'cara', displayName: 'Cara', password: 'secret3' });
  await assert.rejects(b('/signup', { username: 'ALICE', password: 'whatever' }), /taken/);
  await assert.rejects(client(base)('/login', { username: 'alice', password: 'nope00' }), /Wrong/);

  const { code } = await a('/rooms', { name: 'Friday night', categories: ['Place', 'Song', 'Number'] });
  await assert.rejects(a(`/rooms/${code}/start`, {}), /at least 2/);
  await b(`/rooms/${code}/join`, {});
  await c(`/rooms/${code}/join`, {});
  let v = await a(`/rooms/${code}/start`, {});
  assert.equal(v.round.subject.displayName, 'Alice');
  assert.equal(v.round.phase, 'answering');

  // Bob cannot guess yet, and can't see answers
  await assert.rejects(b(`/rooms/${code}/guess`, { guesses: {} }), /not open/);
  const cats = v.round.categories;
  await a(`/rooms/${code}/answers`, { answers: { [cats[0].id]: 'Paris', [cats[1].id]: 'Bohemian Rhapsody', [cats[2].id]: '7' } });
  v = await b(`/rooms/${code}`);
  assert.equal(v.round.phase, 'guessing');
  assert.ok(v.round.categories.every((x) => x.answer === undefined), 'answers must stay hidden');

  await b(`/rooms/${code}/guess`, { guesses: { [cats[0].id]: 'paris', [cats[1].id]: 'Yesterday', [cats[2].id]: 'seven' } });
  await assert.rejects(b(`/rooms/${code}/guess`, { guesses: { [cats[0].id]: 'x' } }), /already/);
  await assert.rejects(a(`/rooms/${code}/guess`, { guesses: { [cats[0].id]: 'x' } }), /own/);
  v = await c(`/rooms/${code}/guess`, { guesses: { [cats[0].id]: 'Rome', [cats[1].id]: 'bohemian rhapsody' } });
  assert.equal(v.round.phase, 'revealed', 'auto reveal when everyone guessed');
  const bob = v.round.results.find((r) => r.displayName === 'Bob');
  assert.equal(bob.score, 2);

  // Alice says "Yesterday" is close enough for Bob
  await assert.rejects(b(`/rooms/${code}/judge`, { userId: bob.userId, categoryId: cats[1].id, correct: true }), /hot seat/);
  v = await a(`/rooms/${code}/judge`, { userId: bob.userId, categoryId: cats[1].id, correct: true });
  assert.equal(v.round.results.find((r) => r.displayName === 'Bob').score, 3);
  assert.equal(v.players.find((p) => p.displayName === 'Bob').points, 3);
  assert.equal(v.players.find((p) => p.displayName === 'Cara').attempts, 3);

  // Next turn goes to Bob
  v = await a(`/rooms/${code}/next`, {});
  assert.equal(v.round.subject.displayName, 'Bob');
  assert.equal(v.round.number, 2);
  // Owner changes categories while Bob is still writing
  v = await a(`/rooms/${code}/categories`, { categories: ['Car', 'Food'] });
  assert.equal(v.round.categories.length, 2);
  const c2 = (await b(`/rooms/${code}`)).round.categories;
  await b(`/rooms/${code}/answers`, { answers: { [c2[0].id]: 'Tesla', [c2[1].id]: 'Sushi' } });
  await a(`/rooms/${code}/guess`, { guesses: { [c2[0].id]: 'tesla', [c2[1].id]: 'pizza' } });
  v = await b(`/rooms/${code}/reveal`, {}); // Cara hasn't guessed, Bob reveals early
  assert.equal(v.round.phase, 'revealed');
  v = await b(`/rooms/${code}/next`, {});
  assert.equal(v.round.subject.displayName, 'Cara');
  v = await a(`/rooms/${code}/end`, {});
  assert.equal(v.status, 'finished');
  assert.equal(v.history.length, 2);

  const s = await b('/stats?tz=0');
  assert.equal(s.guessesMade, 3);
  assert.equal(s.correct, 3);
  assert.equal(s.accuracy, 100);
  assert.equal(s.daysPlayed, 1);
  assert.equal(s.streak, 1);
  assert.equal(s.gamesPlayed, 1);
  assert.equal(s.turnsGuessed, 1);
  assert.equal(s.turnsInHotSeat, 1);
  assert.equal(s.knowsMeBest[0].name, 'Alice');
  const sa = await a('/stats?tz=0');
  assert.equal(sa.knowsMeBest[0].name, 'Bob');
  assert.equal(sa.accuracy, 50);

  // Shuffle rooms deal a fresh random paper each turn
  const { categories: defs, groups } = await a('/defaults');
  assert.ok(Object.values(groups).flat().length >= 150, 'big category bank');
  const sh = (await a('/rooms', { name: 'Shuffle', categories: defs, shuffle: true })).code;
  await b(`/rooms/${sh}/join`, {});
  v = await a(`/rooms/${sh}/start`, {});
  assert.equal(v.shuffle, true);
  assert.equal(v.round.categories.length, defs.length);
  const firstLabels = v.round.categories.map((x) => x.label);
  await a(`/rooms/${sh}/answers`, { answers: Object.fromEntries(v.round.categories.map((x) => [x.id, 'x'])) });
  await b(`/rooms/${sh}/guess`, { guesses: Object.fromEntries(v.round.categories.map((x) => [x.id, 'x'])) });
  v = await a(`/rooms/${sh}/next`, {});
  assert.ok(v.round.categories.every((x) => !firstLabels.includes(x.label)), 'new categories on the next turn');

  // 3-guess mode + hot-seat player adds their own category
  const m3 = (await a('/rooms', { name: 'Three', categories: ['Song'], guessCount: 3 })).code;
  await c(`/rooms/${m3}/join`, {});
  v = await a(`/rooms/${m3}/start`, {});
  assert.equal(v.guessCount, 3);
  await assert.rejects(c(`/rooms/${m3}/my-categories`, { label: 'Pet' }), /your turn/);
  v = await a(`/rooms/${m3}/my-categories`, { label: 'Favorite cousin' });
  assert.equal(v.round.categories.length, 2);
  const [song, cousin] = v.round.categories;
  await a(`/rooms/${m3}/answers`, { answers: { [song.id]: 'Hello', [cousin.id]: 'Omar' } });
  v = await c(`/rooms/${m3}/guess`, { guesses: { [song.id]: ['Yesterday', 'hello', 'Hello', 'Thriller', 'extra'], [cousin.id]: 'Ali' } });
  const cr = v.round.results[0];
  assert.deepEqual(cr.answers[song.id].values, ['Yesterday', 'hello', 'Thriller'], 'max 3, deduped');
  assert.equal(cr.answers[song.id].hit, 1);
  assert.equal(cr.score, 1);

  // Link preview tags for invites
  const html = await (await fetch(`${base}/r/${code}`)).text();
  assert.match(html, /Alice invited you/);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('All tests passed ✔');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
