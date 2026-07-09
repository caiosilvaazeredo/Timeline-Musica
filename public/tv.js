/* Vitrola, TV */
const socket = io();
const $ = (s) => document.querySelector(s);
const decColor = (y) => `var(--d${Math.min(2020, Math.max(1930, Math.floor(y / 10) * 10))})`;

let ROOM = null;           // codigo da sala
let STATE = null;          // ultimo snapshot
let FEATURES = { spotify: false, youtube: false, preview: true };
let spotifyReady = false, spotifyDeviceId = null, spotifyPlayer = null;
let ytPlayer = null, ytReady = false;
let playTimer = null, progressTimer = null;

// ---------------- criacao / reconexao da sala ----------------
const savedCode = sessionStorage.getItem('vitrola_tv_room');
if (savedCode) {
  socket.emit('tv:reclaim', { code: savedCode }, (res) => {
    if (res?.ok) bootRoom(savedCode, res, res.state);
    else createRoom();
  });
} else createRoom();

function createRoom() {
  socket.emit('tv:create', (res) => {
    sessionStorage.setItem('vitrola_tv_room', res.code);
    bootRoom(res.code, res, res.state);
  });
}

function bootRoom(code, res, state) {
  ROOM = code;
  $('#lobby-code').textContent = code;
  $('#join-host').textContent = res.joinHost || location.host;
  $('#join-code-inline').textContent = code;
  new QRCode($('#qrcode'), { text: res.joinUrl, width: 220, height: 220, colorDark: '#1B1226', colorLight: '#F4E8CF' });
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
    if (!FEATURES.spotify) { el.textContent = 'Configure SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no servidor.'; el.classList.add('warn'); }
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
    if (!FEATURES.youtube) { el.textContent = 'Configure YT_API_KEY no servidor para usar o YouTube.'; el.classList.add('warn'); }
    else { el.textContent = 'YouTube pronto. O audio toca direto na TV, sem login.'; el.classList.add('ok'); ensureYouTube(); }
  }
}

$('#btn-spotify').addEventListener('click', () => {
  window.open(`/auth/spotify?sala=${ROOM}`, '_blank');
});

socket.on('spotify:connected', async () => {
  toast('Spotify conectado');
  await initSpotifySDK();
  updateFonteStatus();
});

// ---------------- lobby ----------------
$('#btn-lock').addEventListener('click', () => {
  socket.emit('tv:lock', { locked: !STATE?.locked });
});
$('#btn-start').addEventListener('click', () => {
  const fonte = $('#cfg-fonte').value;
  if (fonte === 'SPOTIFY' && !spotifyReady && !STATE?.spotifyConnected) {
    return toast('Conecte o Spotify de um jogador antes de comecar (QR na configuracao).');
  }
  if (fonte === 'SPOTIFY' && !spotifyReady) initSpotifySDK();
  socket.emit('tv:start', (res) => { if (res?.error) toast(res.error); });
});

// ---------------- controles do host ----------------
$('#btn-pause').addEventListener('click', () => socket.emit('tv:pause'));
$('#btn-resume').addEventListener('click', () => socket.emit('tv:resume'));
$('#btn-skip').addEventListener('click', () => { stopAudio(); socket.emit('tv:skip'); });
$('#btn-next').addEventListener('click', () => socket.emit('tv:next-round'));
$('#btn-endroom').addEventListener('click', () => { if (confirm('Encerrar a sala para todos?')) socket.emit('tv:end'); });
$('#btn-rematch').addEventListener('click', () => socket.emit('tv:rematch'));
$('#btn-close').addEventListener('click', () => socket.emit('tv:end'));

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
  const p = STATE?.players.find(x => x.id === turnPlayerId);
  const tb = $('#turn-banner');
  tb.innerHTML = `Rodada ${number}: vez de <strong>${esc(p?.name || '?')}</strong> ${p?.emoji || ''}`;
  tb.classList.remove('slide-pop'); void tb.offsetWidth; tb.classList.add('slide-pop');
  $('#phase-status').textContent = 'Sorteando o proximo disco...';
  await playCurrentTrack();
});

socket.on('turn:placed', () => {
  $('#phase-status').textContent = 'Carta posicionada. Janela de contestacao aberta: usem o botao no celular.';
  FX.zoom($('#phase-status'));
});

socket.on('contest:open', ({ seconds }) => {
  countdown($('#phase-status'), seconds, 'Contestacoes abertas');
});

socket.on('contest:new', ({ playerId, tie }) => {
  const p = STATE?.players.find(x => x.id === playerId);
  const chip = document.createElement('span');
  chip.className = 'contest-chip' + (tie ? ' tie' : '');
  chip.textContent = `${p?.emoji || ''} ${p?.name || '?'} contestou!`;
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
  const name = (id) => { const p = STATE?.players.find(x => x.id === id); return p ? `${p.emoji} ${p.name}` : id; };
  const t = results.turn;
  ul.insertAdjacentHTML('beforeend',
    `<li class="${t.keeps ? 'ok' : 'bad'}">${name(t.playerId)} ${t.slot === null ? 'nao posicionou a tempo' : t.posOk ? 'acertou a posicao' : 'errou a posicao'}${t.keeps ? ' e ficou com a carta' : ''}</li>`);
  results.contests.forEach(c => {
    ul.insertAdjacentHTML('beforeend',
      `<li class="${c.wins ? 'ok' : c.posOk ? '' : 'bad'}">${name(c.playerId)} contestou${c.tieBroken ? ' (sorteio)' : ''}: ${c.slot === null ? 'nao jogou' : c.posOk ? 'posicao correta' : 'posicao errada'}${c.wins ? ' e levou a carta!' : ''}</li>`);
  });
  results.fichasGanhas.forEach(pid => {
    ul.insertAdjacentHTML('beforeend', `<li class="ok">${name(pid)} acertou artista e musica: +1 ficha</li>`);
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

socket.on('reaction', ({ emoji }) => {
  const el = document.createElement('span');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = (10 + Math.random() * 80) + 'vw';
  $('#reactions-layer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
});

socket.on('chat', ({ name, emoji, text }) => {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `<b>${esc(emoji)} ${esc(name)}:</b> ${esc(text)}`;
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
  $('#phase-status').textContent = '🎤 O jogador da vez cortou a musica para responder!';
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

  // lobby
  $('#player-count').textContent = `${state.players.filter(p => p.connected).length}/8`;
  $('#btn-lock').textContent = state.locked ? 'Liberar entradas' : 'Travar entradas';
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="emoji">${esc(p.emoji)}</span> <span>${esc(p.name)}</span>
      ${p.team ? `<span class="team-tag">${esc(p.team)}</span>` : ''}
      ${state.state === 'lobby' ? `<button class="kick" title="Remover" data-id="${p.id}">✕</button>` : ''}`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.kick').forEach(b => b.addEventListener('click', () => socket.emit('tv:kick', { playerId: b.dataset.id })));
  if (state.state === 'lobby') updateFonteStatus();

  // pausa
  $('#pause-overlay').classList.toggle('hidden', state.state !== 'paused');

  // jogo
  if (state.state === 'playing' || state.state === 'paused') {
    $('#game-round').textContent = state.roundNumber ? `Rodada ${state.roundNumber}` : '';
    $('#deck-left').textContent = `Baralho: ${state.deckLeft}`;
    renderScoreboard(state);
  }
}

function renderScoreboard(state) {
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  const isTeams = state.config.modo === 'EQUIPES' && state.teams;
  if (isTeams) {
    Object.entries(state.teams).forEach(([team, t]) => {
      sb.appendChild(scoreCard(`🏳 ${team}`, t.fichas, t.timeline, state.turnEntityId === team));
    });
  } else {
    [...state.players].sort((a, b) => b.cartas - a.cartas).forEach(p => {
      sb.appendChild(scoreCard(`${p.emoji} ${p.name}${p.connected ? '' : ' (offline)'}`, p.fichas, p.timeline, state.turnPlayerId === p.id));
    });
  }
}

function scoreCard(label, fichas, timeline, isTurn) {
  const div = document.createElement('div');
  div.className = 'score-card' + (isTurn ? ' turn' : '');
  div.innerHTML = `<div class="score-head"><span>${esc(label)}</span>
    <span class="fichas num">⛃ ${fichas} | ${timeline.length} cartas</span></div>
    <div class="mini-timeline">${timeline.map(c =>
      `<span class="mini-card" style="--dec:${decColor(c.year)}" title="${esc(c.title)} (${c.year})">${String(c.year).slice(2)}</span>`).join('')}</div>`;
  return div;
}

function showEnd(winner) {
  $('#scr-game').classList.add('hidden');
  $('#scr-end').classList.remove('hidden');
  const isTeams = STATE.config.modo === 'EQUIPES' && STATE.teams;
  let ranking;
  if (isTeams) {
    ranking = Object.entries(STATE.teams).map(([team, t]) => ({ label: `🏳 ${team}`, cartas: t.cartas, timeline: t.timeline }));
  } else {
    ranking = STATE.players.map(p => ({ label: `${p.emoji} ${p.name}`, cartas: p.cartas, timeline: p.timeline }));
  }
  ranking.sort((a, b) => b.cartas - a.cartas);

  const podium = $('#podium');
  podium.innerHTML = '';
  const order = [1, 0, 2];
  order.forEach(i => {
    const r = ranking[i];
    if (!r) return;
    podium.insertAdjacentHTML('beforeend',
      `<div class="place p${i + 1}"><div class="pos">${i + 1}º</div><div>${esc(r.label)}</div><div class="num">${r.cartas} cartas</div></div>`);
  });

  const ft = $('#final-timelines');
  ft.innerHTML = '';
  ranking.forEach(r => {
    ft.insertAdjacentHTML('beforeend',
      `<div class="final-row"><div class="who">${esc(r.label)}</div><div class="cards">${
        r.timeline.map(c => `<div class="card45" style="--dec:${decColor(c.year)}">
          <div class="year">${c.year}</div><div class="song">${esc(c.title)}</div><div class="who">${esc(c.artist)}</div></div>`).join('')
      }</div></div>`);
  });
}

// ---------------- reproducao ----------------
async function playCurrentTrack(isReplay = false) {
  stopAudio();
  try {
    const res = await fetch(`/api/resolve?sala=${ROOM}`);
    const info = await res.json();
    if (info.error) { $('#phase-status').textContent = `Falha no audio: ${info.error}. Use "Pular rodada" se necessario.`; return; }

    showVinyl(true);
    const dur = (STATE?.config?.duracaoTrechoSeg || 30) * 1000;

    if (info.type === 'preview') {
      const a = $('#audio-preview');
      a.src = info.url;
      await a.play().catch(() => toast('Clique na tela da TV para liberar o audio.'));
    } else if (info.type === 'youtube') {
      await ensureYouTube();
      ytPlayer.loadVideoById(info.videoId);
      ytPlayer.playVideo();
    } else if (info.type === 'spotify') {
      await playSpotify(info.uri);
    }

    startProgress(dur);
    playTimer = setTimeout(() => stopAudio(), dur);
  } catch (e) {
    $('#phase-status').textContent = 'Nao consegui tocar esta faixa. O host pode pular a rodada.';
    showVinyl(false);
  }
}

function stopAudio() {
  clearTimeout(playTimer);
  clearInterval(progressTimer);
  const a = $('#audio-preview');
  a.pause(); a.removeAttribute('src');
  try { ytPlayer?.stopVideo(); } catch {}
  try { if (spotifyDeviceId) fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${spotifyDeviceId}`, { method: 'PUT', headers: spotifyHeaders() }); } catch {}
  showVinyl(false);
}

function showVinyl(on) {
  $('#overlay-vinyl').classList.toggle('hidden', !on);
  if (on) $('#progress-bar').style.width = '0%';
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
  let s = seconds;
  el.textContent = `${label} (${s}s)`;
  window._cd = setInterval(() => {
    s--;
    if (s <= 0) { clearInterval(window._cd); el.textContent = 'Calculando resultados...'; }
    else el.textContent = `${label} (${s}s)`;
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
document.addEventListener('click', () => { $('#audio-preview').play().catch(() => {}); $('#audio-preview').pause(); }, { once: true });
