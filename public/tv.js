/* Vitrola, TV */
const socket = io();
const $ = (s) => document.querySelector(s);
// listener seguro: um elemento ausente (ex: cache misto de HTML/JS) nao derruba o script inteiro
function on(sel, ev, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(ev, fn);
  else console.warn('elemento ausente:', sel);
}

const petImg = (p, cls='pet-img') => p ? `<img class="${cls}" src="/pets/${p}.png" alt="">` : '';
const decColor = (y) => `var(--d${Math.min(2020, Math.max(1930, Math.floor(y / 10) * 10))})`;

let ROOM = null;           // codigo da sala
let STATE = null;          // ultimo snapshot
let FEATURES = { spotify: false, youtube: false, preview: true };
let spotifyReady = false, spotifyDeviceId = null, spotifyPlayer = null;
let ytPlayer = null, ytReady = false;
let playTimer = null, progressTimer = null;

// ---------------- criacao / reconexao da sala ----------------
// O QR e o link de entrada usam sempre a URL que a propria TV esta usando agora
// (location.origin), entao nunca caem em localhost por esquecimento de variavel
// de ambiente. Um dominio curto customizado (JOIN_URL no servidor) sobrepõe isso
// quando configurado, para o modelo kahoot.it.
function buildJoinInfo(code, joinOverride) {
  const base = joinOverride || location.origin;
  const host = base.replace(/^https?:\/\//, '');
  return { url: `${base}/${code}`, host };
}

const MIRROR_CODE = new URLSearchParams(location.search).get('tela');
let IS_MIRROR = false;
if (MIRROR_CODE) {
  IS_MIRROR = true;
  socket.emit('screen:join', { code: MIRROR_CODE }, (res) => {
    if (res?.error) { alert(res.error); location.href = '/'; return; }
    enterMirrorMode(res.state);
  });
}

function enterMirrorMode(state) {
  // tela espelho: mostra tudo, controla nada e nao toca audio
  document.body.classList.add('mirror');
  $('#scr-mode-choice')?.classList.add('hidden');
  ['#btn-pause','#btn-skip','#btn-endroom','#btn-home-game','#btn-next'].forEach(sel => $(sel)?.classList.add('hidden'));
  const lobbyActions = document.querySelector('.lobby-actions');
  if (lobbyActions) lobbyActions.classList.add('hidden');
  ROOM = state.code;
  render(state);
  if (state.state === 'playing' || state.state === 'paused') {
    $('#scr-lobby').classList.add('hidden');
    $('#scr-game').classList.remove('hidden');
  } else {
    $('#scr-lobby').classList.remove('hidden');
  }
}

socket.on('screen:vinyl', ({ on }) => { if (IS_MIRROR) showVinyl(on); });
socket.on('screen:removed', () => { alert('Esta tela foi desconectada pelo host.'); location.href = '/'; });

const savedCode = sessionStorage.getItem('vitrola_tv_room');
if (MIRROR_CODE) { /* espelho nao cria nem retoma sala */ } else
if (savedCode) {
  socket.emit('tv:reclaim', { code: savedCode }, (res) => {
    if (res?.ok) bootRoom(savedCode, res, res.state);
    else showModeChoice();
  });
} else showModeChoice();

function showModeChoice() {
  $('#scr-mode-choice').classList.remove('hidden');
}

let pendingVisibility = 'private';
document.querySelectorAll('.vis-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.vis-btn').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    pendingVisibility = b.dataset.vis;
  });
});

document.querySelectorAll('.mc-quick').forEach(b =>
  b.addEventListener('click', () => startWithMode(b.dataset.quick)));
on('#mc-custom', 'click', () => startWithMode(null));

function startWithMode(quick) {
  $('#scr-mode-choice').classList.add('hidden');
  createRoom(quick, pendingVisibility);
  if (quick) {
    $('#config-body').classList.add('hidden');
    $('#btn-collapse-config').classList.remove('hidden');
  }
}

on('#btn-collapse-config', 'click', () => {
  const body = $('#config-body');
  body.classList.toggle('hidden');
  $('#btn-collapse-config').textContent = body.classList.contains('hidden') ? 'Ajustar configuracoes ▾' : 'Ocultar configuracoes ▴';
});

on('#vis-toggle', 'click', () => {
  const next = STATE?.visibility === 'public' ? 'private' : 'public';
  socket.emit('tv:set-visibility', { visibility: next });
});

function createRoom(quick, visibility) {
  socket.emit('tv:create', { quick, visibility: visibility || 'private' }, (res) => {
    sessionStorage.setItem('vitrola_tv_room', res.code);
    bootRoom(res.code, res, res.state);
  });
}

function bootRoom(code, res, state) {
  ROOM = code;
  $('#scr-mode-choice').classList.add('hidden');
  $('#scr-lobby').classList.remove('hidden');
  $('#lobby-code').textContent = code;
  const join = buildJoinInfo(code, res.joinOverride);
  $('#join-host').textContent = join.host;
  $('#join-code-inline').textContent = code;
  new QRCode($('#qrcode'), { text: join.url, width: 320, height: 320, colorDark: '#1B1226', colorLight: '#F4E8CF' });
  render(state);
  loadFeatures();
  loadDeckStats();
}

async function loadFeatures() {
  FEATURES = await (await fetch('/api/features')).json();
  updateFonteStatus();
}

async function loadDeckStats() {
  const s = await (await fetch('/api/songs/stats')).json();
  $('#deck-info').textContent = `Banco: ${s.total} musicas | ${s.br} BR | ${s.intl} internacionais`;
  const dmin = $('#cfg-dmin'), dmax = $('#cfg-dmax');
  s.decadas.forEach(d => {
    dmin.add(new Option(`Anos ${String(d).slice(2)}`, d));
    dmax.add(new Option(`Anos ${String(d).slice(2)}`, d));
  });
  dmin.value = s.decadas[0];
  dmax.value = s.decadas[s.decadas.length - 1];
}

// ---------------- configuracao ----------------
function pushConfig() {
  const config = {
    tema: $('#cfg-tema').value,
    modo: $('#cfg-modo').value,
    meta: Number($('#cfg-meta').value),
    fichasIniciais: Number($('#cfg-fichas').value),
    fonte: $('#cfg-fonte').value,
    duracaoTrechoSeg: Number($('#cfg-trecho').value),
    maxContestacoes: Number($('#cfg-contest').value),
    filtros: {
      origem: $('#cfg-origem').value,
      billboardUS: $('#cfg-bbus').checked,
      billboardBR: $('#cfg-bbbr').checked,
      decadaMin: Number($('#cfg-dmin').value),
      decadaMax: Number($('#cfg-dmax').value)
    }
  };
  socket.emit('tv:config', { config }, (res) => { if (res?.error) toast(res.error); });
  updateFonteStatus();
}
['#cfg-tema','#cfg-modo','#cfg-meta','#cfg-fichas','#cfg-fonte','#cfg-trecho','#cfg-contest','#cfg-origem','#cfg-bbus','#cfg-bbbr','#cfg-dmin','#cfg-dmax']
  .forEach(sel => $(sel).addEventListener('change', pushConfig));

let spotifyQrDrawn = false;
function updateFonteStatus() {
  const fonte = $('#cfg-fonte').value;
  const el = $('#fonte-status');
  const loginBox = $('#spotify-login');
  loginBox.classList.add('hidden');
  el.className = 'fonte-status';
  const connected = spotifyReady || STATE?.spotifyConnected;
  if (fonte === 'PREVIEW') {
    el.textContent = 'Pronto: trechos de 30 segundos via Deezer, nenhum login necessario.';
    el.classList.add('ok');
  } else if (fonte === 'SPOTIFY') {
    if (!FEATURES.spotify) {
      el.innerHTML = 'Quem hospeda o servidor precisa cadastrar 1 app gratis no Spotify (2 minutos, feito uma unica vez). Os jogadores nunca digitam chave nenhuma, so fazem login normal. Veja o README (SPOTIFY_CLIENT_ID).';
      el.classList.add('warn');
    }
    else if (connected) {
      el.textContent = 'Spotify conectado e pronto para tocar.'; el.classList.add('ok');
      if (STATE?.spotifyConnected && !spotifyReady) initSpotifySDK();
    }
    else {
      el.textContent = 'Conecte o Spotify de um jogador antes de comecar:'; el.classList.add('warn');
      loginBox.classList.remove('hidden');
      if (!spotifyQrDrawn) {
        new QRCode($('#spotify-qr'), {
          text: `${location.origin}/auth/spotify?sala=${ROOM}`,
          width: 120, height: 120, colorDark: '#1B1226', colorLight: '#F4E8CF'
        });
        spotifyQrDrawn = true;
      }
    }
  } else if (fonte === 'YOUTUBE') {
    el.textContent = 'Pronto: busca automatica no YouTube, sem login e sem chave de API.'; el.classList.add('ok'); ensureYouTube();
  }
}

on('#btn-spotify', 'click', () => {
  window.open(`/auth/spotify?sala=${ROOM}`, '_blank');
});

socket.on('spotify:connected', async () => {
  toast('Spotify conectado');
  await initSpotifySDK();
  updateFonteStatus();
});

// ---------------- lobby ----------------
on('#btn-lock', 'click', () => {
  socket.emit('tv:lock', { locked: !STATE?.locked });
});
on('#btn-start', 'click', () => {
  const fonte = $('#cfg-fonte').value;
  if (fonte === 'SPOTIFY' && !spotifyReady && !STATE?.spotifyConnected) {
    return toast('Conecte o Spotify de um jogador antes de comecar (QR na configuracao).');
  }
  if (fonte === 'SPOTIFY' && !spotifyReady) initSpotifySDK();
  socket.emit('tv:start', (res) => { if (res?.error) toast(res.error); });
});

// ---------------- controles do host ----------------
on('#btn-pause', 'click', () => socket.emit('tv:pause'));
on('#btn-resume', 'click', () => socket.emit('tv:resume'));
on('#btn-skip', 'click', () => { stopAudio(); socket.emit('tv:skip'); });
on('#btn-next', 'click', () => socket.emit('tv:next-round'));
on('#btn-endroom', 'click', () => { if (confirm('Encerrar a sala para todos?')) socket.emit('tv:end'); });

// voltar ao menu inicial: encerra a sala atual e volta pra tela de escolha de modo
function goHome() {
  if (confirm('Voltar ao menu inicial? Isso encerra a sala atual para todos.')) socket.emit('tv:end');
}
on('#btn-home-lobby', 'click', goHome);
on('#btn-home-game', 'click', goHome);
on('#btn-home-end', 'click', goHome);
on('#btn-rematch', 'click', () => socket.emit('tv:rematch'));
on('#btn-close', 'click', () => socket.emit('tv:end'));

// ---------------- eventos do jogo ----------------
socket.on('state', render);

socket.on('game:started', () => {
  $('#scr-lobby').classList.add('hidden');
  $('#scr-end').classList.add('hidden');
  $('#scr-game').classList.remove('hidden');
});

socket.on('round:start', async ({ number, turnPlayerId }) => {
  $('#reveal-panel').classList.add('hidden');
  $('#contest-strip').innerHTML = '';
  $('#turn-guess').classList.add('hidden');
  $('#turn-guess').textContent = '';
  const p = STATE?.players.find(x => x.id === turnPlayerId);
  const tb = $('#turn-banner');
  tb.innerHTML = `Rodada ${number}: vez de <strong>${esc(p?.name || '?')}</strong> ${petImg(p?.pet, 'pet-img big')}`;
  tb.classList.remove('slide-pop'); void tb.offsetWidth; tb.classList.add('slide-pop');
  $('#phase-status').textContent = 'Sorteando o proximo disco...';
  await playCurrentTrack();
});

socket.on('turn:placed', () => {
  clearInterval(window._cd);
  $('#phase-status').textContent = 'Carta posicionada. Janela de contestacao aberta: usem o botao no celular.';
  FX.zoom($('#phase-status'));
});

// outro jogador acionou o cronometro de 30s
socket.on('hurry:started', ({ seconds, byName }) => {
  toast(`${byName} acionou o cronometro!`);
  FX.flash('color-mix(in srgb, var(--hot) 35%, transparent)');
  countdown($('#phase-status'), seconds, 'Cronometro acionado! Tempo para jogar');
});

// palpite do jogador da vez exposto na tela junto do corte da musica
socket.on('turn:guessed', ({ name, pet, artist, title }) => {
  const el = $('#turn-guess');
  const parts = [];
  if (title) parts.push(`"${title}"`);
  if (artist) parts.push(`de ${artist}`);
  el.innerHTML = `${petImg(pet)} ${esc(name)} arriscou: ${esc(parts.join(' '))}`;
  el.classList.remove('hidden', 'slide-pop'); void el.offsetWidth; el.classList.add('slide-pop');
});

socket.on('contest:open', ({ seconds }) => {
  countdown($('#phase-status'), seconds, 'Contestacoes abertas');
});

socket.on('contest:new', ({ playerId, tie }) => {
  const p = STATE?.players.find(x => x.id === playerId);
  const chip = document.createElement('span');
  chip.className = 'contest-chip' + (tie ? ' tie' : '');
  chip.innerHTML = `${petImg(p?.pet, 'pet-img')} ${esc(p?.name || '?')} contestou!`;
  $('#contest-strip').appendChild(chip);
  FX.flash('color-mix(in srgb, var(--hot) 55%, transparent)');
  FX.shake();
  if (tie) toast('Contestacao simultanea: ordem definida por sorteio');
});

socket.on('guess:open', ({ seconds }) => {
  countdown($('#phase-status'), seconds, 'Palpites de artista e musica no celular');
});

socket.on('round:reveal', (results) => {
  stopAudio();
  clearInterval(window._cd);
  const s = results.song;
  const panel = $('#reveal-panel');
  const card = $('#reveal-card');
  card.style.setProperty('--dec', decColor(s.year));
  card.classList.remove('flip-in'); void card.offsetWidth; card.classList.add('flip-in');
  FX.countUp($('#reveal-year'), s.year, 900);
  $('#reveal-title').textContent = s.title;
  $('#reveal-artist').textContent = `Interprete: ${s.artist}`;
  $('#reveal-composer').textContent = s.composer && s.composer !== s.artist ? `Autor original: ${s.composer}` : `Autoria: ${s.composer || s.artist}`;

  const ul = $('#reveal-results');
  ul.innerHTML = '';
  const name = (id) => { const p = STATE?.players.find(x => x.id === id); return p ? `${petImg(p.pet)} ${esc(p.name)}` : id; };
  const t = results.turn;
  ul.insertAdjacentHTML('beforeend',
    `<li class="${t.keeps ? 'ok' : 'bad'}">${name(t.playerId)} ${t.slot === null ? 'nao posicionou a tempo' : t.posOk ? 'acertou a posicao' : 'errou a posicao'}${t.keeps ? ' e ficou com a carta' : ''}</li>`);
  results.contests.forEach(c => {
    ul.insertAdjacentHTML('beforeend',
      `<li class="${c.wins ? 'ok' : c.posOk ? '' : 'bad'}">${name(c.playerId)} contestou${c.tieBroken ? ' (sorteio)' : ''}: ${c.slot === null ? 'nao jogou' : c.posOk ? 'posicao correta' : 'posicao errada'}${c.wins ? ' e levou a carta!' : ''}</li>`);
  });
  results.fichasGanhas.forEach((f, i) => {
    const what = f.title && f.artist ? 'musica e artista: +2 fichas' : f.title ? 'a musica: +1 ficha' : 'o artista: +1 ficha';
    ul.insertAdjacentHTML('beforeend', `<li class="ok gain-line">${name(f.playerId)} acertou ${what}</li>`);
    setTimeout(() => coinFly(f.playerId, f.total), 500 + i * 350);
  });
  $('#phase-status').textContent = '';
  panel.classList.remove('hidden');
  if (results.cardWonBy) setTimeout(() => FX.confetti(70), 650);
});

socket.on('game:over', ({ winner, state }) => {
  STATE = state;
  stopAudio();
  FX.confetti(160);
  setTimeout(() => { showEnd(winner); FX.confetti(200); }, 2500);
});

socket.on('reaction', ({ pet, text }) => {
  const el = document.createElement('span');
  el.className = 'float-chip';
  el.innerHTML = `${petImg(pet)} ${esc(text)}`;
  el.style.left = (8 + Math.random() * 70) + 'vw';
  $('#reactions-layer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
});

socket.on('chat', ({ name, pet, text }) => {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `${petImg(pet)} <b>${esc(name)}:</b> ${esc(text)}`;
  const ticker = $('#chat-ticker');
  ticker.appendChild(el);
  while (ticker.children.length > 4) ticker.firstChild.remove();
  setTimeout(() => el.remove(), 8000);
});

socket.on('playback:replay', () => playCurrentTrack(true));

socket.on('playback:stop', () => {
  const disc = document.querySelector('#overlay-vinyl .vinyl');
  disc.classList.add('scratch');
  FX.flash('color-mix(in srgb, var(--gold) 60%, transparent)');
  setTimeout(() => { disc.classList.remove('scratch'); stopAudio(); }, 520);
  $('#phase-status').textContent = 'O jogador da vez cortou a musica para responder!';
});

socket.on('room:closed', () => {
  sessionStorage.removeItem('vitrola_tv_room');
  location.href = '/';
});

// ---------------- renderizacao ----------------
function render(state) {
  if (!state) return;
  STATE = state;
  FX.theme(state.config.tema);
  if ($('#cfg-tema').value !== state.config.tema) $('#cfg-tema').value = state.config.tema;

  // pilula de visibilidade
  const visBtn = $('#vis-toggle');
  const isPublic = state.visibility === 'public';
  visBtn.textContent = isPublic ? '🌍 Publica' : '🔒 Privada';
  visBtn.classList.toggle('public', isPublic);

  // lobby
  $('#player-count').textContent = `${state.players.filter(p => p.connected).length}/8`;
  $('#btn-lock').textContent = state.locked ? 'Liberar entradas' : 'Travar entradas';
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `${petImg(p.pet)} <span>${esc(p.name)}</span>
      ${p.team ? `<span class="team-tag">${esc(p.team)}</span>` : ''}
      ${state.state === 'lobby' ? `<button class="kick" title="Remover" data-id="${p.id}">✕</button>` : ''}`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.kick').forEach(b => b.addEventListener('click', () => socket.emit('tv:kick', { playerId: b.dataset.id })));
  if (state.state === 'lobby') updateFonteStatus();

  // telas conectadas
  if (state.screenCode) $('#screen-code').textContent = state.screenCode;
  const sl = $('#screens-list');
  if (sl) {
    sl.innerHTML = '<li>Tela principal (esta)</li>' + (state.screens || []).map(s =>
      `<li>Tela ${s.n}${IS_MIRROR ? '' : ` <button class="kick-screen" data-n="${s.n}" title="Desconectar">remover</button>`}</li>`).join('');
    sl.querySelectorAll('.kick-screen').forEach(b =>
      b.addEventListener('click', () => socket.emit('tv:kick-screen', { n: Number(b.dataset.n) })));
  }

  // pausa
  $('#pause-overlay').classList.toggle('hidden', state.state !== 'paused');

  // jogo
  if (state.state === 'playing' || state.state === 'paused') {
    $('#game-round').textContent = state.roundNumber ? `Rodada ${state.roundNumber}` : '';
    $('#deck-left').textContent = `Baralho: ${state.deckLeft}`;
    renderScoreboard(state);
    renderTurnLine(state);

    // revelacao: quem inicia a proxima rodada e o proprio proximo jogador, no celular
    if (state.phase === 'reveal' && state.nextTurnPlayerId) {
      const nx = state.players.find(p => p.id === state.nextTurnPlayerId);
      $('#next-wait').textContent = `Aguardando ${nx?.name || '...'} iniciar a proxima rodada no celular...`;
    } else {
      $('#next-wait').textContent = '';
    }
  }
}

// Linha do tempo do jogador da vez, com a carta misteriosa pulsando no
// intervalo escolhido assim que ele posiciona
function renderTurnLine(state) {
  const wrap = $('#turn-line-wrap');
  const showing = state.phase && state.phase !== 'reveal' && state.turnPlayerId;
  wrap.classList.toggle('hidden', !showing);
  if (!showing) return;
  const p = state.players.find(x => x.id === state.turnPlayerId);
  if (!p) return;
  const who = state.config.modo === 'EQUIPES' ? `equipe ${p.team}` : p.name;
  $('#turn-line-label').textContent = `Linha do tempo de ${who}`;
  const cards = p.timeline.map(c => `<div class="card45" style="--dec:${decColor(c.year)}">
    <div class="year">${c.year}</div><div class="song">${esc(c.title)}</div><div class="who">${esc(c.artist)}</div></div>`);
  if (state.turnPlaced && state.turnPlacementSlot !== null) {
    cards.splice(state.turnPlacementSlot, 0, `<div class="mystery-card" title="Carta da rodada">?</div>`);
  }
  $('#turn-line').innerHTML = cards.join('');
}

let lastRankOrder = [];
function renderScoreboard(state) {
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  const isTeams = state.config.modo === 'EQUIPES' && state.teams;
  let rows;
  if (isTeams) {
    rows = Object.entries(state.teams).map(([team, t]) => ({
      id: team, pet: null, label: `Equipe ${team}`, fichas: t.fichas, timeline: t.timeline, isTurn: state.turnEntityId === team
    }));
  } else {
    rows = state.players.map(p => ({
      id: p.id, pet: p.pet, label: `${p.name}${p.connected ? '' : ' (offline)'}`,
      fichas: p.fichas, timeline: p.timeline, isTurn: state.turnPlayerId === p.id
    }));
  }
  rows.sort((a, b) => b.timeline.length - a.timeline.length || b.fichas - a.fichas);

  const newOrder = rows.map(r => r.id);
  rows.forEach((r, i) => {
    const prev = lastRankOrder.indexOf(r.id);
    const movedUp = prev !== -1 && i < prev;   // subiu no ranking: animacao de ultrapassagem
    sb.appendChild(scoreCard(r, i + 1, movedUp));
  });
  lastRankOrder = newOrder;
}

function scoreCard(r, pos, movedUp) {
  const div = document.createElement('div');
  div.className = 'score-card' + (r.isTurn ? ' turn' : '') + (pos === 1 ? ' leader' : '') + (movedUp ? ' rank-up' : '');
  div.dataset.pid = r.id;
  div.innerHTML = `<div class="score-head">
      <span class="pos-badge num">${pos}º</span>
      ${petImg(r.pet)}
      <span class="score-name">${esc(r.label)}</span>
      <span class="fichas num"><span class="coin"></span> ${r.fichas} · ${r.timeline.length} cartas</span></div>
    <div class="mini-timeline">${r.timeline.map(c =>
      `<span class="mini-card" style="--dec:${decColor(c.year)}" title="${esc(c.title)} (${c.year})">${String(c.year).slice(2)}</span>`).join('')}</div>`;
  return div;
}

// moeda dourada voa da revelacao ate o card do jogador no ranking
function coinFly(playerId, total = 1) {
  const target = document.querySelector(`.score-card[data-pid="${playerId}"]`)
    || document.querySelector(`.score-card`);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  for (let i = 0; i < total; i++) {
    const coin = document.createElement('span');
    coin.className = 'coin coin-fly';
    coin.style.left = '50vw';
    coin.style.top = '50vh';
    coin.style.setProperty('--tx', `${rect.left + rect.width / 2 - innerWidth / 2}px`);
    coin.style.setProperty('--ty', `${rect.top + rect.height / 2 - innerHeight / 2}px`);
    coin.style.animationDelay = `${i * 180}ms`;
    document.body.appendChild(coin);
    setTimeout(() => coin.remove(), 1400 + i * 180);
  }
  setTimeout(() => { target.classList.add('gain'); FX.zoom(target); }, 900);
  setTimeout(() => target.classList.remove('gain'), 2400);
}

function showEnd(winner) {
  $('#scr-game').classList.add('hidden');
  $('#scr-end').classList.remove('hidden');
  const isTeams = STATE.config.modo === 'EQUIPES' && STATE.teams;
  let ranking;
  if (isTeams) {
    ranking = Object.entries(STATE.teams).map(([team, t]) => ({ label: `Equipe ${team}`, pet: null, cartas: t.cartas, timeline: t.timeline }));
  } else {
    ranking = STATE.players.map(p => ({ label: p.name, pet: p.pet, cartas: p.cartas, timeline: p.timeline }));
  }
  ranking.sort((a, b) => b.cartas - a.cartas);

  const podium = $('#podium');
  podium.innerHTML = '';
  const order = [1, 0, 2];
  order.forEach(i => {
    const r = ranking[i];
    if (!r) return;
    podium.insertAdjacentHTML('beforeend',
      `<div class="place p${i + 1}"><div class="pos">${i + 1}º</div>${petImg(r.pet, 'pet-img big')}<div>${esc(r.label)}</div><div class="num">${r.cartas} cartas</div></div>`);
  });

  const ft = $('#final-timelines');
  ft.innerHTML = '';
  ranking.forEach(r => {
    ft.insertAdjacentHTML('beforeend',
      `<div class="final-row"><div class="who">${petImg(r.pet)} ${esc(r.label)}</div><div class="cards">${
        r.timeline.map(c => `<div class="card45" style="--dec:${decColor(c.year)}">
          <div class="year">${c.year}</div><div class="song">${esc(c.title)}</div><div class="who">${esc(c.artist)}</div></div>`).join('')
      }</div></div>`);
  });
}

let playbackGen = 0; // invalida loops/retentativas de reproducoes anteriores

// ---------------- reproducao ----------------
async function playCurrentTrack(isReplay = false, attempt = 0) {
  if (IS_MIRROR) return;   // o som e da tela principal; o vinil chega via screen:vinyl
  stopAudio();                       // para o que estiver tocando (incrementa a geracao)
  const myGen = ++playbackGen;       // captura a geracao DEPOIS do stop, senao aborta a si mesma
  try {
    // o servidor ja troca a faixa sozinho em caso de falha; aqui so retentamos
    // a chamada algumas vezes sem alarde, para o jogador nunca ver erro
    const res = await fetch(`/api/resolve?sala=${ROOM}`);
    if (myGen !== playbackGen) return; // rodada mudou enquanto resolvia
    const info = await res.json();
    if (info.error) {
      if (attempt < 3) return setTimeout(() => playCurrentTrack(isReplay, attempt + 1), 1200);
      $('#phase-status').textContent = 'Preparando o som...';
      return;
    }

    showVinyl(true);
    const dur = (STATE?.config?.duracaoTrechoSeg || 30) * 1000;

    if (info.type === 'preview') {
      // o preview do Deezer dura uns 30s; se a duracao configurada for maior,
      // repete o trecho em loop ate completar o tempo pedido
      const a = $('#audio-preview');
      a.src = info.url;
      a.onended = () => { if (myGen === playbackGen) a.play()?.catch(() => {}); };
      await a.play()?.catch(() => toast('Clique na tela da TV para liberar o audio.'));
    } else if (info.type === 'youtube') {
      await ensureYouTube();
      if (myGen !== playbackGen) return;
      ytPlayer.loadVideoById(info.videoId);
      ytPlayer.playVideo();
    } else if (info.type === 'spotify') {
      await playSpotify(info.uri);
    }

    startProgress(dur);
    playTimer = setTimeout(() => stopAudio(), dur);
  } catch (e) {
    if (myGen !== playbackGen) return;
    if (attempt < 3) return setTimeout(() => playCurrentTrack(isReplay, attempt + 1), 1200);
    showVinyl(false);
    $('#phase-status').textContent = 'Preparando o som...';
  }
}

function stopAudio() {
  playbackGen++; // cancela qualquer loop ou retentativa em andamento
  clearTimeout(playTimer);
  clearInterval(progressTimer);
  const a = $('#audio-preview');
  a.onended = null;
  a.pause(); a.removeAttribute('src');
  try { ytPlayer?.stopVideo(); } catch {}
  try { if (spotifyDeviceId) fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${spotifyDeviceId}`, { method: 'PUT', headers: spotifyHeaders() }); } catch {}
  showVinyl(false);
}

function showVinyl(on) {
  $('#overlay-vinyl').classList.toggle('hidden', !on);
  if (on) $('#progress-bar').style.width = '0%';
  if (!IS_MIRROR) socket.emit('tv:vinyl', { on });   // espelhos seguem a principal
}

function startProgress(durMs) {
  const start = Date.now();
  progressTimer = setInterval(() => {
    const pct = Math.min(100, ((Date.now() - start) / durMs) * 100);
    $('#progress-bar').style.width = pct + '%';
    if (pct >= 100) clearInterval(progressTimer);
  }, 400);
}

function countdown(el, seconds, label) {
  clearInterval(window._cd);
  const total = seconds;
  let s = seconds;
  const draw = () => {
    const pct = Math.max(0, (s / total) * 100);
    el.innerHTML = `
      <div class="timer-pill ${s <= 5 ? 'urgent' : ''}">
        <span class="timer-label">${esc(label)}</span>
        <span class="timer-secs num">${s}s</span>
        <span class="timer-track"><span class="timer-bar" style="width:${pct}%"></span></span>
      </div>`;
  };
  draw();
  window._cd = setInterval(() => {
    s--;
    if (s <= 0) { clearInterval(window._cd); el.textContent = 'Calculando resultados...'; }
    else draw();
  }, 1000);
}

// ---------------- YouTube ----------------
function ensureYouTube() {
  return new Promise((resolve) => {
    if (ytReady) return resolve();
    window.onYouTubeIframeAPIReady = () => {
      ytPlayer = new YT.Player('yt-player', {
        height: '1', width: '1',
        playerVars: { autoplay: 0, controls: 0 },
        events: { onReady: () => { ytReady = true; resolve(); } }
      });
    };
    if (!document.getElementById('yt-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
}

// ---------------- Spotify (Web Playback SDK) ----------------
let spotifyToken = null;
function spotifyHeaders() { return { Authorization: `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' }; }

async function refreshSpotifyToken() {
  const r = await fetch(`/api/spotify/token?sala=${ROOM}`);
  if (!r.ok) return null;
  spotifyToken = (await r.json()).access_token;
  return spotifyToken;
}

function initSpotifySDK() {
  return new Promise(async (resolve) => {
    await refreshSpotifyToken();
    if (!spotifyToken) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => {
      spotifyPlayer = new Spotify.Player({
        name: 'Vitrola TV',
        getOAuthToken: async (cb) => cb(await refreshSpotifyToken()),
        volume: 0.9
      });
      spotifyPlayer.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
        spotifyReady = true;
        updateFonteStatus();
        resolve();
      });
      spotifyPlayer.addListener('initialization_error', () => resolve());
      spotifyPlayer.addListener('authentication_error', () => resolve());
      spotifyPlayer.connect();
    };
    if (!document.getElementById('sp-sdk')) {
      const tag = document.createElement('script');
      tag.id = 'sp-sdk';
      tag.src = 'https://sdk.scdn.co/spotify-player.js';
      document.body.appendChild(tag);
    } else if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
  });
}

async function playSpotify(uri) {
  if (!spotifyDeviceId) { await initSpotifySDK(); }
  if (!spotifyDeviceId) throw new Error('Spotify indisponivel');
  await refreshSpotifyToken();
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
    method: 'PUT',
    headers: spotifyHeaders(),
    body: JSON.stringify({ uris: [uri] })
  });
}

// ---------------- util ----------------
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// audio da TV precisa de um gesto do usuario em alguns navegadores
document.addEventListener('click', () => { $("#audio-preview").play()?.catch(() => {}); $('#audio-preview').pause(); }, { once: true });
