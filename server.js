// Hitster Digital: servidor Express + Socket.io
// TV cria a sala e toca a musica; jogadores entram pelo QR code no celular.
try { require('dotenv').config(); } catch { /* opcional: no Render as variaveis vem do ambiente */ }
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const engine = require('./src/rooms');
const { stats } = require('./src/songs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// Dominio curto opcional para os jogadores (equivalente ao kahoot.it).
// Ex: JOIN_URL=https://hitster.page aponta para o mesmo servico via dominio customizado.
const JOIN_URL = process.env.JOIN_URL || BASE_URL;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const YT_API_KEY = process.env.YT_API_KEY || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));

// Atalho estilo Kahoot: digitar site.com/AB123 entra direto na sala
app.get('/:code([A-Za-z0-9]{4,6})', (req, res) => {
  res.redirect(`/play?sala=${req.params.code.toUpperCase()}`);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/songs/stats', (req, res) => res.json(stats()));
app.get('/api/features', (req, res) => res.json({
  spotify: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
  youtube: Boolean(YT_API_KEY),
  preview: true,
  baseUrl: BASE_URL
}));

// ---------------- Spotify OAuth (Authorization Code) ----------------
// A TV loga com a conta Spotify Premium de um dos jogadores para tocar as musicas completas.
const spotifyTokens = new Map(); // roomCode -> {access_token, refresh_token, expires_at}

app.get('/auth/spotify', (req, res) => {
  const room = String(req.query.sala || '').toUpperCase();
  const scope = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: `${BASE_URL}/auth/spotify/callback`,
    state: room
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/auth/spotify/callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: `${BASE_URL}/auth/spotify/callback`
    });
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
      },
      body
    });
    const data = await r.json();
    if (data.access_token) {
      spotifyTokens.set(String(state).toUpperCase(), {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in - 60) * 1000
      });
      const room = engine.getRoom(state);
      if (room) {
        room.spotifyConnected = true;
        io.to(room.tvSocketId).emit('spotify:connected');
        broadcast(room);
      }
      return res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Spotify conectado</title></head>
<body style="background:#1B1226;color:#F4E8CF;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">
<div><div style="font-size:64px">✅</div><h2 style="margin:12px 0">Spotify conectado!</h2>
<p style="opacity:.7">A TV ja esta pronta para tocar as musicas completas.<br>Pode fechar esta aba e voltar para o jogo.</p></div>
</body></html>`);
    }
    throw new Error(JSON.stringify(data));
  } catch (e) {
    res.status(500).send('Falha ao conectar o Spotify: ' + e.message);
  }
});

async function spotifyAccessToken(roomCode) {
  const t = spotifyTokens.get(roomCode);
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
    },
    body
  });
  const data = await r.json();
  if (data.access_token) {
    t.access_token = data.access_token;
    t.expires_at = Date.now() + (data.expires_in - 60) * 1000;
    return t.access_token;
  }
  return null;
}

app.get('/api/spotify/token', async (req, res) => {
  const token = await spotifyAccessToken(String(req.query.sala || '').toUpperCase());
  if (!token) return res.status(404).json({ error: 'Spotify nao conectado nesta sala.' });
  res.json({ access_token: token });
});

// ---------------- Resolucao da faixa da rodada ----------------
// A TV pergunta "o que devo tocar agora": o servidor conhece a carta atual da sala
// e devolve apenas a informacao de reproducao, nunca titulo/artista/ano antes da revelacao.
const resolveCache = new Map(); // `${fonte}:${songId}` -> payload

app.get('/api/resolve', async (req, res) => {
  const room = engine.getRoom(req.query.sala);
  if (!room || !room.round) return res.status(404).json({ error: 'Sala ou rodada inexistente.' });
  const song = room.round.card;
  const fonte = room.config.fonte;
  const cacheKey = `${fonte}:${song.id}`;
  if (resolveCache.has(cacheKey)) return res.json(resolveCache.get(cacheKey));

  try {
    let payload;
    if (fonte === 'SPOTIFY') {
      const token = await spotifyAccessToken(room.code);
      if (!token) return res.status(400).json({ error: 'Spotify nao conectado.' });
      const q = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
      const r = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      const track = data.tracks?.items?.[0];
      if (!track) throw new Error('Faixa nao encontrada no Spotify.');
      payload = { type: 'spotify', uri: track.uri, durationMs: track.duration_ms };
    } else if (fonte === 'YOUTUBE') {
      if (!YT_API_KEY) return res.status(400).json({ error: 'YT_API_KEY nao configurada.' });
      const q = encodeURIComponent(`${song.artist} ${song.title} official audio`);
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=1&q=${q}&key=${YT_API_KEY}`);
      const data = await r.json();
      const vid = data.items?.[0]?.id?.videoId;
      if (!vid) throw new Error('Video nao encontrado no YouTube.');
      payload = { type: 'youtube', videoId: vid };
    } else {
      // PREVIEW: Deezer, 30 segundos, sem login e sem chave
      const q = encodeURIComponent(`artist:"${song.artist}" track:"${song.title}"`);
      let r = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`);
      let data = await r.json();
      let hit = data.data?.[0];
      if (!hit) {
        r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(song.artist + ' ' + song.title)}&limit=1`);
        data = await r.json();
        hit = data.data?.[0];
      }
      if (!hit?.preview) throw new Error('Preview nao encontrado.');
      payload = { type: 'preview', url: hit.preview };
    }
    resolveCache.set(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------------- Socket.io ----------------

function broadcast(room) {
  io.to(room.code).emit('state', engine.publicState(room));
}

function clearRoundTimers(room) {
  ['placing', 'contest', 'guess'].forEach(k => {
    if (room.timers[k]) { clearTimeout(room.timers[k]); delete room.timers[k]; }
  });
}

function beginRound(room) {
  clearRoundTimers(room);
  const round = engine.startRound(room);
  if (!round) { broadcast(room); return; }
  io.to(room.code).emit('round:start', {
    number: round.number,
    turnPlayerId: round.turnPlayerId,
    turnEntityId: round.turnEntityId
  });
  broadcast(room);
  room.timers.placing = setTimeout(() => {
    if (room.round?.phase === 'placing') { openGuessing(room); doReveal(room); }
  }, engine.PLACING_TIMEOUT_MS);
}

function openContestWindow(room) {
  io.to(room.code).emit('contest:open', { seconds: engine.CONTEST_WINDOW_MS / 1000 });
  broadcast(room);
  room.timers.contest = setTimeout(() => closeContestAndGuess(room), engine.CONTEST_WINDOW_MS);
}

function closeContestAndGuess(room) {
  if (!room.round || room.round.phase !== 'contest') return;
  clearTimeout(room.timers.contest);
  openGuessing(room);
}

function openGuessing(room) {
  if (!room.round) return;
  room.round.phase = 'guessing';
  io.to(room.code).emit('guess:open', { seconds: engine.GUESS_WINDOW_MS / 1000, modo: room.config.modo });
  broadcast(room);
  room.timers.guess = setTimeout(() => doReveal(room), engine.GUESS_WINDOW_MS);
}

function doReveal(room) {
  if (!room.round || room.round.phase === 'reveal') return;
  clearRoundTimers(room);
  const results = engine.reveal(room);
  io.to(room.code).emit('round:reveal', results);
  broadcast(room);
  if (room.state === 'ended') {
    io.to(room.code).emit('game:over', { winner: room.winner, state: engine.publicState(room) });
  }
}

io.on('connection', (socket) => {
  // -------- TV --------
  socket.on('tv:create', (cb) => {
    const room = engine.createRoom(socket.id);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isTV = true;
    cb?.({ code: room.code, joinUrl: `${JOIN_URL}/${room.code}`, joinHost: JOIN_URL.replace(/^https?:\/\//, ""), state: engine.publicState(room) });
  });

  socket.on('tv:config', ({ config }, cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room || room.state !== 'lobby') return cb?.({ error: 'Configuracao permitida apenas no lobby.' });
    room.config = { ...room.config, ...config, filtros: { ...room.config.filtros, ...(config.filtros || {}) } };
    broadcast(room);
    cb?.({ ok: true });
  });

  socket.on('tv:lock', ({ locked }) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (room) { room.locked = Boolean(locked); broadcast(room); }
  });

  socket.on('tv:kick', ({ playerId }) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room || room.state !== 'lobby') return;
    const p = room.players.find(x => x.id === playerId);
    if (p) {
      room.players = room.players.filter(x => x.id !== playerId);
      if (p.socketId) io.to(p.socketId).emit('kicked');
      broadcast(room);
    }
  });

  socket.on('tv:start', (cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    const r = engine.startGame(room);
    if (r.error) return cb?.(r);
    io.to(room.code).emit('game:started');
    broadcast(room);
    setTimeout(() => beginRound(room), 1200);
    cb?.({ ok: true });
  });

  socket.on('tv:pause', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (room && room.state === 'playing') { room.state = 'paused'; clearRoundTimers(room); broadcast(room); }
  });

  socket.on('tv:resume', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (room && room.state === 'paused') {
      room.state = 'playing';
      broadcast(room);
      if (room.round && room.round.phase !== 'reveal') doReveal(room); // retoma destravando a rodada atual
      else beginRound(room);
    }
  });

  socket.on('tv:skip', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room || !room.round) return;
    if (room.round.phase === 'reveal') beginRound(room);
    else doReveal(room);
  });

  socket.on('tv:next-round', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (room && room.state === 'playing' && room.round?.phase === 'reveal') beginRound(room);
  });

  socket.on('tv:rematch', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    room.state = 'lobby';
    room.winner = null;
    room.round = null;
    room.players.forEach(p => { p.timeline = []; p.fichas = 0; });
    room.teams = {};
    broadcast(room);
  });

  socket.on('tv:end', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    io.to(room.code).emit('room:closed');
    engine.removeRoom(room.code);
  });

  // -------- Jogador --------
  socket.on('player:join', ({ code, name, emoji, token }, cb) => {
    const room = engine.getRoom(code);
    if (!room) return cb?.({ error: 'Sala nao encontrada. Confira o codigo.' });

    // reconexao
    if (token) {
      const existing = room.players.find(p => p.token === token);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = existing.id;
        broadcast(room);
        return cb?.({ ok: true, playerId: existing.id, token: existing.token, state: engine.publicState(room) });
      }
    }

    const r = engine.addPlayer(room, { name, emoji });
    if (r.error) return cb?.(r);
    r.player.socketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = r.player.id;
    broadcast(room);
    cb?.({ ok: true, playerId: r.player.id, token: r.player.token, state: engine.publicState(room) });
  });

  socket.on('player:team', ({ team }) => {
    const room = engine.getRoom(socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (room && p && room.state === 'lobby') { p.team = String(team || '').slice(0, 12) || null; broadcast(room); }
  });

  socket.on('player:place', ({ slot }, cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    const r = engine.placeTurnCard(room, socket.data.playerId, slot);
    if (r.error) return cb?.(r);
    io.to(room.code).emit('turn:placed', { playerId: socket.data.playerId });
    openContestWindow(room);
    cb?.({ ok: true });
  });

  socket.on('player:contest', (cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    const r = engine.requestContest(room, socket.data.playerId);
    if (r.error) return cb?.(r);
    io.to(room.code).emit('contest:new', {
      playerId: socket.data.playerId,
      order: r.order,
      tie: room.round.contests.some(c => c.tieBroken)
    });
    broadcast(room);
    cb?.({ ok: true });
  });

  socket.on('player:contest-place', ({ slot }, cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    const r = engine.placeContestCard(room, socket.data.playerId, slot);
    if (r.error) return cb?.(r);
    broadcast(room);
    if (r.allPlaced && room.round.phase === 'contest') closeContestAndGuess(room);
    cb?.({ ok: true });
  });

  socket.on('player:guess', (guess, cb) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    const r = engine.submitGuess(room, socket.data.playerId, guess || {});
    cb?.(r);
  });

  socket.on('player:skip-guess', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room || !room.round) return;
    // se o jogador da vez dispensa o palpite e nao ha contestadores pendentes, revela
    if (socket.data.playerId === room.round.turnPlayerId && room.round.contests.every(c => c.slot !== null)) {
      doReveal(room);
    }
  });

  socket.on('player:replay', () => {
    const room = engine.getRoom(socket.data.roomCode);
    // apenas o jogador da vez pode pedir para tocar novamente
    if (room?.round && room.round.turnPlayerId === socket.data.playerId && room.round.phase !== 'reveal') {
      io.to(room.tvSocketId).emit('playback:replay');
    }
  });

  socket.on('player:reaction', ({ emoji }) => {
    const room = engine.getRoom(socket.data.roomCode);
    if (room) io.to(room.code).emit('reaction', { playerId: socket.data.playerId, emoji: String(emoji || '').slice(0, 4) });
  });

  socket.on('player:chat', ({ text }) => {
    const room = engine.getRoom(socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (room && p) io.to(room.code).emit('chat', { name: p.name, emoji: p.emoji, text: String(text || '').slice(0, 140) });
  });

  socket.on('disconnect', () => {
    const room = engine.getRoom(socket.data.roomCode);
    if (!room) return;
    if (socket.data.isTV) {
      // TV caiu: mantem a sala por 5 minutos aguardando a TV reconectar
      setTimeout(() => {
        const r = engine.getRoom(socket.data.roomCode);
        if (r && r.tvSocketId === socket.id) {
          io.to(r.code).emit('room:closed');
          engine.removeRoom(r.code);
        }
      }, 5 * 60 * 1000);
      return;
    }
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (p) { p.connected = false; broadcast(room); }
  });

  socket.on('tv:reclaim', ({ code }, cb) => {
    const room = engine.getRoom(code);
    if (!room) return cb?.({ error: 'Sala expirada.' });
    room.tvSocketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isTV = true;
    cb?.({ ok: true, state: engine.publicState(room), joinUrl: `${JOIN_URL}/${room.code}`, joinHost: JOIN_URL.replace(/^https?:\/\//, "") });
  });
});

server.listen(PORT, () => {
  console.log(`Hitster Digital rodando em ${BASE_URL}`);
});
