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
let iPassed = false;      // ja declarei que nao vou contestar nesta rodada
let igSkipped = false;    // apertei "nao sei" no palpite inline

// usar este aparelho como tela extra: espelha a partida (o codigo da sala tambem vale)
on('#btn-as-screen', 'click', () => {
  if (confirm('Usar este aparelho como tela? Ele passa a exibir a partida, sem controlar nada.')) {
    location.href = `/tv?tela=${CODE}`;
  }
});

// ---------------- chat da sala (lobby) ----------------
on('#lobby-chat-form', 'submit', (e) => {
  e.preventDefault();
  const inp = $('#lobby-chat-input');
  const text = inp.value.trim();
  if (!text) return;
  socket.emit('player:chat', { text });
  inp.value = '';
});

socket.on('chat', ({ name, pet, text }) => {
  const log = $('#lobby-chat-log');
  if (!log) return;
  log.insertAdjacentHTML('beforeend', `<div class="msg">${petMini(pet)} <b>${esc(name)}:</b> ${esc(text)}</div>`);
  while (log.children.length > 40) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
});

// ---------------- correcao de dados (unanimidade) ----------------
function openFixForm(song) {
  if (!song) return;
  $('#fix-form').dataset.songId = song.id;
  $('#fx-title').value = song.title || '';
  $('#fx-artist').value = song.artist || '';
  $('#fx-composer').value = song.composer || '';
  $('#fx-year').value = song.year || '';
  show('#fix-form', true);
  show('#fix-vote', false);
}

on('#btn-fix-data', 'click', () => openFixForm(lastRevealSong));
on('#btn-fx-cancel', 'click', () => show('#fix-form', false));

on('#btn-fx-send', 'click', () => {
  const songId = $('#fix-form').dataset.songId;
  socket.emit('song:propose-fix', {
    songId,
    fields: {
      title: $('#fx-title').value,
      artist: $('#fx-artist').value,
      composer: $('#fx-composer').value,
      year: $('#fx-year').value
    }
  }, (res) => {
    if (res?.error) return status(res.error, 'hot');
    show('#fix-form', false);
    status('Proposta enviada! Vale se TODOS aprovarem.', 'ok');
  });
});

socket.on('fix:proposal', (fix) => renderFixVote(fix));
socket.on('fix:update', () => {});
socket.on('fix:applied', () => {
  show('#fix-vote', false); show('#fix-form', false);
  FX.confetti(30);
  status('Correcao aprovada por todos e salva!', 'ok');
});
socket.on('fix:rejected', () => {
  show('#fix-vote', false);
  status('Proposta de correcao recusada.', '');
});

function renderFixVote(fix) {
  if (!fix) { show('#fix-vote', false); return; }
  if (fix.proposedBy === ME.playerId || fix.approvals.includes(ME.playerId)) {
    show('#fix-vote', false);
    if (fix.proposedBy === ME.playerId) status(`Proposta em votacao: ${fix.approvals.length}/${fix.needed} aprovaram.`, '');
    return;
  }
  const changes = Object.entries(fix.fields)
    .map(([k, v]) => `${k === 'year' ? 'ano' : k}: ${fix.before[k]} -> ${v}`).join(' | ');
  $('#fix-vote-text').textContent = `${fix.proposerName} propos corrigir "${fix.before.title}" (${changes}). Aprova?`;
  show('#fix-vote', true);
}

on('#btn-fx-yes', 'click', () => { socket.emit('song:vote-fix', { approve: true }); show('#fix-vote', false); status('Voto registrado. Aguardando os demais...', ''); });
on('#btn-fx-no', 'click', () => { socket.emit('song:vote-fix', { approve: false }); show('#fix-vote', false); });

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
    FX.keepAwake();
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

function fmtInterval(itv) {
  if (!itv) return '';
  if (itv.left === null && itv.right === null) return 'na linha vazia';
  if (itv.left === null) return `antes de ${itv.right}`;
  if (itv.right === null) return `depois de ${itv.left}`;
  return `entre ${itv.left} e ${itv.right}`;
}
const petMini = (pet) => pet ? `<img class="pet-avatar" src="/pets/${esc(pet)}.png" alt="">` : '';
let lastRevealSong = null;   // para o botao "corrigir dados desta musica" 

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

  // proposta de correcao pendente sobrevive a reconexoes e vale tambem no fim de jogo
  if (state.pendingFix) renderFixVote(state.pendingFix);
  else show('#fix-vote', false);

  if (state.state === 'ended') {
    const es = $('#end-songs');
    if (es) {
      es.innerHTML = (state.playedSongs || []).map(s => `
        <div class="end-song" style="--dec:${decColor(s.year)}">
          <span><span class="es-y">${s.year}</span> <b>${esc(s.title)}</b></span>
          <button class="btn-ghost es-fix" data-id="${esc(s.id)}">Corrigir</button>
          <span class="es-i">${esc(s.artist)}${s.composer && s.composer !== s.artist ? ` | Autor: ${esc(s.composer)}` : ''}</span>
        </div>`).join('');
      es.querySelectorAll('.es-fix').forEach(b => b.addEventListener('click', () => {
        const song = (STATE?.playedSongs || []).find(x => x.id === b.dataset.id);
        openFixForm(song);
      }));
    }
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
  show('#btn-early-guess', false);   // substituido pelo palpite inline no placer

  // botao de contestar: so habilita depois que o jogador da vez jogou
  const canContest =
    !isPaused &&
    state.phase === 'contest' &&
    !isMyTurn &&
    myEntityId() !== state.turnEntityId &&
    !alreadyContested &&
    (me()?.fichas ?? 0) > 0;   // sem teto: contesta enquanto houver elegiveis
  const wasDisabled = contestBtn.disabled;
  contestBtn.disabled = !canContest;
  if (wasDisabled && canContest) { FX.vibrate(35); FX.zoom(contestBtn); }
  // "nao vou contestar": encerra a janela mais cedo quando todos se resolvem
  show('#btn-pass-contest', canContest && !iPassed);

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
      // o botao de apressar so aparece quando a musica termina
      clearTimeout(window._hurryTimer);
      if (!state.hurryActive && state.roundStartedAt) {
        const musicaMs = (state.config.duracaoTrechoSeg || 30) * 1000;
        const waitMs = Math.max(0, musicaMs - (Date.now() - state.roundStartedAt));
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

  renderTurnPreview(state, isMyTurn);

  // reconexao no meio da fila: se sou o contestador ativo, reabre o placer
  if (state.phase === 'contest' && state.activeContesterId === ME.playerId && iContested && !iPlacedContest && placingAs !== 'contest') {
    openPlacer('contest', 'Sua vez de contestar! Posicione na SUA linha do tempo.');
  }
}

// todos acompanham do celular a linha do tempo de quem esta jogando
function renderTurnPreview(state, isMyTurn) {
  const on = !isMyTurn && (state.phase === 'placing' || state.phase === 'contest') && state.turnPlayerId;
  show('#turn-preview', Boolean(on));
  if (!on) return;
  const t = state.players.find(x => x.id === state.turnPlayerId);
  if (!t) return;
  $('#turn-preview-label').textContent = `Linha do tempo de ${t.name} (a carta misteriosa entra ai)`;
  const cards = t.timeline.map(c =>
    `<div class="tl-card" style="--dec:${decColor(c.year)}"><span class="num">${c.year}</span><small>${esc(c.title)}</small></div>`);
  if (state.phase === 'contest' && state.turnPlacementSlot !== null && state.turnPlacementSlot !== undefined) {
    cards.splice(state.turnPlacementSlot, 0, '<div class="mystery-mini">?</div>');
  }
  $('#turn-preview-line').innerHTML = cards.join('');
}

// ---------------- rodadas ----------------
socket.on('round:start', () => {
  selectedSlot = null; placingAs = null; iContested = false; iPlacedContest = false; iGuessed = false;
  iPassed = false; igSkipped = false;
  hideAll();
  show('#p-reveal', false);
  show('#btn-hurry', false);
  show('#btn-pass-contest', false);
  $('#ig-artist').value = ''; $('#ig-title').value = ''; $('#ig-year').value = '';
  $('#inline-guess').classList.remove('skipped');
  $('#contest-log').innerHTML = ''; show('#contest-log', false);
  show('#turn-preview', false);
  show('#btn-fix-data', false); show('#fix-form', false); show('#fix-vote', false);
  clearTimeout(window._hurryTimer);
  // limpa o que sobrou do palpite da musica anterior
  $('#guess-artist').value = ''; $('#guess-title').value = ''; $('#guess-year').value = '';
});

socket.on('contest:new', ({ playerId }) => {
  if (playerId === ME.playerId) {
    iContested = true;
    status('Contestacao registrada! Aguarde sua vez na fila...', 'hot');
  }
});

// e a vez deste contestador posicionar (1 a 1, na ordem do aperto)
socket.on('contest:turn', ({ playerId }) => {
  if (playerId === ME.playerId && !iPlacedContest) {
    FX.vibrate([70, 60, 70]);
    openPlacer('contest', 'Sua vez de contestar! Posicione na SUA linha do tempo. O cronometro reiniciou para voce.');
  } else if (iContested && !iPlacedContest) {
    const q = STATE?.players.find(x => x.id === playerId);
    status(`${q?.name || 'Alguem'} esta posicionando. Voce e o proximo da fila!`, 'hot');
  }
});

// escolha de cada contestador visivel para todos (para o proximo escolher diferente)
socket.on('contest:placed', ({ playerId, name, pet, interval }) => {
  const log = $('#contest-log');
  show('#contest-log', true);
  log.insertAdjacentHTML('beforeend',
    `<div class="cl">${petMini(pet)} <span><b>${esc(name)}</b> apostou ${esc(fmtInterval(interval))}</span></div>`);
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
  // na minha vez, o palpite de artista/musica vem junto da posicao
  const inlineOn = mode === 'turn';
  show('#inline-guess', inlineOn);
  if (inlineOn) $('#ig-year').classList.toggle('hidden', STATE?.config.modo !== 'EXPERT');
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

on('#btn-ig-skip', 'click', () => {
  igSkipped = true;
  $('#ig-artist').value = ''; $('#ig-title').value = ''; $('#ig-year').value = '';
  $('#inline-guess').classList.add('skipped');
  status('Sem palpite. Escolha a posicao e confirme.', '');
});

on('#btn-confirm-slot', 'click', () => {
  if (selectedSlot === null) return;
  const wasTurn = placingAs === 'turn';
  const ev = wasTurn ? 'player:place' : 'player:contest-place';
  socket.emit(ev, { slot: selectedSlot }, (res) => {
    if (res?.error) return status(res.error, 'hot');
    if (placingAs === 'contest') iPlacedContest = true;

    // envia o palpite inline junto da jogada (corta a musica se tiver conteudo)
    if (wasTurn) {
      const artist = $('#ig-artist').value.trim();
      const title = $('#ig-title').value.trim();
      const year = $('#ig-year').value || null;
      const modoLivre = STATE?.config.modo !== 'PRO' && STATE?.config.modo !== 'EXPERT';
      if (artist || title || year) {
        socket.emit('player:guess', { artist, title, year }, () => { iGuessed = true; });
      } else if (igSkipped || modoLivre) {
        // "nao sei" (ou branco fora do PRO/Expert) ja conta como respondido
        socket.emit('player:guess', {}, () => { iGuessed = true; });
      }
      // PRO/Expert em branco sem "nao sei": a janela de palpite abre depois, pois vale a carta
    }

    hidePlacer();
    show('#inline-guess', false);
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
  // BUG corrigido: se contestei e ainda nao posicionei, o placer PERMANECE aberto
  if (!(placingAs === 'contest' && !iPlacedContest)) show('#placer', false);
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

on('#btn-pass-contest', 'click', () => {
  iPassed = true;
  show('#btn-pass-contest', false);
  $('#btn-contest').disabled = true;
  socket.emit('player:pass-contest', (res) => {
    if (res?.error) return status(res.error, 'hot');
    status('Beleza, sem contestacao. Aguardando os demais...', '');
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
  lastRevealSong = s;
  show('#btn-fix-data', true);
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
