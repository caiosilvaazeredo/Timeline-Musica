/* Hitster Digital, celular do jogador */
const socket = io();
const $ = (s) => document.querySelector(s);
const decColor = (y) => `var(--d${Math.min(2020, Math.max(1930, Math.floor(y / 10) * 10))})`;

const CODE = new URLSearchParams(location.search).get('sala')?.toUpperCase() || '';
$('#join-code').textContent = CODE || '?????';

let ME = null;             // {playerId, token}
let STATE = null;
let selectedSlot = null;
let placingAs = null;      // 'turn' | 'contest' | null
let iContested = false;
let iPlacedContest = false;

// ---------------- entrada ----------------
const EMOJIS = ['🎸','🎤','🎧','🥁','🎺','🎻','🪩','📻','🎹','🎷','🕺','💃'];
const grid = $('#emoji-grid');
EMOJIS.forEach((e, i) => {
  const b = document.createElement('button');
  b.textContent = e;
  b.type = 'button';
  if (i === 0) b.classList.add('sel');
  b.addEventListener('click', () => {
    grid.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  });
  grid.appendChild(b);
});

const saved = JSON.parse(localStorage.getItem(`hitster_${CODE}`) || 'null');
if (saved?.token) join(saved.name, saved.emoji, saved.token);

$('#btn-join').addEventListener('click', () => {
  const name = $('#join-name').value.trim();
  if (!name) return $('#join-error').textContent = 'Digite um nome para entrar.';
  const emoji = grid.querySelector('.sel')?.textContent || '🎵';
  join(name, emoji, null);
});

function join(name, emoji, token) {
  socket.emit('player:join', { code: CODE, name, emoji, token }, (res) => {
    if (res?.error) { $('#join-error').textContent = res.error; return; }
    ME = { playerId: res.playerId, token: res.token, name, emoji };
    localStorage.setItem(`hitster_${CODE}`, JSON.stringify({ token: res.token, name, emoji }));
    ['#me-emoji', '#g-emoji'].forEach(s => $(s).textContent = emoji);
    ['#me-name', '#g-name'].forEach(s => $(s).textContent = name);
    render(res.state);
  });
}

// reconexao do socket
socket.on('connect', () => {
  if (ME) socket.emit('player:join', { code: CODE, token: ME.token }, (res) => { if (res?.ok) render(res.state); });
});

// ---------------- equipes ----------------
document.querySelectorAll('.team-btns button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.team-btns button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    socket.emit('player:team', { team: b.dataset.team });
  });
});

// ---------------- estado ----------------
socket.on('state', render);

function me() { return STATE?.players.find(p => p.id === ME?.playerId); }
function myEntityId() {
  const p = me();
  return STATE?.config.modo === 'EQUIPES' ? p?.team : p?.id;
}
function myTimeline() { return me()?.timeline || []; }

function render(state) {
  if (!state || !ME) return;
  STATE = state;
  const p = me();
  if (!p) return;

  show('#p-join', false);
  show('#p-lobby', state.state === 'lobby');
  show('#p-game', state.state === 'playing' || state.state === 'paused');
  show('#p-end', state.state === 'ended');

  if (state.state === 'lobby') {
    show('#team-picker', state.config.modo === 'EQUIPES');
    const wantsSpotify = state.config.fonte === 'SPOTIFY';
    show('#btn-spotify-me', wantsSpotify && !state.spotifyConnected);
    show('#spotify-ok', wantsSpotify && state.spotifyConnected);
    $('#btn-spotify-me').href = `/auth/spotify?sala=${CODE}`;
    const ul = $('#lobby-list');
    ul.innerHTML = '';
    state.players.forEach(x => {
      ul.insertAdjacentHTML('beforeend',
        `<li><span>${esc(x.emoji)}</span><span>${esc(x.name)}${x.id === ME.playerId ? ' (voce)' : ''}</span>${x.team ? `<span class="team-tag">${esc(x.team)}</span>` : ''}</li>`);
    });
  }

  if (state.state === 'playing' || state.state === 'paused') {
    $('#g-fichas').textContent = `⛃ ${p.fichas} fichas`;
    $('#g-cartas').textContent = `${p.cartas}/${state.config.meta} cartas`;
    renderMyTimeline();
    syncPhase(state);
  }

  if (state.state === 'ended') {
    const winners = state.config.modo === 'EQUIPES'
      ? state.winner === p.team
      : state.winner === p.id;
    $('#end-msg').textContent = winners ? '🏆 Voce venceu!' : 'Fim de jogo! Veja o placar na TV.';
  }
}

function syncPhase(state) {
  const isMyTurn = state.turnPlayerId === ME.playerId;
  const contestBtn = $('#btn-contest');
  const alreadyContested = state.contests.some(c => c.entityId === myEntityId());
  const isPaused = state.state === 'paused';

  show('#btn-replay', isMyTurn && state.phase && state.phase !== 'reveal');

  // botao de contestar: so habilita depois que o jogador da vez jogou
  const canContest =
    !isPaused &&
    state.phase === 'contest' &&
    !isMyTurn &&
    myEntityId() !== state.turnEntityId &&
    !alreadyContested &&
    (me()?.fichas ?? 0) > 0 &&
    state.contests.length < state.config.maxContestacoes;
  contestBtn.disabled = !canContest;

  if (state.phase === 'placing') {
    if (isMyTurn && placingAs !== 'turn') openPlacer('turn', 'Sua vez! Onde essa musica entra na sua linha do tempo?');
    if (!isMyTurn) {
      const t = state.players.find(x => x.id === state.turnPlayerId);
      status(`🎶 Vez de ${t?.name || '...'}. Contestar libera quando a carta for posicionada.`, '');
      hidePlacer();
    }
  }

  if (state.phase === 'contest' && !iContested && !isMyTurn) {
    status('Carta na mesa! Aperte CONTESTAR para disputar (custa 1 ficha).', 'hot');
  }
  if (state.phase === 'contest' && isMyTurn) {
    status('Carta posicionada. Aguarde possiveis contestacoes...', '');
  }

  if (state.phase === 'guessing') openGuesser(state);
  if (state.phase === 'reveal' && state.reveal) showReveal(state.reveal);
  if (!state.phase) { hideAll(); status('Preparando a proxima rodada...', ''); }
}

// ---------------- rodadas ----------------
socket.on('round:start', () => {
  selectedSlot = null; placingAs = null; iContested = false; iPlacedContest = false;
  hideAll();
  show('#p-reveal', false);
});

socket.on('contest:new', ({ playerId }) => {
  if (playerId === ME.playerId) {
    iContested = true;
    openPlacer('contest', 'Voce contestou! Agora e obrigado a posicionar na SUA linha do tempo.');
  }
});

socket.on('guess:open', () => { if (STATE) openGuesser(STATE); });

socket.on('round:reveal', showReveal);

socket.on('kicked', () => { localStorage.removeItem(`hitster_${CODE}`); alert('Voce foi removido da sala.'); location.href = '/'; });
socket.on('room:closed', () => { localStorage.removeItem(`hitster_${CODE}`); location.href = '/'; });

// ---------------- posicionamento ----------------
function openPlacer(mode, label) {
  placingAs = mode;
  selectedSlot = null;
  $('#placer-label').textContent = label;
  $('#btn-confirm-slot').disabled = true;
  buildTimelineSlots();
  show('#placer', true);
  show('#guesser', false);
  status(mode === 'turn' ? '🎧 Ouca o trecho na TV e escolha o intervalo.' : '🔥 Contestacao: escolha o intervalo na sua linha.', mode === 'turn' ? '' : 'hot');
}

function hidePlacer() { show('#placer', false); placingAs = null; }
function hideAll() { hidePlacer(); show('#guesser', false); }

function buildTimelineSlots() {
  const tl = myTimeline();
  const box = $('#timeline');
  box.innerHTML = '';
  const addSlot = (i) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.type = 'button';
    b.textContent = '+';
    b.setAttribute('aria-label', `Inserir na posicao ${i + 1}`);
    b.addEventListener('click', () => {
      box.querySelectorAll('.slot').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      selectedSlot = i;
      $('#btn-confirm-slot').disabled = false;
    });
    box.appendChild(b);
  };
  addSlot(0);
  tl.forEach((c, i) => {
    box.insertAdjacentHTML('beforeend', cardHtml(c));
    addSlot(i + 1);
  });
}

$('#btn-confirm-slot').addEventListener('click', () => {
  if (selectedSlot === null) return;
  const ev = placingAs === 'turn' ? 'player:place' : 'player:contest-place';
  socket.emit(ev, { slot: selectedSlot }, (res) => {
    if (res?.error) return status(res.error, 'hot');
    if (placingAs === 'contest') iPlacedContest = true;
    hidePlacer();
    status('Posicao confirmada. Cruze os dedos!', 'ok');
  });
});

// ---------------- contestacao ----------------
$('#btn-contest').addEventListener('click', () => {
  $('#btn-contest').disabled = true;
  socket.emit('player:contest', (res) => {
    if (res?.error) { status(res.error, 'hot'); return; }
    // abertura do placer chega via evento contest:new
  });
});

// ---------------- palpite ----------------
function openGuesser(state) {
  const modo = state.config.modo;
  const isMyTurn = state.turnPlayerId === ME.playerId;
  const mustGuess = (modo === 'PRO' || modo === 'EXPERT') && (isMyTurn || iContested);
  show('#guesser', true);
  show('#placer', false);
  $('#guess-year').classList.toggle('hidden', modo !== 'EXPERT');
  $('#guess-label').textContent = mustGuess
    ? `Modo ${modo}: acerte artista e musica${modo === 'EXPERT' ? ' e o ano exato' : ''} para valer a carta.`
    : 'Sabe qual e? Acerte artista e musica e ganhe 1 ficha.';
  status('Janela de palpites aberta.', '');
}

$('#btn-guess').addEventListener('click', () => {
  socket.emit('player:guess', {
    artist: $('#guess-artist').value,
    title: $('#guess-title').value,
    year: $('#guess-year').value || null
  }, () => {
    show('#guesser', false);
    status('Palpite enviado. Aguardando a revelacao...', 'ok');
    $('#guess-artist').value = ''; $('#guess-title').value = ''; $('#guess-year').value = '';
  });
});

$('#btn-skip-guess').addEventListener('click', () => {
  show('#guesser', false);
  socket.emit('player:skip-guess');
  status('Sem palpite. Aguardando a revelacao...', '');
});

// ---------------- revelacao ----------------
function showReveal(results) {
  hideAll();
  const s = results.song;
  const mine =
    results.turn.playerId === ME.playerId ? results.turn :
    results.contests.find(c => c.playerId === ME.playerId) || null;

  let verdict = 'Rodada dos outros. Veja a TV!';
  let cls = '';
  if (mine) {
    if (mine.keeps || mine.wins) { verdict = '🎉 Carta e sua!'; cls = 'ok'; }
    else if (mine.posOk) { verdict = 'Posicao certa, mas a carta nao ficou.'; cls = ''; }
    else if (mine.slot === null) { verdict = 'Tempo esgotado, sem jogada.'; cls = 'bad'; }
    else { verdict = 'Posicao errada. Carta descartada.'; cls = 'bad'; }
  }
  if (results.fichasGanhas.includes(ME.playerId)) verdict += ' +1 ficha por acertar artista e musica!';

  const box = $('#p-reveal');
  box.style.setProperty('--dec', decColor(s.year));
  box.innerHTML = `
    <div class="big-year">${s.year}</div>
    <div><b>${esc(s.title)}</b></div>
    <div class="meta">Interprete: ${esc(s.artist)}${s.composer && s.composer !== s.artist ? `<br>Autor original: ${esc(s.composer)}` : ''}</div>
    <div class="verdict ${cls}">${verdict}</div>`;
  show('#p-reveal', true);
  status('Aguardando a proxima rodada...', '');
  renderMyTimeline();
}

// ---------------- extras ----------------
$('#btn-replay').addEventListener('click', () => socket.emit('player:replay'));

document.querySelectorAll('.reactions button').forEach(b =>
  b.addEventListener('click', () => socket.emit('player:reaction', { emoji: b.dataset.r })));

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#chat-input').value.trim();
  if (text) socket.emit('player:chat', { text });
  $('#chat-input').value = '';
});

// ---------------- render util ----------------
function renderMyTimeline() {
  const box = $('#my-timeline');
  box.innerHTML = myTimeline().map(cardHtml).join('');
}

function cardHtml(c) {
  return `<div class="card45" style="--dec:${decColor(c.year)}">
    <div class="year">${c.year}</div>
    <div class="song">${esc(c.title)}</div>
    <div class="who">${esc(c.artist)}</div>
  </div>`;
}

function status(msg, cls) {
  const el = $('#g-status');
  el.textContent = msg;
  el.className = 'g-status' + (cls ? ' ' + cls : '');
}
function show(sel, on) { $(sel).classList.toggle('hidden', !on); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
