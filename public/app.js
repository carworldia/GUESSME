/* GuessMe: front end. Plain JavaScript, no build step. */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const state = { user: null, appName: document.getElementById('brand-name').textContent };
  let cleanup = null; // teardown for the current page (e.g. live-update stream)

  // Category bank, loaded from the server once.
  let bank = null;
  async function loadBank() {
    if (!bank) bank = await api('/defaults').catch(() => ({ categories: ['Place', 'Song', 'Number', 'Car', 'Food', 'Restaurant'], groups: {} }));
    return bank;
  }

  // ---------- utilities ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#2a3eb1', '#ff6b4a', '#1f9d5a', '#9b51e0', '#e0a100', '#0d8bb3', '#d6457a', '#5b6b7f'];
  const colorFor = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const avatar = (name) => `<span class="avatar" style="background:${colorFor(name)}" aria-hidden="true">${esc(String(name).trim().charAt(0).toUpperCase() || '?')}</span>`;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(path, body, method) {
    const opts = { method: method || (body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }

  function go(path, replace) {
    if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
    route();
  }

  const loginLink = (next) => `/login?next=${encodeURIComponent(next || location.pathname)}`;
  const signupLink = (next) => `/signup?next=${encodeURIComponent(next || location.pathname)}`;

  function renderNav() {
    $nav.innerHTML = state.user
      ? `<a class="btn link sm" href="/stats" data-link>My stats</a>
         <a class="btn sm" href="/new" data-link>New game</a>`
      : `<a class="btn link sm" href="${loginLink()}" data-link>Log in</a>
         <a class="btn sm" href="${signupLink()}" data-link>Sign up</a>`;
  }

  // Keep what people are typing safe when the page re-renders from a live update.
  const drafts = {};
  function render(html) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.draft : null;
    const sel = key && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    $app.innerHTML = html;
    $app.querySelectorAll('[data-draft]').forEach((el) => { if (drafts[el.dataset.draft] !== undefined) el.value = drafts[el.dataset.draft]; });
    if (key) {
      const el = $app.querySelector(`[data-draft="${CSS.escape(key)}"]`);
      if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} }
    }
  }
  document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.draft) drafts[e.target.dataset.draft] = e.target.value; });

  function errorBox(err) { return `<div class="error">${esc(err.message || err)}</div>`; }

  // ---------- pages ----------
  async function pageHome() {
    if (!state.user) {
      render(`
        <section class="hero">
          <h1>How well do your friends <em>really</em> know you?</h1>
          <p class="lead">Take turns in the hot seat. Write your secret answers for a place, a song, a number, a car, a food… then everyone tries to guess them.</p>
          <div class="cta">
            <a class="btn big coral" href="/signup" data-link>Create a free account</a>
            <a class="btn big ghost" href="/login" data-link>I already have one</a>
          </div>
        </section>
        <div class="steps">
          <div class="card step"><div class="num">1</div><h3>Open a room</h3><p class="muted small">Pick the categories and send the link or code to your friends.</p></div>
          <div class="card step"><div class="num">2</div><h3>Take turns</h3><p class="muted small">One player fills in their paper in secret. Everyone else guesses their answers.</p></div>
          <div class="card step"><div class="num">3</div><h3>Reveal & score</h3><p class="muted small">See every guess next to the real answer. Points add up on the leaderboard.</p></div>
        </div>`);
      return;
    }
    render(`<div class="loading">Loading…</div>`);
    let stats = null;
    try { stats = await api('/stats?tz=' + new Date().getTimezoneOffset()); } catch {}
    const active = stats ? stats.rooms.filter((r) => r.status !== 'finished') : [];
    render(`
      <h1>Hey ${esc(state.user.displayName)} 👋</h1>
      <div class="card stack">
        <a class="btn big coral" href="/new" data-link>Start a new game</a>
        <form id="join" class="join-box code-input" autocomplete="off">
          <input name="code" placeholder="Enter a room code" aria-label="Room code" maxlength="12" autocapitalize="off" spellcheck="false">
          <button class="btn" type="submit">Join</button>
        </form>
      </div>
      ${active.length ? `
        <div class="card">
          <div class="section-title"><h2>Your games</h2></div>
          <ul class="list">${active.map((r) => `
            <li><a class="grow" href="/r/${r.code}" data-link><strong>${esc(r.name)}</strong><br><span class="muted small">${r.players} player${r.players === 1 ? '' : 's'} · ${r.status === 'lobby' ? 'In the lobby' : 'Playing now'}</span></a>
            <a class="btn sm ghost" href="/r/${r.code}" data-link>Open</a></li>`).join('')}
          </ul>
        </div>` : ''}
      ${stats ? `
        <div class="card">
          <div class="section-title"><h2>Your stats</h2><a href="/stats" data-link class="small">See all</a></div>
          <div class="tiles">
            <div class="tile"><div class="v">${stats.guessesMade}</div><div class="k">Guesses made</div></div>
            <div class="tile"><div class="v">${stats.correct}</div><div class="k">Correct</div></div>
            <div class="tile accent"><div class="v">${stats.accuracy === null ? '–' : stats.accuracy + '%'}</div><div class="k">Accuracy</div></div>
            <div class="tile"><div class="v">${stats.daysPlayed}</div><div class="k">Days played</div></div>
          </div>
        </div>` : ''}`);
    document.getElementById('join').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = new FormData(e.target).get('code').trim();
      const code = (raw.match(/\/r\/([a-z0-9]+)/i) || [null, raw])[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (code) go('/r/' + code);
    });
  }

  function pageAuth(mode) {
    if (state.user) return go(new URLSearchParams(location.search).get('next') || '/', true);
    const next = new URLSearchParams(location.search).get('next') || '/';
    const isSignup = mode === 'signup';
    render(`
      <div class="auth">
        <h1>${isSignup ? 'Join the game' : 'Welcome back'}</h1>
        <form id="auth" class="card" autocomplete="on">
          <div class="field"><label for="u">Username</label>
            <input id="u" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required minlength="3" maxlength="24" placeholder="e.g. sam_k"></div>
          ${isSignup ? `<div class="field"><label for="d">Name your friends will see</label>
            <input id="d" name="displayName" maxlength="30" placeholder="e.g. Sam" autocomplete="nickname"></div>` : ''}
          <div class="field"><label for="p">Password</label>
            <input id="p" name="password" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required minlength="6"></div>
          <div id="err"></div>
          <button class="btn big" type="submit" style="margin-top:16px">${isSignup ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="center muted" style="margin-top:16px">
          ${isSignup ? 'Already have an account?' : 'New here?'}
          <a href="${isSignup ? loginLink(next) : signupLink(next)}" data-link>${isSignup ? 'Log in' : 'Create an account'}</a>
        </p>
      </div>`);
    document.getElementById('auth').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const data = await api('/' + mode, Object.fromEntries(new FormData(e.target)));
        state.user = data.user;
        renderNav();
        go(next.startsWith('/') ? next : '/', true);
      } catch (err) {
        document.getElementById('err').innerHTML = errorBox(err);
        btn.disabled = false;
      }
    });
  }

  // Category editor, used when creating a room and between turns.
  // opts: { shuffle: bool } -> shows the "new random categories every turn" switch.
  function categoryEditor(container, initial, onChange, opts = {}) {
    let cats = [...initial];
    let shuffle = !!opts.shuffle;
    let guessCount = opts.guessCount || 1;
    const groups = (bank && bank.groups) || {};
    const groupNames = Object.keys(groups);
    let group = groupNames[0];
    const all = [...new Set(Object.values(groups).flat())];
    const draw = () => {
      const unused = (groups[group] || []).filter((s) => !cats.some((c) => c.toLowerCase() === s.toLowerCase()));
      container.innerHTML = `
        <div class="chips" style="margin-bottom:12px">
          ${cats.map((c, i) => `<span class="chip">${esc(c)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(c)}">×</button></span>`).join('') || '<span class="muted small">No categories yet</span>'}
        </div>
        <div class="row" style="margin-bottom:12px">
          <button type="button" class="btn sm ghost" data-random>🎲 Surprise me</button>
          ${cats.length ? '<button type="button" class="btn sm link" data-clear>Clear all</button>' : ''}
          <span class="muted small">${cats.length}/20</span>
        </div>
        <div class="join-box" style="margin-bottom:14px">
          <input data-newcat placeholder="Type your own category" maxlength="40" aria-label="New category">
          <button type="button" class="btn" data-add>Add</button>
        </div>
        ${groupNames.length ? `
          <div class="muted small" style="margin-bottom:6px">Or pick from ${all.length}+ ideas:</div>
          <div class="tabs" role="tablist">${groupNames.map((g) => `<button type="button" role="tab" aria-selected="${g === group}" class="tab ${g === group ? 'on' : ''}" data-group="${esc(g)}">${esc(g)}</button>`).join('')}</div>
          <div class="chips">${unused.map((s) => `<button type="button" class="chip suggest" data-sug="${esc(s)}">+ ${esc(s)}</button>`).join('') || '<span class="muted small">All of these are on your paper!</span>'}</div>` : ''}
        <div style="margin-top:18px"><label>Game mode: guesses per category</label>
          <div class="seg" role="radiogroup" aria-label="Guesses per category">${[1, 3, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === guessCount}" class="${n === guessCount ? 'on' : ''}" data-mode="${n}"><strong>${n}</strong><span>${n === 1 ? 'Classic' : n === 3 ? 'Easy' : 'Party'}</span></button>`).join('')}</div>
          <p class="muted small" style="margin:6px 0 0">${guessCount === 1 ? 'One shot per category. Hardcore.' : `Everyone types up to ${guessCount} guesses per category at once. Any one that matches scores the point.`}</p></div>
        ${opts.shuffle !== undefined ? `
          <label class="switch"><input type="checkbox" data-shuffle ${shuffle ? 'checked' : ''}>
            <span><strong>New random categories every turn</strong><br><span class="muted small">Each player gets a fresh paper of ${cats.length || 6} surprise categories.</span></span></label>` : ''}`;
      onChange(cats, shuffle, guessCount);
    };
    const add = (v) => {
      v = String(v || '').trim().slice(0, 40);
      if (!v) return;
      if (cats.some((c) => c.toLowerCase() === v.toLowerCase())) return toast('Already on the paper');
      if (cats.length >= 20) return toast('20 categories max');
      cats.push(v);
      draw();
    };
    container.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.rm !== undefined) { cats.splice(Number(t.dataset.rm), 1); draw(); }
      else if (t.dataset.sug) add(t.dataset.sug);
      else if (t.dataset.group) { group = t.dataset.group; draw(); }
      else if (t.dataset.mode) { guessCount = Number(t.dataset.mode); draw(); }
      else if (t.dataset.clear !== undefined) { cats = []; draw(); }
      else if (t.dataset.random !== undefined) {
        const n = cats.length || 6;
        cats = [...all].sort(() => Math.random() - 0.5).slice(0, n);
        draw();
      }
      else if (t.dataset.add !== undefined) { add(container.querySelector('[data-newcat]').value); container.querySelector('[data-newcat]').focus(); }
    });
    container.addEventListener('change', (e) => {
      if (e.target.matches('[data-shuffle]')) { shuffle = e.target.checked; onChange(cats, shuffle, guessCount); }
    });
    container.addEventListener('keydown', (e) => {
      if (e.target.matches('[data-newcat]') && e.key === 'Enter') { e.preventDefault(); add(e.target.value); container.querySelector('[data-newcat]').focus(); }
    });
    draw();
  }

  async function pageNew() {
    if (!state.user) return go(signupLink('/new'), true);
    const defaults = await loadBank();
    const again = new URLSearchParams(location.search).get('cats');
    const initial = again ? again.split('|').filter(Boolean) : defaults.categories;
    let cats = initial;
    let shuffle = false;
    let guessCount = 1;
    render(`
      <h1>New game</h1>
      <form id="new" class="card stack">
        <div><label for="name">Room name</label>
          <input id="name" name="name" maxlength="50" placeholder="${esc(state.user.displayName)}'s room"></div>
        <div><label>What's on the paper?</label>
          <p class="muted small" style="margin:-2px 0 10px">Everyone answers these on their turn. You can change them between turns.</p>
          <div id="cats"></div></div>
        <div id="err"></div>
        <button class="btn big coral" type="submit">Create room</button>
      </form>`);
    categoryEditor(document.getElementById('cats'), initial, (c, sh, gc) => { cats = c; shuffle = sh; guessCount = gc; }, { shuffle: false, guessCount: 1 });
    document.getElementById('new').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const { code } = await api('/rooms', { name: e.target.name.value, categories: cats, shuffle, guessCount });
        go('/r/' + code, true);
      } catch (err) {
        document.getElementById('err').innerHTML = errorBox(err);
        btn.disabled = false;
      }
    });
  }

  // ---------- the live room ----------
  async function pageRoom(code) {
    let view = null;
    let lastJson = '';
    let editingCats = false;
    let busy = false;
    const shareUrl = `${location.origin}/r/${code}`;

    async function load() {
      try {
        let v = await api('/rooms/' + code);
        if (state.user && !v.isMember && v.status !== 'finished') {
          v = await api(`/rooms/${code}/join`, {});
        }
        apply(v);
      } catch (err) {
        render(`<div class="card center"><h2>Hmm.</h2>${errorBox(err)}<a class="btn" href="/" data-link>Go home</a></div>`);
      }
    }

    function apply(v) {
      const json = JSON.stringify(v);
      if (json === lastJson) return;
      lastJson = json;
      view = v;
      draw();
    }

    async function act(path, body, okMsg) {
      if (busy) return;
      busy = true;
      try {
        const v = await api(`/rooms/${code}/${path}`, body || {});
        if (okMsg) toast(okMsg);
        apply(v);
      } catch (err) {
        toast(err.message);
      } finally {
        busy = false;
      }
    }

    function playerList(v, round) {
      const sorted = v.status === 'lobby' ? v.players : [...v.players].sort((a, b) => b.points - a.points);
      return `<ul class="players">${sorted.map((p) => {
        const tags = [];
        if (round && p.userId === round.subject.userId && round.phase !== 'revealed') tags.push('<span class="tag coral">Hot seat</span>');
        else if (round && round.phase === 'guessing' && round.submitted.includes(p.userId)) tags.push('<span class="tag good">Guessed</span>');
        if (p.userId === v.ownerId) tags.push('<span class="tag">Host</span>');
        return `<li>${avatar(p.displayName)}<span class="who-col"><span class="name">${esc(p.displayName)}${v.me && p.userId === v.me.id ? ' <span class="muted small">(you)</span>' : ''}</span>${tags.length ? `<span class="tags">${tags.join('')}</span>` : ''}</span>
          ${v.status !== 'lobby' ? scoreCell(p) : ''}</li>`;
      }).join('')}</ul>`;
    }

    // Each player's guess score: points, plus correct out of guesses so far.
    function scoreCell(p) {
      const pct = p.attempts ? Math.round((100 * p.points) / p.attempts) : null;
      return `<span class="pts"><span class="pts-main">${p.points} pt${p.points === 1 ? '' : 's'}</span>
        <span class="pts-sub">${p.attempts ? `${p.points}/${p.attempts} · ${pct}%` : 'no guesses yet'}</span></span>`;
    }

    function shareCard() {
      return `<div class="card share">
        <div class="muted small">Invite friends with this code</div>
        <div class="big-code">${esc(code)}</div>
        <div class="link">${esc(shareUrl)}</div>
        <div class="row" style="justify-content:center">
          <button class="btn" data-act="share">Share invite</button>
          <button class="btn ghost" data-act="copy">Copy link</button>
        </div>
      </div>`;
    }

    function nextPlayerName(v) {
      const r = v.round;
      if (!r) return '';
      const players = v.players;
      const i = players.findIndex((p) => p.userId === r.subject.userId);
      const n = players[(i + 1) % players.length];
      return n ? n.displayName : '';
    }

    function categoriesBlock(v) {
      if (!v.isOwner) return '';
      const canEdit = v.status === 'lobby' || (v.round && (v.round.phase === 'revealed' || v.round.phase === 'answering'));
      if (!canEdit) return '';
      return `<div class="card">
        ${editingCats
          ? `<h2>Edit the paper</h2><div id="cat-editor"></div>
             <div class="row" style="margin-top:14px"><button class="btn" data-act="save-cats">Save categories</button><button class="btn ghost" data-act="cancel-cats">Cancel</button></div>`
          : `<div class="section-title"><h2>On the paper</h2><button class="btn link sm" data-act="edit-cats">Change</button></div>
             <p class="small" style="margin-bottom:10px"><span class="tag coral">${v.guessCount} guess${v.guessCount === 1 ? '' : 'es'} per category</span></p>
             ${v.shuffle ? `<p class="muted small">🎲 Every turn gets ${v.categories.length} new random categories.</p>` : `<div class="chips">${v.categories.map((c) => `<span class="chip" style="padding-right:12px">${esc(c)}</span>`).join('')}</div>`}`}
      </div>`;
    }

    function roundPanel(v) {
      const r = v.round;
      const subj = esc(r.subject.displayName);
      const phases = ['answering', 'guessing', 'revealed'];
      const dots = `<div class="phase-dots">${['Writing', 'Guessing', 'Reveal'].map((l, i) => `<span class="${phases[i] === r.phase ? 'on' : ''}">${l}</span>`).join('')}</div>`;
      const dkey = (id) => `${code}:${r.number}:${id}`;

      if (r.phase === 'answering') {
        if (r.isSubject) {
          return `<div class="card turn-banner"><div class="who">Your turn!</div><div class="what">Fill in your secret answers. Nobody sees them until the reveal.</div>${dots}</div>
            <form id="answers" class="card paper-card qa" autocomplete="off">
              ${r.categories.map((c) => `<div class="q"><div class="q-head"><label for="a${c.id}">${esc(c.label)}</label>
                ${r.categories.length > 1 ? `<button type="button" class="btn link sm" data-rmcat="${c.id}" aria-label="Remove ${esc(c.label)}">Remove</button>` : ''}</div>
                <input id="a${c.id}" name="${c.id}" data-draft="${dkey('a' + c.id)}" maxlength="80" required autocomplete="off"></div>`).join('')}
              <div class="add-own">
                <label for="owncat" class="small muted" style="font-family:var(--sans);font-size:.85rem">Add your own category</label>
                <div class="join-box"><input id="owncat" data-draft="${dkey('owncat')}" maxlength="40" placeholder="e.g. Favorite cousin"><button type="button" class="btn ghost" data-act="addcat">Add</button></div>
              </div>
              <button class="btn big coral" type="submit">Lock in my answers 🔒</button>
            </form>`;
        }
        return `<div class="card turn-banner"><div class="who">${subj} is writing…</div><div class="what">Get ready! You'll get ${v.guessCount === 1 ? 'one guess' : v.guessCount + ' guesses'} per category for:</div>
            <div class="chips" style="justify-content:center;margin-top:10px">${r.categories.map((c) => `<span class="chip" style="padding-right:12px">${esc(c.label)}</span>`).join('')}</div>
            <div class="waiting"><span class="dot-pulse"></span> Waiting for ${subj} to lock in</div>${dots}
            ${v.isOwner ? `<button class="btn link sm" data-act="skip">Skip ${subj}'s turn</button>` : ''}</div>`;
      }

      if (r.phase === 'guessing') {
        const waiting = r.waitingOn.length
          ? `<div class="waiting"><span class="dot-pulse"></span> Waiting on ${esc(r.waitingOn.join(', '))}</div>` : '';
        const revealBtn = (r.isSubject || v.isOwner) && r.submitted.length
          ? `<button class="btn ${r.isSubject ? 'coral big' : 'ghost'}" data-act="reveal">Reveal now (${r.submitted.length} guessed)</button>` : '';
        if (r.isSubject) {
          return `<div class="card turn-banner"><div class="who">They're guessing you 👀</div>
            <div class="what">${r.submitted.length} of ${v.players.length - 1} have locked in. It reveals automatically when everyone's done.</div>${waiting}${dots}</div>
            <div class="card paper-card"><h2>Your answers</h2>
              ${r.categories.map((c) => `<p><strong>${esc(c.label)}:</strong> ${esc(c.answer)}</p>`).join('')}</div>
            ${revealBtn ? `<div class="sticky-actions">${revealBtn}</div>` : ''}`;
        }
        if (r.myGuesses) {
          return `<div class="card turn-banner"><div class="who">Locked in ✓</div><div class="what">Now we wait for the reveal.</div>${waiting}${dots}</div>
            <div class="card paper-card"><h2>Your guesses for ${subj}</h2>
              ${r.categories.map((c) => `<p><strong>${esc(c.label)}:</strong> ${r.myGuesses[c.id] && r.myGuesses[c.id].length ? r.myGuesses[c.id].map(esc).join(' · ') : '<span class="muted">(skipped)</span>'}</p>`).join('')}</div>
            ${revealBtn ? `<div class="center">${revealBtn}</div>` : ''}`;
        }
        return `<div class="card turn-banner"><div class="who">Guess ${subj}'s answers</div><div class="what">Think like ${subj}. ${v.guessCount > 1 ? `Up to ${v.guessCount} guesses per category, any match scores.` : 'One guess each.'} Close spelling still counts.</div>${dots}</div>
          <form id="guesses" class="card paper-card qa" autocomplete="off">
            ${r.categories.map((c) => `<div class="q"><label for="g${c.id}-0">${esc(c.label)}</label>
              <div class="${v.guessCount > 1 ? 'multi' : ''}">${Array.from({ length: v.guessCount }, (_, i) => `
                <input id="g${c.id}-${i}" name="${c.id}" data-draft="${dkey('g' + c.id + '-' + i)}" maxlength="80" autocomplete="off"
                  placeholder="${v.guessCount === 1 ? `${subj}'s ${esc(c.label.toLowerCase())}?` : `Guess ${i + 1}`}" aria-label="${esc(c.label)} guess ${i + 1}">`).join('')}</div></div>`).join('')}
            <button class="btn big coral" type="submit">Lock in my guesses</button>
          </form>
          ${revealBtn ? `<div class="center">${revealBtn}</div>` : ''}`;
      }

      // revealed
      const canJudge = r.isSubject || v.isOwner;
      const results = r.results || [];
      const best = results[0];
      const cats = r.categories.map((c) => `
        <div class="card reveal-cat">
          <div class="label">${esc(c.label)}</div>
          <div class="answer">${esc(c.answer)}</div>
          <div class="guess-list">${results.map((p) => {
            const g = p.answers[c.id] || { value: '', correct: false };
            const inner = `<span class="mark">${g.correct ? '✓' : '✗'}</span><span class="who">${esc(p.displayName)}</span>
              <span class="val ${g.value ? '' : 'empty'}">${(g.values || (g.value ? [g.value] : [])).length
                ? (g.values || [g.value]).map((x, i) => `<span class="${i === g.hit ? 'hit' : (g.values || []).length > 1 ? 'miss' : ''}">${esc(x)}</span>`).join('<span class="sep"> · </span>')
                : 'no guess'}</span>${g.overridden ? '<span class="edited">judged</span>' : ''}`;
            return canJudge
              ? `<button class="guess ${g.correct ? 'ok' : ''}" data-judge="${p.userId}:${c.id}:${g.correct ? 0 : 1}" title="Tap to mark ${g.correct ? 'wrong' : 'right'}">${inner}</button>`
              : `<div class="guess ${g.correct ? 'ok' : ''}">${inner}</div>`;
          }).join('') || '<span class="muted small">Nobody guessed.</span>'}</div>
        </div>`).join('');
      const total = r.categories.length;
      return `<div class="card turn-banner">
          <div class="who">${r.isSubject ? 'Your answers are out!' : `${subj}'s answers`}</div>
          <div class="what">${best && best.score > 0 ? `${esc(best.displayName)} knows ${r.isSubject ? 'you' : subj} best this round with ${best.score}/${total}` : 'Nobody got any right. Mysterious!'}</div>${dots}
        </div>
        <div class="card"><h2>Round ${r.number} scores</h2>
          <div class="podium">${results.map((p, i) => `<div class="place ${i === 0 && p.score > 0 ? 'first' : ''}"><span class="rank">${i + 1}</span>${avatar(p.displayName)}<span class="name">${esc(p.displayName)}</span><span class="score">${p.score}/${total}</span></div>`).join('')}</div>
        </div>
        ${canJudge ? '<p class="muted small center" style="margin:14px 0 0">Tap a guess to mark it right or wrong ("close enough!").</p>' : ''}
        <div style="margin-top:12px">${cats}</div>
        ${(r.isSubject || v.isOwner) && v.status === 'playing'
          ? `<div class="sticky-actions"><button class="btn big coral" data-act="next">Next turn: ${esc(nextPlayerName(v))} →</button></div>`
          : (v.status === 'playing' ? `<p class="center muted" style="margin-top:16px">Waiting for ${subj} to pass the turn…</p>` : '')}`;
    }

    function draw() {
      const v = view;
      if (!state.user) {
        render(`<div class="card center stack">
          <h1>You're invited!</h1>
          <p class="muted">Join <strong>${esc(v.name)}</strong> and guess your friends' answers. You'll need a free account so your stats are saved.</p>
          <a class="btn big coral" href="${signupLink('/r/' + code)}" data-link>Sign up & join</a>
          <a class="btn big ghost" href="${loginLink('/r/' + code)}" data-link>Log in</a>
        </div>`);
        return;
      }
      const head = `<div class="room-head"><div><div class="code-pill">Room ${esc(code)}</div><h1>${esc(v.name)}</h1></div>
        ${v.isOwner && v.status !== 'finished' ? `<button class="btn danger sm" data-act="end">End game</button>` : ''}
        ${!v.isOwner && v.isMember && v.status !== 'finished' ? `<button class="btn ghost sm" data-act="leave">Leave</button>` : ''}</div>`;

      if (v.status === 'lobby') {
        render(`${head}
          ${shareCard()}
          ${!v.isOwner ? `<div class="card center"><span class="tag coral">${v.guessCount} guess${v.guessCount === 1 ? '' : 'es'} per category</span> ${v.shuffle ? '<span class="tag">🎲 Random categories</span>' : ''}</div>` : ''}
          <div class="card"><div class="section-title"><h2>Players (${v.players.length})</h2></div>${playerList(v)}
            ${v.players.length < 2 ? '<p class="muted small" style="margin:10px 0 0">Waiting for at least one more player…</p>' : ''}</div>
          ${categoriesBlock(v)}
          ${v.isOwner
            ? `<div class="sticky-actions"><button class="btn big coral" data-act="start" ${v.players.length < 2 ? 'disabled' : ''}>Start game</button></div>`
            : `<div class="card"><div class="waiting"><span class="dot-pulse"></span> Waiting for the host to start…</div></div>`}`);
      } else if (v.status === 'finished') {
        const ranked = [...v.players].sort((a, b) => b.points - a.points);
        render(`${head}
          <div class="card turn-banner"><div class="who">Game over 🏆</div>
            <div class="what">${ranked[0] && ranked[0].points > 0 ? `${esc(ranked[0].displayName)} knows everyone best!` : 'Thanks for playing!'}</div></div>
          <div class="card"><h2>Final scores</h2><div class="podium">${ranked.map((p, i) => `<div class="place ${i === 0 && p.points > 0 ? 'first' : ''}"><span class="rank">${i + 1}</span>${avatar(p.displayName)}<span class="name">${esc(p.displayName)}</span><span class="score">${p.points} pts <span class="muted small">(${p.points}/${p.attempts})</span></span></div>`).join('')}</div></div>
          ${historyBlock(v)}
          <div class="row" style="margin-top:16px"><a class="btn big coral grow" href="/new?cats=${encodeURIComponent(v.categories.join('|'))}" data-link>Play again</a></div>`);
      } else {
        render(`${head}
          ${v.round ? roundPanel(v) : ''}
          <div class="card" style="margin-top:16px"><div class="section-title"><h2>Leaderboard</h2><span class="muted small">Turn ${v.round ? v.round.number : 1}</span></div>${playerList(v, v.round)}</div>
          ${categoriesBlock(v)}
          ${historyBlock(v)}
          <details class="card"><summary>Invite more friends</summary>${shareCard().replace('class="card share"', 'class="share"')}</details>`);
      }

      if (editingCats) {
        const el = document.getElementById('cat-editor');
        if (el) categoryEditor(el, v.categories, (c, sh, gc) => { pendingCats = c; pendingShuffle = sh; pendingMode = gc; }, { shuffle: v.shuffle, guessCount: v.guessCount });
      }
    }
    let pendingCats = null;
    let pendingShuffle = null;
    let pendingMode = null;

    function historyBlock(v) {
      if (!v.history.length) return '';
      return `<div class="card"><h2>Past turns</h2><ul class="list">${v.history.map((h) =>
        `<li><span class="grow"><strong>Turn ${h.number}:</strong> ${esc(h.subject)}'s paper</span><span class="muted small">${h.best && h.best.score ? `${esc(h.best.displayName)} ${h.best.score}/${h.categories}` : 'no one scored'}</span></li>`).join('')}</ul></div>`;
    }

    async function onClick(e) {
      const j = e.target.closest('[data-judge]');
      if (j) {
        const [userId, categoryId, correct] = j.dataset.judge.split(':').map(Number);
        return act('judge', { userId, categoryId, correct: !!correct });
      }
      const rm = e.target.closest('[data-rmcat]');
      if (rm) return act('my-categories', { remove: Number(rm.dataset.rmcat) });
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'copy') { await navigator.clipboard.writeText(shareUrl).catch(() => {}); toast('Link copied!'); }
      else if (a === 'share') {
        const text = `Play ${state.appName} with me! Can you guess my answers? Room code: ${code}`;
        if (navigator.share) navigator.share({ title: state.appName, text, url: shareUrl }).catch(() => {});
        else { await navigator.clipboard.writeText(`${text} ${shareUrl}`).catch(() => {}); toast('Invite copied! Paste it in your group chat.'); }
      }
      else if (a === 'start') act('start', {}, "Let's go!");
      else if (a === 'addcat') addOwnCategory();
      else if (a === 'reveal') act('reveal', {});
      else if (a === 'next') act('next', {});
      else if (a === 'skip') { if (confirm(`Skip ${view.round.subject.displayName}'s turn?`)) act('next', {}); }
      else if (a === 'end') { if (confirm('End the game for everyone?')) act('end', {}); }
      else if (a === 'leave') {
        if (!confirm('Leave this room?')) return;
        try { await api(`/rooms/${code}/leave`, {}); go('/'); } catch (err) { toast(err.message); }
      }
      else if (a === 'edit-cats') { await loadBank(); editingCats = true; pendingCats = view.categories; pendingShuffle = view.shuffle; pendingMode = view.guessCount; draw(); }
      else if (a === 'cancel-cats') { editingCats = false; draw(); }
      else if (a === 'save-cats') {
        editingCats = false;
        lastJson = '';
        await act('categories', { categories: pendingCats || view.categories, shuffle: pendingShuffle === null ? view.shuffle : pendingShuffle, guessCount: pendingMode || view.guessCount }, 'Paper updated');
        draw();
      }
    }

    async function addOwnCategory() {
      const input = document.getElementById('owncat');
      const label = input ? input.value.trim() : '';
      if (!label) return toast('Type a category first');
      delete drafts[input.dataset.draft];
      input.value = '';
      await act('my-categories', { label }, 'Added to your paper');
      const again = document.getElementById('owncat');
      if (again) again.focus();
    }

    async function onSubmit(e) {
      const form = e.target;
      if (form.id !== 'answers' && form.id !== 'guesses') return;
      e.preventDefault();
      const fd = new FormData(form);
      const values = {};
      for (const k of new Set(fd.keys())) values[k] = form.id === 'answers' ? fd.get(k) : fd.getAll(k).map((x) => x.trim()).filter(Boolean);
      if (form.id === 'guesses') {
        const filled = Object.values(values).filter((x) => x.length).length;
        if (!filled) return toast('Make at least one guess!');
        if (filled < Object.keys(values).length && !confirm('You left some categories blank. Lock in anyway?')) return;
      }
      form.querySelector('button[type=submit]').disabled = true;
      await act(form.id === 'answers' ? 'answers' : 'guess', form.id === 'answers' ? { answers: values } : { guesses: values }, form.id === 'answers' ? 'Answers locked in 🔒' : 'Guesses locked in!');
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = false;
    }

    const onKey = (e) => { if (e.target.id === 'owncat' && e.key === 'Enter') { e.preventDefault(); addOwnCategory(); } };
    $app.addEventListener('keydown', onKey);
    $app.addEventListener('click', onClick);
    $app.addEventListener('submit', onSubmit);

    // Live updates: the server pushes a ping whenever the room changes.
    let es = null;
    if (window.EventSource) {
      es = new EventSource(`/api/rooms/${code}/events`);
      es.addEventListener('update', () => load());
    }
    const poll = setInterval(() => { if (!document.hidden) load(); }, es ? 20000 : 4000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);

    cleanup = () => {
      $app.removeEventListener('click', onClick);
      $app.removeEventListener('keydown', onKey);
      $app.removeEventListener('submit', onSubmit);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(poll);
      if (es) es.close();
    };

    render(`<div class="loading">Loading room…</div>`);
    loadBank();
    await load();
  }

  async function pageStats() {
    if (!state.user) return go(loginLink('/stats'), true);
    render(`<div class="loading">Loading your stats…</div>`);
    let s;
    try { s = await api('/stats?tz=' + new Date().getTimezoneOffset()); } catch (err) { return render(errorBox(err)); }
    const max = Math.max(1, ...s.last14.map((d) => d.guesses));
    const dayLabel = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'narrow' });
    const pct = (x) => (x.total ? Math.round((100 * x.correct) / x.total) : 0);
    const since = s.firstDay ? new Date(s.firstDay + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const people = (list, empty) => list.length
      ? `<ul class="list">${list.map((p) => `<li>${avatar(p.name)}<span class="grow"><strong>${esc(p.name)}</strong><br><span class="muted small">${p.correct} of ${p.total} right</span></span>
          <div class="meter" aria-label="${pct(p)}%"><div style="width:${pct(p)}%"></div></div><strong style="width:44px;text-align:right">${pct(p)}%</strong></li>`).join('')}</ul>`
      : `<p class="muted small">${empty}</p>`;
    render(`
      <h1>${esc(state.user.displayName)}'s stats</h1>
      <p class="muted">${since ? `Playing since ${since}` : 'Play your first game to start your stats!'}</p>
      <div class="tiles">
        <div class="tile"><div class="v">${s.guessesMade}</div><div class="k">Guesses made</div></div>
        <div class="tile"><div class="v">${s.correct}</div><div class="k">Correct guesses</div></div>
        <div class="tile accent"><div class="v">${s.accuracy === null ? '–' : s.accuracy + '%'}</div><div class="k">Accuracy</div></div>
        <div class="tile"><div class="v">${s.daysPlayed}</div><div class="k">Days played</div></div>
        <div class="tile"><div class="v">${s.gamesPlayed}</div><div class="k">Games played</div></div>
        <div class="tile"><div class="v">${s.turnsGuessed}</div><div class="k">Papers guessed</div></div>
        <div class="tile"><div class="v">${s.turnsInHotSeat}</div><div class="k">Turns in hot seat</div></div>
        <div class="tile accent"><div class="v">${s.streak}🔥</div><div class="k">Day streak</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="section-title"><h2>Guesses, last 14 days</h2></div>
        <div class="bars" role="img" aria-label="Guesses per day over the last 14 days">
          ${s.last14.map((d) => `<div class="bar" title="${d.day}: ${d.guesses} guesses"><span class="n">${d.guesses || ''}</span><div class="fill ${d.guesses ? '' : 'zero'}" style="height:${(d.guesses / max) * 80}%"></div><span class="d">${dayLabel(d.day)}</span></div>`).join('')}
        </div>
      </div>
      <div class="two-col" style="margin-top:16px">
        <div class="card"><h2>Who knows you best</h2>${people(s.knowsMeBest, 'Take a turn in the hot seat to find out.')}</div>
        <div class="card"><h2>Who you know best</h2>${people(s.iKnowBest, 'Guess someone\'s paper to find out.')}</div>
      </div>
      ${s.rooms.length ? `<div class="card" style="margin-top:16px"><h2>Your rooms</h2><ul class="list">${s.rooms.map((r) => `
        <li><a class="grow" href="/r/${r.code}" data-link><strong>${esc(r.name)}</strong><br>
        <span class="muted small">${r.players} players · ${r.status === 'finished' ? 'Finished' : r.status === 'lobby' ? 'Lobby' : 'Playing'}${r.is_owner ? ' · You host' : ''}</span></a></li>`).join('')}</ul></div>` : ''}
      <hr><button class="btn ghost" id="logout">Log out</button>`);
    document.getElementById('logout').addEventListener('click', async () => {
      await api('/logout', {});
      state.user = null;
      renderNav();
      go('/');
    });
  }

  // ---------- router ----------
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    window.scrollTo(0, 0);
    const p = location.pathname;
    let m;
    if (p === '/') return pageHome();
    if (p === '/login') return pageAuth('login');
    if (p === '/signup') return pageAuth('signup');
    if (p === '/new') return pageNew();
    if (p === '/stats') return pageStats();
    if ((m = p.match(/^\/r\/([a-z0-9]+)\/?$/i))) return pageRoom(m[1].toLowerCase());
    render(`<div class="card center"><h2>Page not found</h2><a class="btn" href="/" data-link>Go home</a></div>`);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
  window.addEventListener('popstate', route);

  (async () => {
    try { const me = await api('/me'); state.user = me.user; if (me.appName) state.appName = me.appName; } catch {}
    renderNav();
    route();
  })();
})();
