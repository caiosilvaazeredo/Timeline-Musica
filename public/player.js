/* Vitrola, celular do jogador */
const socket = io();
const $ = (s) => document.querySelector(s);
// listener seguro: um elemento ausente (ex: cache misto de HTML/JS) nao derruba o script inteiro
function on(sel, ev, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(ev, fn);
  else console.warn('elemento ausente:', sel);
}

const decColor = (y) => `var(--d${Math.min(2020, Math.max(1930, Math.floor(y / 10) * 10))})`;

const CODE = new URLSearchParams(location.search).get('sala')?.toUpperCase() || '';
$('#join-code').textContent = CODE || '?????';

let ME = null;             // {playerId, token}
let STATE = null;
let selectedSlot = null;
let placingAs = null;      // 'turn' | 'contest' | null
let iContested = false;
let iPlacedContest = false;
let iGuessed = false;

// usar este aparelho como tela extra: espelha a partida (o codigo da sala tambem vale)
on('#btn-as-screen', 'click', () => {
  if (confirm('Usar este aparelho como tela? Ele passa a exibir a partida, sem controlar nada.')) {
    location.href = `/tv?tela=${CODE}`;
  }
});

// ---------------- troca de sala / salas publicas (tela de entrada) ----------------
on('#switch-form', 'submit', (e) => {
  e.preventDefault();
  const c = $('#switch-code').value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (c && c !== CODE) location.href = '/' + c;
});

const MODO_LABEL = { ORIGINAL: 'Original', PRO: 'PRO', EXPERT: 'Expert', EQUIPES: 'Equipes' };
async function loadPublicRoomsPlayer() {
  // so busca enquanto a tela de entrada estiver visivel
  if ($('#p-join').classList.contains('hidden')) return;
  try {
    const rooms = await (await fetch('/api/rooms/public')).json();
    const box = $('#public-rooms');
    const others = rooms.filter(r => r.code !== CODE);
    if (!others.length) { box.innerHTML = '<p class="public-empty">Nenhuma outra sala publica agora.</p>'; return; }
    box.innerHTML = '<p class="lbl">Salas publicas abertas</p>' + others.map(r => `
      <button type="button" class="room-row" data-code="${r.code}">
        <span class="rc num">${r.code}</span>
        <span class="rmodo">${MODO_LABEL[r.modo] || r.modo} · meta ${r.meta}</span>
        <span class="rcount num">${r.players}/${r.max}</span>
      </button>`).join('');
    box.querySelectorAll('.room-row').forEach(b =>
      b.addEventListener('click', () => location.href = '/' + b.dataset.code));
  } catch { /* mantem a lista anterior em falha temporaria */ }
}
loadPublicRoomsPlayer();
setInterval(loadPublicRoomsPlayer, 5000);

// ---------------- entrada ----------------
const PETS = ['cat','dog','fox','bunny','panda','lion','tiger','koala','penguin','monkey','pig','cow','deer','elephant','giraffe','bee','parrot','fish','crab','beaver','chick','polar','hog','caterpillar'];
const grid = $('#pet-grid');
PETS.forEach((petId, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.pet = petId;
  b.classList.add('loading');   // spinner ate a imagem chegar
  const img = document.createElement('img');
  img.alt = petId;
  img.addEventListener('load', () => b.classList.remove('loading'));
  img.addEventListener('error', () => b.classList.remove('loading'));
  img.src = `/pets/${petId}.png`;
  b.appendChild(img);
  if (i === 0) b.classList.add('sel');
  b.addEventListener('click', () => {
    grid.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  });
  grid.appendChild(b);
});

const saved = JSON.parse(sessionStorage.getItem(`vitrola_${CODE}`) || 'null');
if (saved?.token) join(saved.name, saved.pet, saved.token);

on('#btn-join', 'click', () => {
  const name = $('#join-name').value.trim();
  if (!name) return $('#join-error').textContent = 'Digite um nome para entrar.';
  const pet = grid.querySelector('.sel')?.dataset.pet || 'cat';
  join(name, pet, null);
});

function join(name, pet, token) {
  socket.emit('player:join', { code: CODE, name, pet, token }, (res) => {
    if (res?.error) { $('#join-error').textContent = res.error; return; }
    ME = { playerId: res.playerId, token: res.token, name, pet };
    sessionStorage.setItem(`vitrola_${CODE}`, JSON.stringify({ token: res.token, name, pet }));
    ['#me-pet', '#g-pet'].forEach(s => { const el = $(s); if (el) el.src = `/pets/${pet}.png`; });
    ['#me-name', '#g-name'].forEach(s => $(s).textContent = name);
    render(res.state);
  });
}

// animacao do meu pet conforme o momento do jogo
function petMood(mood) {
  const el = $('#g-pet');
  if (!el) return;
  el.classList.remove('happy', 'sad', 'excited');
  if (mood) { void el.offsetWidth; el.classList.add(mood); }
  if (mood === 'happy' || mood === 'sad') setTimeout(() => el.classList.remove(mood), 1000);
}

// reconexao do socket
socket.on('connect', () => {
  if (ME) socket.emit('player:join', { code: CODE, token: ME.token }, (res) => { if (res?.ok) render(res.state); });
});

// sair do lobby e voltar ao menu inicial (so antes da partida comecar)
on('#btn-leave-lobby', 'click', () => {
  if (confirm('Sair desta sala e voltar ao menu inicial?')) {
    sessionStorage.removeItem(`vitrola_${CODE}`);
    location.href = '/';
  }
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
  FX.theme(state.config.tema);
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
        `<li><img class="pet-avatar" src="/pets/${esc(x.pet)}.png" alt=""><span>${esc(x.name)}${x.id === ME.playerId ? ' (voce)' : ''}</span>${x.team ? `<span class="team-tag">${esc(x.team)}</span>` : ''}</li>`);
    });
  }

  if (state.state === 'playing' || state.state === 'paused') {
    $('#g-fichas').textContent = `${p.fichas} fichas`;
    $('#g-cartas').textContent = `${p.cartas}/${state.config.meta} cartas`;
    renderMyTimeline();
    syncPhase(state);
  }

  if (state.state === 'ended') {
    const winners = state.config.modo === 'EQUIPES'
      ? state.winner === p.team
      : state.winner === p.id;
    $('#end-msg').textContent = winners ? 'Voce venceu!' : 'Fim de jogo! Veja o placar na TV.';
    if (winners && !window._celebrated) { window._celebrated = true; FX.confetti(120); FX.vibrate([80, 60, 80, 60, 200]); }
  }
}

function syncPhase(state) {
  const isMyTurn = state.turnPlayerId === ME.playerId;
  const contestBtn = $('#btn-contest');
  const alreadyContested = state.contests.some(c => c.entityId === myEntityId());
  const isPaused = state.state === 'paused';

  show('#btn-replay', isMyTurn && state.phase && state.phase !== 'reveal');
  show('#btn-early-guess', isMyTurn && !iGuessed && (state.phase === 'placing' || state.phase === 'contest'));

  // botao de contestar: so habilita depois que o jogador da vez jogou
  const canContest =
    !isPaused &&
    state.phase === 'contest' &&
    !isMyTurn &&
    myEntityId() !== state.turnEntityId &&
    !alreadyContested &&
    (me()?.fichas ?? 0) > 0 &&
    state.contests.length < state.config.maxContestacoes;
  const wasDisabled = contestBtn.disabled;
  contestBtn.disabled = !canContest;
  if (wasDisabled && canContest) { FX.vibrate(35); FX.zoom(contestBtn); }

  if (state.phase === 'placing') {
    if (isMyTurn && placingAs !== 'turn') {
      FX.vibrate([60, 80, 60]);
      petMood('excited');
      openPlacer('turn', 'Sua vez! Sem pressa: o cronometro so liga se alguem apressar depois de 15s.');
    }
    if (!isMyTurn) {
      const t = state.players.find(x => x.id === state.turnPlayerId);
      status(`Vez de ${t?.name || '...'}. Contestar libera quando a carta for posicionada.`, '');
      hidePlacer();
      // apos 15s da rodada, libera o botao de apressar (se ninguem acionou ainda)
      clearTimeout(window._hurryTimer);
      if (!state.hurryActive && state.roundStartedAt) {
        const waitMs = Math.max(0, 15000 - (Date.now() - state.roundStartedAt));
        window._hurryTimer = setTimeout(() => {
          if (STATE?.phase === 'placing' && !STATE.hurryActive) show('#btn-hurry', true);
        }, waitMs);
      }
      if (state.hurryActive) show('#btn-hurry', false);
    }
  } else {
    show('#btn-hurry', false);
    clearTimeout(window._hurryTimer);
  }

  if (state.phase === 'contest' && !iContested && !isMyTurn) {
    status('Carta na mesa! Aperte CONTESTAR para disputar (custa 1 ficha).', 'hot');
  }
  if (state.phase === 'contest' && isMyTurn) {
    status('Carta posicionada. Aguarde possiveis contestacoes...', '');
  }

  // proximo jogador da vez inicia a rodada do celular
  const iAmNext = state.phase === 'reveal' && state.nextTurnPlayerId === ME.playerId && state.state === 'playing';
  const startBtn = $('#btn-start-round');
  if (iAmNext && startBtn.classList.contains('hidden')) { FX.vibrate([50, 60, 50]); }
  show('#btn-start-round', iAmNext);

  if (state.phase === 'guessing') openGuesser(state);
  if (state.phase === 'reveal' && state.reveal) showReveal(state.reveal);
  if (!state.phase) { hideAll(); status('Preparando a proxima rodada...', ''); }
}

// ---------------- rodadas ----------------
socket.on('round:start', () => {
  selectedSlot = null; placingAs = null; iContested = false; iPlacedContest = false; iGuessed = false;
  hideAll();
  show('#p-reveal', false);
  show('#btn-hurry', false);
  clearTimeout(window._hurryTimer);
  // limpa o que sobrou do palpite da musica anterior
  $('#guess-artist').value = ''; $('#guess-title').value = ''; $('#guess-year').value = '';
});

socket.on('contest:new', ({ playerId }) => {
  if (playerId === ME.playerId) {
    iContested = true;
    openPlacer('contest', 'Voce contestou! Agora e obrigado a posicionar na SUA linha do tempo.');
  }
});

socket.on('guess:open', () => { if (STATE) openGuesser(STATE); });

socket.on('round:reveal', showReveal);

socket.on('kicked', () => { sessionStorage.removeItem(`vitrola_${CODE}`); alert('Voce foi removido da sala.'); location.href = '/'; });
socket.on('room:closed', () => { sessionStorage.removeItem(`vitrola_${CODE}`); location.href = '/'; });

// ---------------- posicionamento ----------------
function openPlacer(mode, label) {
  placingAs = mode;
  selectedSlot = null;
  $('#placer-label').textContent = label;
  $('#btn-confirm-slot').disabled = true;
  buildTimelineSlots();
  show('#placer', true);
  show('#guesser', false);
  status(mode === 'turn' ? 'Ouca o trecho na TV e escolha o intervalo.' : 'Contestacao: escolha o intervalo na sua linha.', mode === 'turn' ? '' : 'hot');
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

on('#btn-confirm-slot', 'click', () => {
  if (selectedSlot === null) return;
  const ev = placingAs === 'turn' ? 'player:place' : 'player:contest-place';
  socket.emit(ev, { slot: selectedSlot }, (res) => {
    if (res?.error) return status(res.error, 'hot');
    if (placingAs === 'contest') iPlacedContest = true;
    hidePlacer();
    FX.vibrate(25);
    FX.flash('color-mix(in srgb, var(--ok) 35%, transparent)');
    status('Posicao confirmada. Cruze os dedos!', 'ok');
  });
});

// ---------------- contestacao ----------------
on('#btn-contest', 'click', () => {
  const btn = $('#btn-contest');
  btn.disabled = true;
  btn.classList.add('fx-ring', 'fired');
  setTimeout(() => btn.classList.remove('fired'), 650);
  FX.vibrate([40, 60, 40]);
  FX.flash('color-mix(in srgb, var(--hot) 50%, transparent)');
  socket.emit('player:contest', (res) => {
    if (res?.error) { status(res.error, 'hot'); return; }
    // abertura do placer chega via evento contest:new
  });
});

// ---------------- palpite ----------------
function openGuesser(state) {
  const modo = state.config.modo;
  const isMyTurn = state.turnPlayerId === ME.playerId;
  // regra: alem do jogador da vez, apenas quem contestou responde artista e musica
  if ((!isMyTurn && !iContested) || iGuessed) {
    show('#guesser', false);
    status(iGuessed ? 'Palpite enviado. Aguardando a revelacao...' : 'Janela de palpites: so o jogador da vez e os contestadores respondem.', '');
    return;
  }
  const mustGuess = (modo === 'PRO' || modo === 'EXPERT') && (isMyTurn || iContested);
  show('#guesser', true);
  show('#placer', false);
  $('#guess-year').classList.toggle('hidden', modo !== 'EXPERT');
  $('#guess-label').textContent = mustGuess
    ? `Modo ${modo}: acerte artista e musica${modo === 'EXPERT' ? ' e o ano exato' : ''} para valer a carta. Nao precisa escrever perfeito.`
    : 'Musica certa: +1 ficha. Artista certo: +1 ficha. Pode errar a grafia, a gente entende.';
  status('Janela de palpites aberta.', '');
}

on('#btn-guess', 'click', () => {
  socket.emit('player:guess', {
    artist: $('#guess-artist').value,
    title: $('#guess-title').value,
    year: $('#guess-year').value || null
  }, (res) => {
    if (res?.error) return status(res.error, 'hot');
    iGuessed = true;
    show('#guesser', false);
    show('#btn-early-guess', false);
    if (res.stopMusic) { FX.flash('color-mix(in srgb, var(--gold) 55%, transparent)'); FX.vibrate([30, 40, 30]); }
    status(res.stopMusic ? 'Musica cortada! Palpite registrado.' : 'Palpite enviado. Aguardando a revelacao...', 'ok');
    $('#guess-artist').value = ''; $('#guess-title').value = ''; $('#guess-year').value = '';
  });
});

// jogador da vez: responder antes da hora corta a musica na TV e dificulta contestacoes
on('#btn-early-guess', 'click', () => {
  const modo = STATE?.config.modo || 'ORIGINAL';
  $('#guess-year').classList.toggle('hidden', modo !== 'EXPERT');
  $('#guess-label').textContent = 'Responda para cortar a musica agora. Errar nao tira nada, acertar rende ficha.';
  show('#guesser', true);
});

on('#btn-skip-guess', 'click', () => {
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
    if (mine.keeps || mine.wins) { verdict = 'Carta e sua!'; cls = 'ok'; }
    else if (mine.posOk) { verdict = 'Posicao certa, mas a carta nao ficou.'; cls = ''; }
    else if (mine.slot === null) { verdict = 'Tempo esgotado, sem jogada.'; cls = 'bad'; }
    else { verdict = 'Posicao errada. Carta descartada.'; cls = 'bad'; }
  }
  const myFichas = results.fichasGanhas.find(f => f.playerId === ME.playerId);
  if (myFichas) {
    const what = myFichas.title && myFichas.artist ? 'musica e artista: +2 fichas' : myFichas.title ? 'a musica: +1 ficha' : 'o artista: +1 ficha';
    verdict += ` Acertou ${what}!`;
  }

  if (mine) {
    if (mine.keeps || mine.wins) { FX.flash('color-mix(in srgb, var(--ok) 50%, transparent)'); FX.vibrate([50, 50, 120]); FX.confetti(45); petMood('happy'); }
    else if (!mine.posOk) { FX.flash('color-mix(in srgb, var(--bad) 45%, transparent)'); FX.vibrate(180); FX.shake(); petMood('sad'); }
  } else {
    petMood(null);
  }
  const box = $('#p-reveal');
  box.classList.remove('flip-in'); void box.offsetWidth; box.classList.add('flip-in');
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
on('#btn-start-round', 'click', () => {
  show('#btn-start-round', false);
  FX.flash('color-mix(in srgb, var(--gold) 45%, transparent)');
  socket.emit('player:next-round');
});

on('#btn-replay', 'click', () => socket.emit('player:replay'));

on('#btn-hurry', 'click', () => {
  show('#btn-hurry', false);
  socket.emit('player:hurry', (res) => {
    if (res?.error) status(res.error, 'hot');
    else { FX.vibrate(30); status('Cronometro de 30s acionado!', 'hot'); }
  });
});

socket.on('hurry:started', ({ byName }) => {
  show('#btn-hurry', false);
  if (STATE?.turnPlayerId === ME.playerId) {
    FX.vibrate([80, 60, 80]);
    FX.flash('color-mix(in srgb, var(--hot) 40%, transparent)');
    status(`${byName} acionou o cronometro: 30 segundos!`, 'hot');
  }
});

document.querySelectorAll('.reactions button').forEach(b =>
  b.addEventListener('click', () => socket.emit('player:reaction', { text: b.dataset.r })));

on('#chat-form', 'submit', (e) => {
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
