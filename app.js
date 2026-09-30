(() => {
  'use strict';

  const API = ((window.QUOTER_CONFIG && window.QUOTER_CONFIG.apiBase) || 'http://localhost:5270/seinfeld/api').replace(/\/+$/, '');
  const TOKEN_KEY = 'quoter.token';
  const POSITION_KEY = 'quoter.position';
  const RECENT_LIMIT = 5;
  const LOOKUP_DELAY_MS = 250;

  const $ = (id) => document.getElementById(id);

  const el = {
    signin: $('signin'), signinForm: $('signin-form'), username: $('username'), password: $('password'),
    signinError: $('signin-error'), signinBtn: $('signin-btn'),
    app: $('app'), season: $('season'), episode: $('episode'),
    titleStatus: $('title-status'), titleShow: $('title-show'), titleText: $('title-text'),
    titleEdit: $('title-edit'), titleLabel: $('title-label'), titleInput: $('title-input'),
    titleSave: $('title-save'), titleCancel: $('title-cancel'), titleRetry: $('title-retry'), titleError: $('title-error'),
    form: $('quote-form'), quote: $('quote-text'), pills: $('pill-grid'), otherWrap: $('other-wrap'), otherName: $('other-name'),
    formError: $('form-error'), formStatus: $('form-status'), addBtn: $('add-btn'),
    recentList: $('recent-list'), recentEmpty: $('recent-empty'), signoutBtn: $('signout-btn'),
  };

  const state = {
    season: 1,
    episode: 1,
    // status: loading | found | missing | error
    ep: { status: 'loading', id: null, title: '' },
    titleEditing: false,
    speaker: null,
    saving: false,
    recent: [],
    editingId: null,
    lookupSeq: 0,
  };

  /* ---------- Storage (per-browser convenience only) ---------- */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) {
      try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* ignore */ }
    },
  };

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  // The API uses ReferenceHandler.Preserve, so arrays come back as { $id, $values: [...] }
  function unwrap(data) {
    if (Array.isArray(data)) return data.map(unwrap);
    if (data && typeof data === 'object') {
      if (Array.isArray(data.$values)) return data.$values.map(unwrap);
      const out = {};
      for (const [k, v] of Object.entries(data)) if (!k.startsWith('$')) out[k] = unwrap(v);
      return out;
    }
    return data;
  }

  function errorMessage(status, data) {
    if (status === 403) return 'Your account can’t make changes. Adding, editing and deleting need an Admin account.';
    if (status === 429) return 'Too many requests. The API allows 5 every 10 seconds, so give it a moment and try again.';
    if (data && typeof data === 'object') {
      if (data.message) return data.message;
      if (data.errors) {
        const first = Object.values(data.errors).flat()[0];
        if (first) return first;
      }
      if (data.title) return data.title;
    }
    if (typeof data === 'string' && data.trim()) return data;
    return `Something went wrong (HTTP ${status}).`;
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    const token = store.get(TOKEN_KEY);
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(`Can't reach the API at ${API}. Is it running?`, 0);
    }

    if (res.status === 401 && auth) {
      signOut('Your session expired. Sign in again.');
      throw new ApiError('Signed out.', 401);
    }

    const text = res.status === 204 ? '' : await res.text();
    let data = null;
    if (text) { try { data = unwrap(JSON.parse(text)); } catch { data = text; } }

    if (!res.ok) throw new ApiError(errorMessage(res.status, data), res.status);
    return data;
  }

  /* ---------- Auth ---------- */
  function tokenIsValid(token) {
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !payload.exp || payload.exp * 1000 > Date.now() + 30_000;
    } catch { return false; }
  }

  function showSignIn(message) {
    el.app.hidden = true;
    el.signin.hidden = false;
    el.signinError.textContent = message || '';
    el.password.value = '';
    (el.username.value ? el.password : el.username).focus();
  }

  function signOut(message) {
    store.set(TOKEN_KEY, null);
    showSignIn(message);
  }

  async function onSignIn(e) {
    e.preventDefault();
    const username = el.username.value.trim();
    const password = el.password.value;
    if (!username || !password) {
      el.signinError.textContent = 'Enter your username and password.';
      return;
    }
    el.signinBtn.disabled = true;
    el.signinError.textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password }, auth: false });
      store.set(TOKEN_KEY, data.token);
      el.password.value = '';
      startApp();
    } catch (err) {
      el.signinError.textContent = err.status === 401 ? 'Wrong username or password.' : err.message;
    } finally {
      el.signinBtn.disabled = false;
    }
  }

  /* ---------- Season / episode ---------- */
  function setPosition(season, episode) {
    season = Math.max(1, season | 0);
    episode = Math.max(1, episode | 0);
    const changed = season !== state.season || episode !== state.episode;
    state.season = season;
    state.episode = episode;
    renderSteppers();
    if (!changed) return;

    store.set(POSITION_KEY, JSON.stringify({ season, episode }));
    state.ep = { status: 'loading', id: null, title: '' };
    state.titleEditing = false;
    el.titleInput.value = '';
    renderTitle();
    clearTimeout(setPosition.timer);
    setPosition.timer = setTimeout(lookupEpisode, LOOKUP_DELAY_MS);
  }

  function renderSteppers() {
    el.season.value = state.season;
    el.episode.value = state.episode;
    document.querySelectorAll('.step-btn[data-dir="-1"]').forEach((btn) => {
      btn.disabled = state[btn.dataset.field] <= 1;
    });
  }

  function commitNumberInput(input) {
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n) || n < 1) { renderSteppers(); return; }
    if (input === el.season) setPosition(n, state.episode);
    else setPosition(state.season, n);
  }

  async function lookupEpisode() {
    const seq = ++state.lookupSeq;
    const { season, episode } = state;
    try {
      const ep = await api(`/episodes/lookup?season=${season}&episodeNumber=${episode}`);
      if (seq !== state.lookupSeq) return;
      state.ep = { status: 'found', id: ep.id, title: ep.title };
    } catch (err) {
      if (seq !== state.lookupSeq || err.status === 401) return;
      state.ep = err.status === 404
        ? { status: 'missing', id: null, title: '' }
        : { status: 'error', id: null, title: '', message: err.message };
    }
    renderTitle();
  }

  function renderTitle() {
    const { status } = state.ep;
    const editingExisting = status === 'found' && state.titleEditing;

    el.titleStatus.hidden = !(status === 'loading' || status === 'error');
    el.titleRetry.hidden = status !== 'error';
    el.titleShow.hidden = !(status === 'found' && !state.titleEditing);
    el.titleEdit.hidden = !(status === 'missing' || editingExisting);
    el.titleSave.hidden = !editingExisting;
    el.titleCancel.hidden = !editingExisting;
    el.titleError.textContent = '';

    if (status === 'loading') el.titleStatus.textContent = `Looking up S${state.season} E${state.episode}…`;
    if (status === 'error') el.titleStatus.textContent = `Couldn't load the episode. ${state.ep.message}`;
    if (status === 'found') {
      el.titleText.textContent = state.ep.title;
      el.titleShow.setAttribute('aria-label', `Episode title: ${state.ep.title}. Tap to edit.`);
    }
    el.titleLabel.textContent = editingExisting ? 'Episode title' : "New episode — what's it called?";

    updateAddButton();
  }

  function startTitleEdit() {
    state.titleEditing = true;
    el.titleInput.value = state.ep.title;
    renderTitle();
    el.titleInput.focus();
    el.titleInput.select();
  }

  function cancelTitleEdit() {
    state.titleEditing = false;
    renderTitle();
    el.titleShow.focus();
  }

  async function saveTitle() {
    const title = el.titleInput.value.trim();
    if (!title) {
      el.titleError.textContent = 'The title can’t be empty.';
      el.titleInput.focus();
      return;
    }
    if (title === state.ep.title) { cancelTitleEdit(); return; }

    el.titleSave.disabled = true;
    try {
      await api(`/episodes/${state.ep.id}/title`, { method: 'PUT', body: { title } });
      state.ep.title = title;
      state.recent.forEach((q) => { if (q.episodeId === state.ep.id) q.episodeTitle = title; });
      state.titleEditing = false;
      renderTitle();
      renderRecent();
      el.titleShow.focus();
      announce('Episode title updated.');
    } catch (err) {
      if (err.status !== 401) el.titleError.textContent = err.message;
    } finally {
      el.titleSave.disabled = false;
    }
  }

  /* ---------- Speaker pills ---------- */
  function selectSpeaker(name) {
    state.speaker = name;
    el.pills.querySelectorAll('.pill').forEach((pill) => {
      pill.setAttribute('aria-pressed', String(pill.dataset.speaker === name));
    });
    el.otherWrap.hidden = name !== 'Other';
    if (name !== 'Other') el.otherName.value = '';
  }

  function currentSpeaker() {
    if (state.speaker === 'Other') return el.otherName.value.trim();
    return state.speaker || '';
  }

  /* ---------- Add quote ---------- */
  function canSubmit() {
    if (state.saving) return false;
    if (state.ep.status === 'found') return true;
    return state.ep.status === 'missing' && el.titleInput.value.trim() !== '';
  }

  function updateAddButton() {
    el.addBtn.disabled = !canSubmit();
    el.addBtn.textContent = state.saving ? 'Saving…' : 'Add quote';
  }

  function showFormError(message, focusEl) {
    el.formError.textContent = message;
    el.formStatus.textContent = '';
    if (focusEl) focusEl.focus();
  }

  function announce(message) {
    el.formStatus.textContent = message;
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => { el.formStatus.textContent = ''; }, 2500);
  }

  async function submitQuote() {
    if (state.saving) return;
    el.formError.textContent = '';

    if (state.ep.status === 'missing' && !el.titleInput.value.trim()) {
      return showFormError('This is a new episode. Add its title first.', el.titleInput);
    }
    if (state.ep.status === 'loading') return showFormError('Still looking up the episode. Try again in a second.');
    if (state.ep.status === 'error') return showFormError('The episode lookup failed. Tap Retry above.');

    const text = el.quote.value.trim();
    if (!text) return showFormError('Type the line first.', el.quote);

    const speaker = currentSpeaker();
    if (!speaker) {
      return state.speaker === 'Other'
        ? showFormError('Type who said it.', el.otherName)
        : showFormError('Pick who said it.', el.pills.querySelector('.pill'));
    }

    const body = { text, speaker, season: state.season, episodeNumber: state.episode };
    if (state.ep.status === 'missing') body.episodeTitle = el.titleInput.value.trim();

    state.saving = true;
    updateAddButton();
    try {
      const saved = await api('/quotes', { method: 'POST', body });

      // The episode exists now (it may have just been created)
      if (saved.season === state.season && saved.episodeNumber === state.episode) {
        state.ep = { status: 'found', id: saved.episodeId, title: saved.episodeTitle };
        state.titleEditing = false;
        renderTitle();
      }

      state.recent = [saved, ...state.recent].slice(0, RECENT_LIMIT);
      renderRecent();

      el.quote.value = '';
      selectSpeaker(null);
      announce('Saved.');
    } catch (err) {
      if (err.status !== 401) showFormError(err.message);
    } finally {
      state.saving = false;
      updateAddButton();
      if (!el.app.hidden) el.quote.focus();
    }
  }

  /* ---------- Just added ---------- */
  async function loadRecent() {
    try {
      state.recent = await api(`/quotes/recent?limit=${RECENT_LIMIT}`);
      renderRecent();
    } catch (err) {
      if (err.status !== 401) {
        el.recentEmpty.hidden = false;
        el.recentEmpty.textContent = `Couldn't load recent quotes. ${err.message}`;
      }
    }
  }

  function make(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k in node && k !== 'list') node[k] = v; // input.list is read-only, so set it as an attribute
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) if (child != null) node.append(child);
    return node;
  }

  function renderRecent() {
    el.recentList.replaceChildren(...state.recent.map((q) => (q.id === state.editingId ? editItem(q) : viewItem(q))));
    el.recentEmpty.hidden = state.recent.length > 0;
    if (!state.recent.length) el.recentEmpty.textContent = 'Nothing yet. Yada yada yada.';
  }

  function viewItem(q) {
    const where = `S${q.season} E${q.episodeNumber}`;
    return make('li', { className: 'entry' }, [
      make('p', { className: 'entry-text', textContent: `“${q.text}”` }),
      make('p', { className: 'entry-meta' }, [
        make('span', { className: 'who', textContent: q.speaker }),
        ` · ${where}${q.episodeTitle ? ` · ${q.episodeTitle}` : ''}`,
      ]),
      make('div', { className: 'entry-actions' }, [
        make('button', { type: 'button', className: 'mini-btn ghost', textContent: 'Edit', dataset: { action: 'edit', id: q.id }, 'aria-label': `Edit quote by ${q.speaker}` }),
        make('button', { type: 'button', className: 'mini-btn danger', textContent: 'Delete', dataset: { action: 'delete', id: q.id }, 'aria-label': `Delete quote by ${q.speaker}` }),
      ]),
    ]);
  }

  function editItem(q) {
    const textId = `edit-text-${q.id}`;
    const speakerId = `edit-speaker-${q.id}`;
    return make('li', { className: 'entry entry-edit' }, [
      make('label', { className: 'field-label', htmlFor: textId, textContent: 'The line' }),
      make('textarea', { id: textId, value: q.text, maxLength: 1000 }),
      make('label', { className: 'field-label', htmlFor: speakerId, textContent: 'Who said it' }),
      make('input', { id: speakerId, className: 'text-input', value: q.speaker, maxLength: 100, autocomplete: 'off', list: 'speaker-names' }),
      make('p', { className: 'error', role: 'alert' }),
      make('div', { className: 'entry-actions' }, [
        make('button', { type: 'button', className: 'mini-btn', textContent: 'Save', dataset: { action: 'save', id: q.id } }),
        make('button', { type: 'button', className: 'mini-btn ghost', textContent: 'Cancel', dataset: { action: 'cancel', id: q.id } }),
      ]),
    ]);
  }

  async function onRecentClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const q = state.recent.find((x) => x.id === id);
    if (!q) return;

    switch (btn.dataset.action) {
      case 'edit':
        state.editingId = id;
        renderRecent();
        $(`edit-text-${id}`).focus();
        break;
      case 'cancel':
        state.editingId = null;
        renderRecent();
        focusRecentAction(id, 'edit');
        break;
      case 'save':
        await saveEdit(q, btn);
        break;
      case 'delete':
        await deleteQuote(q, btn);
        break;
    }
  }

  function focusRecentAction(id, action) {
    const target = el.recentList.querySelector(`button[data-action="${action}"][data-id="${id}"]`);
    if (target) target.focus();
  }

  async function saveEdit(q, btn) {
    const item = btn.closest('li');
    const errorEl = item.querySelector('.error');
    const text = $(`edit-text-${q.id}`).value.trim();
    const speaker = $(`edit-speaker-${q.id}`).value.trim();
    if (!text) { errorEl.textContent = 'The line can’t be empty.'; return; }
    if (!speaker) { errorEl.textContent = 'Who said it?'; return; }

    btn.disabled = true;
    try {
      await api(`/quotes/${q.id}`, { method: 'PUT', body: { text, speaker } });
      q.text = text;
      q.speaker = speaker;
      state.editingId = null;
      renderRecent();
      focusRecentAction(q.id, 'edit');
      announce('Quote updated.');
    } catch (err) {
      if (err.status !== 401) errorEl.textContent = err.message;
      btn.disabled = false;
    }
  }

  // Two taps to delete: the first arms the button for a few seconds
  async function deleteQuote(q, btn) {
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.textContent = 'Tap to confirm';
      clearTimeout(btn.resetTimer);
      btn.resetTimer = setTimeout(() => {
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
      }, 3000);
      return;
    }

    clearTimeout(btn.resetTimer);
    btn.disabled = true;
    try {
      await api(`/quotes/${q.id}`, { method: 'DELETE' });
      state.recent = state.recent.filter((x) => x.id !== q.id);
      renderRecent();
      announce('Quote deleted.');
      el.quote.focus();
      loadRecent(); // refill the list back up to 5
    } catch (err) {
      if (err.status === 404) { // already gone
        state.recent = state.recent.filter((x) => x.id !== q.id);
        renderRecent();
      } else if (err.status !== 401) {
        showFormError(err.message);
        btn.disabled = false;
      }
    }
  }

  /* ---------- Wiring ---------- */
  function startApp() {
    el.signin.hidden = true;
    el.app.hidden = false;
    state.ep = { status: 'loading', id: null, title: '' };
    renderSteppers();
    renderTitle();
    lookupEpisode();
    loadRecent();
    el.quote.focus();
  }

  function bind() {
    el.signinForm.addEventListener('submit', onSignIn);
    el.signoutBtn.addEventListener('click', () => signOut());

    document.querySelectorAll('.step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.dir);
        if (btn.dataset.field === 'season') setPosition(state.season + dir, state.episode);
        else setPosition(state.season, state.episode + dir);
      });
    });
    [el.season, el.episode].forEach((input) => {
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 3); });
      input.addEventListener('change', () => commitNumberInput(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitNumberInput(input); el.quote.focus(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? 1 : -1;
          if (input === el.season) setPosition(state.season + dir, state.episode);
          else setPosition(state.season, state.episode + dir);
        }
      });
    });

    el.titleShow.addEventListener('click', startTitleEdit);
    el.titleSave.addEventListener('click', saveTitle);
    el.titleCancel.addEventListener('click', cancelTitleEdit);
    el.titleRetry.addEventListener('click', () => { state.ep = { status: 'loading', id: null, title: '' }; renderTitle(); lookupEpisode(); });
    el.titleInput.addEventListener('input', updateAddButton);
    el.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.titleEditing) saveTitle();
        else el.quote.focus(); // new episode: title is saved along with the quote
      } else if (e.key === 'Escape' && state.titleEditing) {
        cancelTitleEdit();
      }
    });

    el.pills.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      selectSpeaker(pill.dataset.speaker);
      if (pill.dataset.speaker === 'Other') el.otherName.focus();
    });

    el.form.addEventListener('submit', (e) => { e.preventDefault(); submitQuote(); });
    el.quote.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitQuote();
      }
    });
    el.otherName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitQuote(); }
    });

    el.recentList.addEventListener('click', onRecentClick);
    el.recentList.addEventListener('keydown', (e) => {
      const item = e.target.closest('.entry-edit');
      if (!item) return;
      const id = item.querySelector('[data-action="save"]').dataset.id;
      if (e.key === 'Escape') item.querySelector('[data-action="cancel"]').click();
      else if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea, input')) {
        e.preventDefault();
        item.querySelector(`[data-action="save"][data-id="${id}"]`).click();
      }
    });
  }

  function init() {
    bind();

    try {
      const saved = JSON.parse(store.get(POSITION_KEY) || 'null');
      if (saved && saved.season >= 1 && saved.episode >= 1) {
        state.season = saved.season | 0;
        state.episode = saved.episode | 0;
      }
    } catch { /* ignore */ }

    if (tokenIsValid(store.get(TOKEN_KEY))) startApp();
    else signOut();
  }

  init();
})();
