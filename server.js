// GuessMe: a live party game. Players take turns in the hot seat: one fills in
// secret answers to a paper of categories, everyone else guesses, then all is revealed.
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, tx } = require('./db');
const { isMatch } = require('./match');
const { CATEGORY_GROUPS, DEFAULT_CATEGORIES, randomCategories } = require('./categories');

const APP_NAME = process.env.APP_NAME || 'GuessMe';
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 60;
const COOKIE = 'rmp_session';

const app = express();
app.set('trust proxy', 1); // so req.secure works behind Render/Railway/Fly proxies
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// ---------- helpers ----------
const now = () => Date.now();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
function newCode() {
  for (;;) {
    let code = '';
    const bytes = crypto.randomBytes(7);
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)) return code;
  }
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Tiny in-memory rate limiter for auth endpoints.
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, _res, next) => {
    const key = `${req.path}:${req.ip}`;
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    arr.push(t);
    hits.set(key, arr);
    if (arr.length > max) return next(new HttpError(429, 'Too many attempts. Try again in a few minutes.'));
    next();
  };
}
setInterval(() => {
  const t = now();
  for (const [k, arr] of hits) if (!arr.some((x) => t - x < 15 * 60e3)) hits.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
}, 10 * 60e3).unref();

// ---------- auth middleware ----------
app.use((req, _res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.user = null;
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.username, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(token, now());
    if (row) { req.user = row; req.sessionToken = token; }
  }
  next();
});

// Only accept JSON for state-changing API calls (blocks simple cross-site form posts).
app.use('/api', (req, _res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return next(new HttpError(415, 'Send JSON.'));
  next();
});

const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in first.')));
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name });

// ---------- auth routes ----------
app.post('/api/signup', rateLimit(Number(process.env.SIGNUP_LIMIT) || 30, 15 * 60e3), (req, res) => {
  const username = clean(req.body.username, 24).toLowerCase();
  const displayName = clean(req.body.displayName, 30) || username;
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) fail(400, 'Username must be 3-24 letters, numbers, dots or underscores.');
  if (password.length < 6) fail(400, 'Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken.');
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, displayName, hashPassword(password), now());
  startSession(req, res, Number(lastInsertRowid));
  res.json({ user: { id: Number(lastInsertRowid), username, displayName } });
});

app.post('/api/login', rateLimit(Number(process.env.LOGIN_LIMIT) || 30, 15 * 60e3), (req, res) => {
  const username = clean(req.body.username, 24).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !checkPassword(String(req.body.password || ''), user.password_hash)) {
    fail(401, 'Wrong username or password.');
  }
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null, appName: APP_NAME });
});

// ---------- live updates (Server-Sent Events) ----------
const listeners = new Map(); // roomId -> Set(res)
function broadcast(roomId) {
  db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(now(), roomId);
  for (const res of listeners.get(roomId) || []) res.write('event: update\ndata: {}\n\n');
}

// ---------- rooms & rounds ----------

function cleanCategories(list) {
  const cats = (Array.isArray(list) ? list : []).map((c) => clean(c, 40)).filter(Boolean);
  if (cats.length < 1) fail(400, 'Add at least one category.');
  if (cats.length > 20) fail(400, 'A paper can have at most 20 categories.');
  return cats;
}

function loadRoom(code) {
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(String(code).toLowerCase());
  if (!room) fail(404, "That room doesn't exist. Check the code?");
  return room;
}

const roomPlayers = (roomId) => db.prepare(`
  SELECT rp.user_id, rp.seat, u.display_name, u.username FROM room_players rp
  JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ? ORDER BY rp.seat`).all(roomId);

const currentRound = (roomId) =>
  db.prepare('SELECT * FROM rounds WHERE room_id = ? ORDER BY number DESC LIMIT 1').get(roomId);

const GUESS_MODES = [1, 3, 5];
const guessModeOf = (v, fallback = 1) => (GUESS_MODES.includes(Number(v)) ? Number(v) : fallback);
const valsOf = (r) => { try { const a = JSON.parse(r.vals); if (Array.isArray(a)) return a; } catch {} return r.value ? [r.value] : []; };

const isCorrect = (r) => (r.override === null || r.override === undefined ? !!r.auto_correct : !!r.override);

function roundResults(round) {
  round = { ...round, answers: Object.fromEntries(db.prepare('SELECT id, answer FROM round_categories WHERE round_id = ?').all(round.id).map((c) => [c.id, c.answer])) };
  const guesses = db.prepare(`
    SELECT g.id, g.user_id, u.display_name FROM guesses g JOIN users u ON u.id = g.user_id
    WHERE g.round_id = ? ORDER BY g.submitted_at`).all(round.id);
  return guesses.map((g) => {
    const answers = {};
    let score = 0;
    for (const r of db.prepare('SELECT * FROM guess_answers WHERE guess_id = ?').all(g.id)) {
      const ok = isCorrect(r);
      if (ok) score++;
      const values = valsOf(r);
      const answer = round.answers ? round.answers[r.category_id] : null;
      const hit = answer ? values.findIndex((x) => isMatch(x, answer)) : -1;
      answers[r.category_id] = { value: r.value, values, hit, correct: ok, overridden: r.override !== null };
    }
    return { userId: g.user_id, displayName: g.display_name, answers, score };
  }).sort((a, b) => b.score - a.score);
}

// What the given user is allowed to see about a room right now. The hot-seat
// player's answers are never sent to anyone else until the round is revealed.
function roomView(room, user) {
  const players = roomPlayers(room.id);
  const me = user ? players.find((p) => p.user_id === user.id) : null;

  // Running score per player: points (correct guesses) out of guesses attempted.
  const totals = new Map(players.map((p) => [p.user_id, { points: 0, attempts: 0 }]));
  for (const r of db.prepare(`
    SELECT g.user_id, SUM(COALESCE(ga.override, ga.auto_correct)) AS pts, COUNT(*) AS attempts
    FROM rounds rd JOIN guesses g ON g.round_id = rd.id JOIN guess_answers ga ON ga.guess_id = g.id
    WHERE rd.room_id = ? AND rd.phase = 'revealed' GROUP BY g.user_id`).all(room.id)) {
    totals.set(r.user_id, { points: r.pts, attempts: r.attempts });
  }

  const view = {
    code: room.code,
    name: room.name,
    status: room.status,
    categories: JSON.parse(room.categories),
    shuffle: !!room.shuffle,
    guessCount: room.guess_count || 1,
    ownerId: room.owner_id,
    isOwner: !!user && user.id === room.owner_id,
    isMember: !!me,
    me: user ? { id: user.id, displayName: user.display_name } : null,
    players: players
      .map((p) => {
        const t = totals.get(p.user_id) || { points: 0, attempts: 0 };
        return { userId: p.user_id, displayName: p.display_name, username: p.username, seat: p.seat, points: t.points, attempts: t.attempts };
      })
      .sort((a, b) => a.seat - b.seat),
    round: null,
    history: [],
  };

  const round = currentRound(room.id);
  if (round && me) {
    const subject = players.find((p) => p.user_id === round.subject_id);
    const isSubject = user.id === round.subject_id;
    const revealed = round.phase === 'revealed';
    const cats = db.prepare('SELECT id, label, answer FROM round_categories WHERE round_id = ? ORDER BY position').all(round.id);
    const submitted = db.prepare('SELECT user_id FROM guesses WHERE round_id = ?').all(round.id).map((r) => r.user_id);
    const myGuess = db.prepare('SELECT id FROM guesses WHERE round_id = ? AND user_id = ?').get(round.id, user.id);
    view.round = {
      number: round.number,
      phase: round.phase,
      subject: { userId: round.subject_id, displayName: subject ? subject.display_name : 'Someone' },
      isSubject,
      categories: cats.map((c) => ({ id: c.id, label: c.label, ...((isSubject || revealed) && c.answer !== null ? { answer: c.answer } : {}) })),
      submitted,
      waitingOn: players.filter((p) => p.user_id !== round.subject_id && !submitted.includes(p.user_id)).map((p) => p.display_name),
      myGuesses: myGuess
        ? Object.fromEntries(db.prepare('SELECT category_id, value, vals FROM guess_answers WHERE guess_id = ?').all(myGuess.id).map((r) => [r.category_id, valsOf(r)]))
        : null,
      results: revealed ? roundResults(round) : null,
    };
  }

  view.history = db.prepare(`
    SELECT rd.number, u.display_name AS subject,
      (SELECT COUNT(*) FROM round_categories c WHERE c.round_id = rd.id) AS categories
    FROM rounds rd JOIN users u ON u.id = rd.subject_id
    WHERE rd.room_id = ? AND rd.phase = 'revealed' ORDER BY rd.number DESC LIMIT 50`).all(room.id)
    .map((h) => {
      const rd = db.prepare('SELECT * FROM rounds WHERE room_id = ? AND number = ?').get(room.id, h.number);
      const top = roundResults(rd)[0];
      return { ...h, best: top ? { displayName: top.displayName, score: top.score } : null };
    });
  return view;
}

function requireMember(room, user) {
  const p = db.prepare('SELECT * FROM room_players WHERE room_id = ? AND user_id = ?').get(room.id, user.id);
  if (!p) fail(403, 'Join the room first.');
  return p;
}

function startRound(room, subjectId) {
  const last = currentRound(room.id);
  let cats = JSON.parse(room.categories);
  if (room.shuffle) {
    // Fresh random paper every turn, avoiding the previous turn's categories.
    const prev = last ? db.prepare('SELECT label FROM round_categories WHERE round_id = ?').all(last.id).map((r) => r.label) : [];
    cats = randomCategories(cats.length, prev);
  }
  tx(() => {
    const { lastInsertRowid: roundId } = db.prepare(
      'INSERT INTO rounds (room_id, number, subject_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(room.id, (last ? last.number : 0) + 1, subjectId, now());
    const ins = db.prepare('INSERT INTO round_categories (round_id, position, label) VALUES (?, ?, ?)');
    cats.forEach((label, i) => ins.run(roundId, i, label));
    db.prepare("UPDATE rooms SET status = 'playing' WHERE id = ?").run(room.id);
  });
}

// The next player after `afterUserId` in seat order (wrapping around).
function nextSubject(room, afterUserId) {
  const players = roomPlayers(room.id);
  if (!players.length) return null;
  const i = players.findIndex((p) => p.user_id === afterUserId);
  return players[(i + 1) % players.length].user_id;
}

function revealRound(round) {
  db.prepare("UPDATE rounds SET phase = 'revealed', revealed_at = ? WHERE id = ?").run(now(), round.id);
}

const reply = (res, room, user) => res.json(roomView(loadRoom(room.code), user));

app.get('/api/defaults', (_req, res) => res.json({ categories: DEFAULT_CATEGORIES, groups: CATEGORY_GROUPS }));

app.post('/api/rooms', requireUser, (req, res) => {
  const name = clean(req.body.name, 50) || `${req.user.display_name}'s room`;
  const categories = cleanCategories(req.body.categories || DEFAULT_CATEGORIES);
  const code = newCode();
  tx(() => {
    const t = now();
    const { lastInsertRowid: roomId } = db.prepare(
      'INSERT INTO rooms (code, owner_id, name, categories, shuffle, guess_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(code, req.user.id, name, JSON.stringify(categories), req.body.shuffle ? 1 : 0, guessModeOf(req.body.guessCount), t, t);
    db.prepare('INSERT INTO room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, 0, ?)').run(roomId, req.user.id, t);
  });
  res.json({ code });
});

app.get('/api/rooms/:code', (req, res) => {
  res.json(roomView(loadRoom(req.params.code), req.user));
});

app.post('/api/rooms/:code/join', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  if (room.status === 'finished') fail(400, 'This game is over. Ask for a new room code.');
  const exists = db.prepare('SELECT 1 FROM room_players WHERE room_id = ? AND user_id = ?').get(room.id, req.user.id);
  if (!exists) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM room_players WHERE room_id = ?').get(room.id).n;
    if (count >= 30) fail(400, 'This room is full (30 players).');
    const seat = db.prepare('SELECT COALESCE(MAX(seat), -1) + 1 AS s FROM room_players WHERE room_id = ?').get(room.id).s;
    db.prepare('INSERT INTO room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)').run(room.id, req.user.id, seat, now());
    broadcast(room.id);
  }
  reply(res, room, req.user);
});

app.post('/api/rooms/:code/leave', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  if (room.owner_id === req.user.id) fail(400, "The room owner can't leave. End the game instead.");
  const round = currentRound(room.id);
  if (round && round.subject_id === req.user.id && round.phase !== 'revealed') {
    fail(400, "It's your turn. Finish it first, or ask the owner to skip you.");
  }
  db.prepare('DELETE FROM room_players WHERE room_id = ? AND user_id = ?').run(room.id, req.user.id);
  maybeAutoReveal(room);
  broadcast(room.id);
  res.json({ ok: true });
});

app.post('/api/rooms/:code/categories', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  if (room.owner_id !== req.user.id) fail(403, 'Only the room owner can change the categories.');
  const categories = cleanCategories(req.body.categories);
  const shuffle = typeof req.body.shuffle === 'boolean' ? Number(req.body.shuffle) : room.shuffle;
  const guessCount = guessModeOf(req.body.guessCount, room.guess_count);
  db.prepare('UPDATE rooms SET categories = ?, shuffle = ?, guess_count = ? WHERE id = ?').run(JSON.stringify(categories), shuffle, guessCount, room.id);
  // If the current turn hasn't been answered yet, apply the new categories to it right away.
  const round = currentRound(room.id);
  if (round && round.phase === 'answering') {
    tx(() => {
      db.prepare('DELETE FROM round_categories WHERE round_id = ?').run(round.id);
      const ins = db.prepare('INSERT INTO round_categories (round_id, position, label) VALUES (?, ?, ?)');
      categories.forEach((label, i) => ins.run(round.id, i, label));
    });
  }
  broadcast(room.id);
  reply(res, room, req.user);
});

app.post('/api/rooms/:code/start', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  if (room.owner_id !== req.user.id) fail(403, 'Only the room owner can start the game.');
  if (room.status !== 'lobby') fail(400, 'The game already started.');
  const players = roomPlayers(room.id);
  if (players.length < 2) fail(400, 'You need at least 2 players. Share the link!');
  startRound(room, players[0].user_id);
  broadcast(room.id);
  reply(res, room, req.user);
});

// The hot-seat player can add their own categories to their paper before locking in.
app.post('/api/rooms/:code/my-categories', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  const round = currentRound(room.id);
  if (!round || round.subject_id !== req.user.id || round.phase !== 'answering') fail(403, 'You can only change your paper on your turn, before locking in.');
  const cats = db.prepare('SELECT id, label FROM round_categories WHERE round_id = ? ORDER BY position').all(round.id);
  if (req.body.remove !== undefined) {
    if (cats.length <= 1) fail(400, 'Your paper needs at least one category.');
    db.prepare('DELETE FROM round_categories WHERE id = ? AND round_id = ?').run(Number(req.body.remove), round.id);
  } else {
    const label = clean(req.body.label, 40);
    if (!label) fail(400, 'Type a category name.');
    if (cats.length >= 20) fail(400, 'A paper can have at most 20 categories.');
    if (cats.some((c) => c.label.toLowerCase() === label.toLowerCase())) fail(409, 'That category is already on your paper.');
    db.prepare('INSERT INTO round_categories (round_id, position, label) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM round_categories WHERE round_id = ?), ?)').run(round.id, round.id, label);
  }
  broadcast(room.id);
  reply(res, room, req.user);
});

// The hot-seat player locks in their secret answers; guessing opens.
app.post('/api/rooms/:code/answers', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  const round = currentRound(room.id);
  if (!round || round.subject_id !== req.user.id) fail(403, "It's not your turn.");
  if (round.phase !== 'answering') fail(400, 'Your answers are already locked in.');
  const given = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const cats = db.prepare('SELECT id, label FROM round_categories WHERE round_id = ?').all(round.id);
  for (const c of cats) if (!clean(given[c.id], 80)) fail(400, `Fill in your answer for "${c.label}".`);
  tx(() => {
    const upd = db.prepare('UPDATE round_categories SET answer = ? WHERE id = ?');
    for (const c of cats) upd.run(clean(given[c.id], 80), c.id);
    db.prepare("UPDATE rounds SET phase = 'guessing', locked_at = ? WHERE id = ?").run(now(), round.id);
  });
  broadcast(room.id);
  reply(res, room, req.user);
});

// Reveal automatically once everyone except the hot-seat player has guessed.
function maybeAutoReveal(room) {
  const round = currentRound(room.id);
  if (!round || round.phase !== 'guessing') return;
  const waiting = db.prepare(`
    SELECT COUNT(*) AS n FROM room_players rp
    WHERE rp.room_id = ? AND rp.user_id != ?
      AND NOT EXISTS (SELECT 1 FROM guesses g WHERE g.round_id = ? AND g.user_id = rp.user_id)`)
    .get(room.id, round.subject_id, round.id).n;
  const anyGuess = db.prepare('SELECT 1 FROM guesses WHERE round_id = ?').get(round.id);
  if (waiting === 0 && anyGuess) revealRound(round);
}

app.post('/api/rooms/:code/guess', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  requireMember(room, req.user);
  const round = currentRound(room.id);
  if (!round || round.phase !== 'guessing') fail(400, 'Guessing is not open right now.');
  if (round.subject_id === req.user.id) fail(400, "You can't guess your own answers!");
  if (db.prepare('SELECT 1 FROM guesses WHERE round_id = ? AND user_id = ?').get(round.id, req.user.id)) {
    fail(409, 'You already locked in your guesses.');
  }
  const given = req.body.guesses && typeof req.body.guesses === 'object' ? req.body.guesses : {};
  const cats = db.prepare('SELECT id, answer FROM round_categories WHERE round_id = ?').all(round.id);
  const max = room.guess_count || 1;
  // Each category takes up to `max` guesses (a string or an array); blanks and repeats are dropped.
  const values = cats.map((c) => {
    const raw = Array.isArray(given[c.id]) ? given[c.id] : [given[c.id]];
    const seen = new Set();
    const vals = raw.map((x) => clean(x, 80)).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, max);
    return { ...c, vals, value: vals.join(' / ') };
  });
  if (!values.some((v) => v.vals.length)) fail(400, 'Make at least one guess.');
  tx(() => {
    const { lastInsertRowid: guessId } = db.prepare(
      'INSERT INTO guesses (round_id, user_id, submitted_at) VALUES (?, ?, ?)'
    ).run(round.id, req.user.id, now());
    const ins = db.prepare('INSERT INTO guess_answers (guess_id, category_id, value, vals, auto_correct) VALUES (?, ?, ?, ?, ?)');
    for (const v of values) ins.run(guessId, v.id, v.value, JSON.stringify(v.vals), v.vals.some((x) => isMatch(x, v.answer)) ? 1 : 0);
  });
  maybeAutoReveal(room);
  broadcast(room.id);
  reply(res, room, req.user);
});

const canRunTurn = (room, round, user) => user.id === room.owner_id || (round && user.id === round.subject_id);

// Reveal now, without waiting for everyone (hot-seat player or owner).
app.post('/api/rooms/:code/reveal', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  const round = currentRound(room.id);
  if (!round || round.phase !== 'guessing') fail(400, 'Nothing to reveal yet.');
  if (!canRunTurn(room, round, req.user)) fail(403, 'Only the player in the hot seat or the owner can reveal.');
  if (!db.prepare('SELECT 1 FROM guesses WHERE round_id = ?').get(round.id)) fail(400, 'Nobody has guessed yet.');
  revealRound(round);
  broadcast(room.id);
  reply(res, room, req.user);
});

// "Close enough!" The hot-seat player (or owner) can mark a guess right or wrong.
app.post('/api/rooms/:code/judge', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  const round = currentRound(room.id);
  if (!round || round.phase !== 'revealed') fail(400, 'Answers are not revealed yet.');
  if (!canRunTurn(room, round, req.user)) fail(403, 'Only the player in the hot seat or the owner can judge.');
  const { userId, categoryId, correct } = req.body;
  const row = db.prepare(`
    SELECT ga.guess_id, ga.auto_correct FROM guess_answers ga JOIN guesses g ON g.id = ga.guess_id
    WHERE g.round_id = ? AND g.user_id = ? AND ga.category_id = ?`).get(round.id, Number(userId), Number(categoryId));
  if (!row) fail(404, 'Guess not found.');
  const value = correct === !!row.auto_correct ? null : Number(!!correct);
  db.prepare('UPDATE guess_answers SET override = ? WHERE guess_id = ? AND category_id = ?').run(value, row.guess_id, Number(categoryId));
  broadcast(room.id);
  reply(res, room, req.user);
});

// Pass the hot seat to the next player.
app.post('/api/rooms/:code/next', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  const round = currentRound(room.id);
  if (room.status !== 'playing' || !round) fail(400, 'The game is not running.');
  if (!canRunTurn(room, round, req.user)) fail(403, 'Only the player in the hot seat or the owner can move on.');
  if (round.phase !== 'revealed') {
    // Owner can skip a player who is taking too long to answer.
    if (req.user.id !== room.owner_id || round.phase !== 'answering') fail(400, 'Finish this turn first.');
    db.prepare('DELETE FROM rounds WHERE id = ?').run(round.id);
  }
  if (roomPlayers(room.id).length < 2) fail(400, 'You need at least 2 players.');
  startRound(loadRoom(room.code), nextSubject(room, round.subject_id));
  broadcast(room.id);
  reply(res, room, req.user);
});

app.post('/api/rooms/:code/end', requireUser, (req, res) => {
  const room = loadRoom(req.params.code);
  if (room.owner_id !== req.user.id) fail(403, 'Only the room owner can end the game.');
  const round = currentRound(room.id);
  if (round && round.phase === 'answering') db.prepare('DELETE FROM rounds WHERE id = ?').run(round.id);
  if (round && round.phase === 'guessing') {
    if (db.prepare('SELECT 1 FROM guesses WHERE round_id = ?').get(round.id)) revealRound(round);
    else db.prepare('DELETE FROM rounds WHERE id = ?').run(round.id);
  }
  db.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(room.id);
  broadcast(room.id);
  reply(res, room, req.user);
});

// Live updates stream: the client re-fetches the room whenever it gets an event.
app.get('/api/rooms/:code/events', (req, res) => {
  const room = loadRoom(req.params.code);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!listeners.has(room.id)) listeners.set(room.id, new Set());
  listeners.get(room.id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  req.on('close', () => {
    clearInterval(ping);
    const set = listeners.get(room.id);
    set.delete(res);
    if (!set.size) listeners.delete(room.id);
  });
});

// ---------- stats dashboard ----------
app.get('/api/stats', requireUser, (req, res) => {
  const uid = req.user.id;
  // Client's timezone offset (minutes, as from Date#getTimezoneOffset) so "days" match the player's calendar.
  const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
  const shift = -tz * 60e3;
  const dayOf = (ms) => new Date(ms + shift).toISOString().slice(0, 10);

  // Guesses made counts every individual guess typed (3-guess mode can make 3 per category).
  // Accuracy = categories got right / categories faced in revealed rounds (same as the leaderboard).
  const g = db.prepare(`
    SELECT
      SUM(CASE WHEN ga.vals IS NOT NULL THEN json_array_length(ga.vals) WHEN ga.value != '' THEN 1 ELSE 0 END) AS made,
      SUM(CASE WHEN rd.phase = 'revealed' THEN 1 ELSE 0 END) AS judged,
      SUM(CASE WHEN rd.phase = 'revealed' AND COALESCE(ga.override, ga.auto_correct) = 1 THEN 1 ELSE 0 END) AS correct
    FROM guess_answers ga JOIN guesses gs ON gs.id = ga.guess_id JOIN rounds rd ON rd.id = gs.round_id
    WHERE gs.user_id = ?`).get(uid);

  const turnsGuessed = db.prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ?').get(uid).n;
  const hotSeat = db.prepare("SELECT COUNT(*) AS n FROM rounds WHERE subject_id = ? AND phase != 'answering'").get(uid).n;
  const games = db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS n FROM rooms r JOIN rounds rd ON rd.room_id = r.id
    WHERE rd.phase = 'revealed' AND (rd.subject_id = ? OR EXISTS (SELECT 1 FROM guesses g WHERE g.round_id = rd.id AND g.user_id = ?))`).get(uid, uid).n;

  // Activity timestamps: every guess submitted and every turn answered.
  const times = [
    ...db.prepare('SELECT submitted_at AS t FROM guesses WHERE user_id = ?').all(uid),
    ...db.prepare('SELECT locked_at AS t FROM rounds WHERE subject_id = ? AND locked_at IS NOT NULL').all(uid),
  ].map((r) => r.t);
  const daySet = new Set(times.map(dayOf));
  const days = [...daySet].sort();

  // Current streak of consecutive days played, ending today or yesterday.
  let streak = 0;
  const cursor = new Date(dayOf(now()) + 'T00:00:00Z');
  if (!daySet.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (daySet.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }

  // Guesses per day for the last 14 days.
  const perDay = new Map();
  for (const r of db.prepare(`
    SELECT gs.submitted_at AS t, SUM(CASE WHEN ga.vals IS NOT NULL THEN json_array_length(ga.vals) ELSE 1 END) AS n FROM guess_answers ga JOIN guesses gs ON gs.id = ga.guess_id
    WHERE gs.user_id = ? AND ga.value != '' AND gs.submitted_at > ? GROUP BY gs.id`).all(uid, now() - 15 * 864e5)) {
    const d = dayOf(r.t);
    perDay.set(d, (perDay.get(d) || 0) + r.n);
  }
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayOf(now() - i * 864e5);
    last14.push({ day: d, guesses: perDay.get(d) || 0 });
  }

  const knowsMeBest = db.prepare(`
    SELECT u.display_name AS name, SUM(COALESCE(ga.override, ga.auto_correct)) AS correct, COUNT(*) AS total
    FROM rounds rd JOIN guesses gs ON gs.round_id = rd.id JOIN guess_answers ga ON ga.guess_id = gs.id
    JOIN users u ON u.id = gs.user_id
    WHERE rd.subject_id = ? AND rd.phase = 'revealed'
    GROUP BY gs.user_id ORDER BY correct * 1.0 / total DESC, correct DESC LIMIT 5`).all(uid);

  const iKnowBest = db.prepare(`
    SELECT u.display_name AS name, SUM(COALESCE(ga.override, ga.auto_correct)) AS correct, COUNT(*) AS total
    FROM guesses gs JOIN rounds rd ON rd.id = gs.round_id JOIN guess_answers ga ON ga.guess_id = gs.id
    JOIN users u ON u.id = rd.subject_id
    WHERE gs.user_id = ? AND rd.phase = 'revealed'
    GROUP BY rd.subject_id ORDER BY correct * 1.0 / total DESC, correct DESC LIMIT 5`).all(uid);

  const rooms = db.prepare(`
    SELECT r.code, r.name, r.status, r.updated_at, r.owner_id = ? AS is_owner,
      (SELECT COUNT(*) FROM room_players p WHERE p.room_id = r.id) AS players
    FROM rooms r JOIN room_players rp ON rp.room_id = r.id AND rp.user_id = ?
    ORDER BY (r.status = 'finished'), r.updated_at DESC LIMIT 30`).all(uid, uid);

  res.json({
    guessesMade: g.made || 0,
    correct: g.correct || 0,
    accuracy: g.judged ? Math.round((100 * (g.correct || 0)) / g.judged) : null,
    turnsGuessed,
    turnsInHotSeat: hotSeat,
    gamesPlayed: games,
    daysPlayed: days.length,
    firstDay: days[0] || null,
    streak,
    last14,
    knowsMeBest,
    iKnowBest,
    rooms: rooms.map((r) => ({ ...r, is_owner: !!r.is_owner })),
  });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

// ---------- static front end ----------
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }));

const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every non-API route serves the single-page app. Paper links get link-preview
// tags so they look good when shared in group chats.
app.get('/{*splat}', (req, res) => {
  let title = `${APP_NAME} · How well do your friends know you?`;
  let desc = 'Fill in your answers, share the link, and see who can guess them.';
  const m = req.path.match(/^\/r\/([a-z0-9]+)/i);
  if (m) {
    const r = db.prepare(`SELECT r.name, u.display_name FROM rooms r JOIN users u ON u.id = r.owner_id WHERE r.code = ?`).get(m[1].toLowerCase());
    if (r) {
      title = `${r.display_name} invited you to play ${APP_NAME}`;
      desc = `Join "${r.name}" and find out who really knows who. Take turns, guess each other's answers, climb the leaderboard.`;
    }
  }
  const html = indexHtml
    .replaceAll('{{APP_NAME}}', esc(APP_NAME))
    .replaceAll('{{OG_TITLE}}', esc(title))
    .replaceAll('{{OG_DESC}}', esc(desc));
  res.type('html').send(html);
});

// ---------- errors ----------
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT}`));
}
module.exports = app;
