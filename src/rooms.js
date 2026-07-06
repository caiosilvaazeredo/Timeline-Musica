// Motor do Hitster Digital: estado das salas, maquina de rodadas, contestacao e vitoria
const crypto = require('crypto');
const { buildDeck } = require('./songs');
const { matchArtist, matchTitle } = require('./match');

const MAX_PLAYERS = 8;
const CONTEST_TIE_WINDOW_MS = 400;   // contestacoes dentro desta janela empatam e vao a sorteio
const PLACING_TIMEOUT_MS = 60000;
const CONTEST_WINDOW_MS = 15000;
const GUESS_WINDOW_MS = 30000;

const rooms = new Map();

function code4() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[crypto.randomInt(chars.length)];
  return rooms.has(c) ? code4() : c;
}

const DEFAULT_CONFIG = {
  modo: 'ORIGINAL',            // ORIGINAL | PRO | EXPERT | EQUIPES
  meta: 10,                    // cartas para vencer
  fichasIniciais: 2,           // PRO usa 5 por padrao (ajustado no start se nao alterado)
  fonte: 'PREVIEW',            // SPOTIFY | YOUTUBE | PREVIEW (Deezer 30s, sem login)
  duracaoTrechoSeg: 30,
  maxContestacoes: 3,          // quantos jogadores podem contestar a mesma carta
  filtros: {
    origem: 'AMBAS',           // BR | INTL | AMBAS
    billboardUS: false,
    billboardBR: false,
    decadaMin: 1950,
    decadaMax: 2020
  }
};

function createRoom(tvSocketId) {
  const room = {
    code: code4(),
    tvSocketId,
    state: 'lobby',            // lobby | playing | paused | ended
    locked: false,
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    players: [],               // {id, token, socketId, name, emoji, team, timeline[], fichas, connected}
    teams: {},                 // nome -> {timeline[], fichas} quando modo EQUIPES
    deck: [],
    round: null,
    roundCount: 0,
    turnIndex: -1,
    winner: null,
    timers: {},
    log: []
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) { return rooms.get(String(code || '').toUpperCase()); }

function addPlayer(room, { name, emoji }) {
  if (room.locked || room.state !== 'lobby') return { error: 'A sala nao esta aceitando novos jogadores.' };
  if (room.players.filter(p => p.connected).length >= MAX_PLAYERS) return { error: 'Sala cheia: maximo de 8 jogadores.' };
  const player = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    socketId: null,
    name: String(name || 'Jogador').slice(0, 16),
    emoji: emoji || '🎵',
    team: null,
    timeline: [],
    fichas: 0,
    connected: true
  };
  room.players.push(player);
  return { player };
}

// ---------- utilidades de linha do tempo ----------

function timelineOf(room, entityId) {
  if (room.config.modo === 'EQUIPES') return room.teams[entityId]?.timeline || [];
  return room.players.find(p => p.id === entityId)?.timeline || [];
}

function fichasOf(room, playerId) {
  const p = room.players.find(x => x.id === playerId);
  if (!p) return 0;
  if (room.config.modo === 'EQUIPES') return room.teams[p.team]?.fichas ?? 0;
  return p.fichas;
}

function spendFicha(room, playerId, delta) {
  const p = room.players.find(x => x.id === playerId);
  if (!p) return;
  if (room.config.modo === 'EQUIPES') room.teams[p.team].fichas = Math.max(0, room.teams[p.team].fichas + delta);
  else p.fichas = Math.max(0, p.fichas + delta);
}

// slot i significa: inserir antes do elemento i (0 = antes da mais antiga, len = depois da mais recente)
function isPlacementCorrect(timeline, slot, year) {
  const left = slot > 0 ? timeline[slot - 1].year : -Infinity;
  const right = slot < timeline.length ? timeline[slot].year : Infinity;
  return year >= left && year <= right;
}

function insertCard(timeline, card) {
  const i = timeline.findIndex(c => c.year > card.year);
  if (i === -1) timeline.push(card); else timeline.splice(i, 0, card);
}

// ---------- inicio de partida ----------

function startGame(room) {
  const active = room.players.filter(p => p.connected);
  if (active.length < 2) return { error: 'Sao necessarios pelo menos 2 jogadores.' };
  if (room.config.modo === 'EQUIPES') {
    const teams = [...new Set(active.map(p => p.team).filter(Boolean))];
    if (teams.length < 2) return { error: 'Modo Equipes exige pelo menos 2 equipes com jogadores.' };
    room.teams = {};
    teams.forEach(t => { room.teams[t] = { timeline: [], fichas: room.config.fichasIniciais }; });
  }

  room.deck = buildDeck(room.config.filtros);
  const entidades = entities(room);
  if (room.deck.length < room.config.meta * entidades.length + 20) {
    return { error: `Baralho insuficiente para estes filtros (${room.deck.length} musicas). Afrouxe os filtros ou reduza a meta.` };
  }

  // fichas iniciais (PRO: 5 por padrao, conforme regra oficial)
  const fichas = room.config.modo === 'PRO' && room.config.fichasIniciais === 2 ? 5 : room.config.fichasIniciais;
  room.players.forEach(p => { p.fichas = fichas; p.timeline = []; });
  Object.values(room.teams).forEach(t => { t.fichas = fichas; t.timeline = []; });

  // carta inicial gratuita para cada jogador/equipe
  entidades.forEach(eid => insertCard(timelineOf(room, eid), room.deck.pop()));

  room.state = 'playing';
  room.roundCount = 0;
  room.turnIndex = -1;
  room.winner = null;
  return { ok: true };
}

// entidades pontuadoras: jogadores, ou nomes de equipe no modo EQUIPES
function entities(room) {
  if (room.config.modo === 'EQUIPES') return Object.keys(room.teams).length
    ? Object.keys(room.teams)
    : [...new Set(room.players.filter(p => p.connected && p.team).map(p => p.team))];
  return room.players.filter(p => p.connected).map(p => p.id);
}

function nextTurnPlayer(room) {
  const active = room.players.filter(p => p.connected);
  if (room.config.modo === 'EQUIPES') {
    const teamNames = Object.keys(room.teams);
    room.turnIndex = (room.turnIndex + 1) % teamNames.length;
    const team = teamNames[room.turnIndex];
    const members = active.filter(p => p.team === team);
    const controller = members[room.roundCount % members.length];
    return { entityId: team, player: controller };
  }
  room.turnIndex = (room.turnIndex + 1) % active.length;
  const p = active[room.turnIndex];
  return { entityId: p.id, player: p };
}

function startRound(room) {
  if (!room.deck.length) { room.state = 'ended'; room.winner = leader(room); return null; }
  room.roundCount++;
  const { entityId, player } = nextTurnPlayer(room);
  const card = room.deck.pop();
  room.round = {
    number: room.roundCount,
    card,
    turnEntityId: entityId,
    turnPlayerId: player.id,
    phase: 'placing',                 // placing -> contest -> guessing -> reveal
    turnPlacement: null,              // slot escolhido pelo jogador da vez
    contests: [],                     // {playerId, entityId, ts, slot, tieBroken}
    guesses: {},                      // playerId -> {artist, title, year}
    results: null
  };
  return room.round;
}

// ---------- acoes de rodada ----------

function placeTurnCard(room, playerId, slot) {
  const r = room.round;
  if (!r || r.phase !== 'placing' || r.turnPlayerId !== playerId) return { error: 'Nao e sua vez de posicionar.' };
  const tl = timelineOf(room, r.turnEntityId);
  slot = Number(slot);
  if (!(slot >= 0 && slot <= tl.length)) return { error: 'Posicao invalida.' };
  r.turnPlacement = slot;
  r.phase = 'contest';
  return { ok: true };
}

function requestContest(room, playerId) {
  const r = room.round;
  if (!r || r.phase !== 'contest') return { error: 'A contestacao ainda nao esta aberta.' };
  const p = room.players.find(x => x.id === playerId);
  if (!p) return { error: 'Jogador nao encontrado.' };
  const entityId = room.config.modo === 'EQUIPES' ? p.team : p.id;
  if (entityId === r.turnEntityId) return { error: 'Voce nao pode contestar a propria jogada.' };
  if (r.contests.some(c => c.entityId === entityId)) return { error: 'Sua equipe ja contestou esta carta.' };
  if (fichasOf(room, playerId) <= 0) return { error: 'Voce nao tem fichas para contestar.' };

  // limite de contestacoes simultaneas: menor entre a config e os intervalos livres da linha do tempo do contestador com menos cartas
  if (r.contests.length >= room.config.maxContestacoes) return { error: 'Limite de contestacoes desta carta atingido.' };

  spendFicha(room, playerId, -1); // quem clicou e obrigado a jogar: a ficha ja foi gasta
  r.contests.push({ playerId, entityId, ts: Date.now(), slot: null, tieBroken: false });
  resolveContestOrder(r);
  return { ok: true, order: r.contests.map(c => c.playerId) };
}

// Desempate: contestacoes dentro da janela de 400ms sao embaralhadas por sorteio
function resolveContestOrder(r) {
  const list = [...r.contests].sort((a, b) => a.ts - b.ts);
  const groups = [];
  for (const c of list) {
    const g = groups[groups.length - 1];
    if (g && c.ts - g[0].ts <= CONTEST_TIE_WINDOW_MS) g.push(c);
    else groups.push([c]);
  }
  const ordered = [];
  for (const g of groups) {
    if (g.length > 1) {
      g.forEach(c => c.tieBroken = true);
      for (let i = g.length - 1; i > 0; i--) {           // sorteio
        const j = crypto.randomInt(i + 1);
        [g[i], g[j]] = [g[j], g[i]];
      }
    }
    ordered.push(...g);
  }
  r.contests = ordered;
}

function placeContestCard(room, playerId, slot) {
  const r = room.round;
  if (!r || (r.phase !== 'contest' && r.phase !== 'guessing')) return { error: 'Fora da janela de contestacao.' };
  const c = r.contests.find(x => x.playerId === playerId);
  if (!c) return { error: 'Voce nao contestou esta carta.' };
  if (c.slot !== null) return { error: 'Voce ja posicionou.' };
  const tl = timelineOf(room, c.entityId);
  slot = Number(slot);
  if (!(slot >= 0 && slot <= tl.length)) return { error: 'Posicao invalida.' };
  c.slot = slot;
  return { ok: true, allPlaced: r.contests.every(x => x.slot !== null) };
}

function submitGuess(room, playerId, guess) {
  const r = room.round;
  if (!r || (r.phase !== 'guessing' && r.phase !== 'contest')) return { error: 'Fora da janela de palpite.' };
  r.guesses[playerId] = {
    artist: String(guess.artist || '').slice(0, 60),
    title: String(guess.title || '').slice(0, 80),
    year: guess.year ? Number(guess.year) : null
  };
  return { ok: true };
}

// ---------- revelacao e pontuacao ----------

function reveal(room) {
  const r = room.round;
  const song = r.card;
  const modo = room.config.modo;
  const results = { song, turn: null, contests: [], fichasGanhas: [], cardWonBy: null };

  // valida jogador da vez
  const turnTl = timelineOf(room, r.turnEntityId);
  const turnPosOk = r.turnPlacement !== null && isPlacementCorrect(turnTl, r.turnPlacement, song.year);
  const g = r.guesses[r.turnPlayerId] || {};
  const artistOk = g.artist ? matchArtist(g.artist, song) : false;
  const titleOk = g.title ? matchTitle(g.title, song) : false;
  const yearOk = g.year ? g.year === song.year : false;

  let turnKeeps = false;
  if (r.turnPlacement !== null) {
    if (modo === 'PRO') turnKeeps = turnPosOk && artistOk && titleOk;
    else if (modo === 'EXPERT') turnKeeps = turnPosOk && artistOk && titleOk && yearOk;
    else turnKeeps = turnPosOk; // ORIGINAL e EQUIPES
  }

  results.turn = { playerId: r.turnPlayerId, entityId: r.turnEntityId, slot: r.turnPlacement, posOk: turnPosOk, artistOk, titleOk, yearOk, keeps: turnKeeps };

  if (turnKeeps) {
    insertCard(turnTl, song);
    results.cardWonBy = r.turnEntityId;
  }

  // ficha por acertar artista + titulo (qualquer modo, independentemente da posicao)
  for (const [pid, gg] of Object.entries(r.guesses)) {
    if (gg.artist && gg.title && matchArtist(gg.artist, song) && matchTitle(gg.title, song)) {
      spendFicha(room, pid, +1);
      results.fichasGanhas.push(pid);
    }
  }

  // contestacoes em ordem de prioridade: a primeira correta leva a carta, se o jogador da vez errou
  for (const c of r.contests) {
    const tl = timelineOf(room, c.entityId);
    const ok = c.slot !== null && isPlacementCorrect(tl, c.slot, song.year);
    let wins = false;
    if (ok && !turnKeeps && !results.cardWonBy) {
      let extra = true;
      if (modo === 'PRO' || modo === 'EXPERT') {
        const cg = r.guesses[c.playerId] || {};
        extra = cg.artist && cg.title && matchArtist(cg.artist, song) && matchTitle(cg.title, song);
        if (modo === 'EXPERT') extra = extra && cg.year === song.year;
      }
      if (extra) {
        insertCard(tl, song);
        results.cardWonBy = c.entityId;
        wins = true;
      }
    }
    results.contests.push({ playerId: c.playerId, entityId: c.entityId, slot: c.slot, posOk: ok, wins, tieBroken: c.tieBroken });
  }

  r.phase = 'reveal';
  r.results = results;

  // vitoria
  const meta = room.config.meta;
  for (const eid of entities(room)) {
    if (timelineOf(room, eid).length >= meta) { room.winner = eid; room.state = 'ended'; break; }
  }
  return results;
}

function leader(room) {
  let best = null, len = -1;
  for (const eid of entities(room)) {
    const l = timelineOf(room, eid).length;
    if (l > len) { len = l; best = eid; }
  }
  return best;
}

// ---------- snapshots para os clientes ----------

function publicState(room) {
  const modo = room.config.modo;
  return {
    code: room.code,
    state: room.state,
    locked: room.locked,
    config: room.config,
    roundNumber: room.round?.number || 0,
    phase: room.round?.phase || null,
    turnPlayerId: room.round?.turnPlayerId || null,
    turnEntityId: room.round?.turnEntityId || null,
    turnPlaced: room.round ? room.round.turnPlacement !== null : false,
    contests: room.round ? room.round.contests.map(c => ({ playerId: c.playerId, entityId: c.entityId, placed: c.slot !== null, tieBroken: c.tieBroken })) : [],
    deckLeft: room.deck.length,
    winner: room.winner,
    players: room.players.filter(p => p.connected || p.timeline.length).map(p => ({
      id: p.id, name: p.name, emoji: p.emoji, team: p.team, connected: p.connected,
      fichas: modo === 'EQUIPES' ? (room.teams[p.team]?.fichas ?? 0) : p.fichas,
      cartas: modo === 'EQUIPES' ? (room.teams[p.team]?.timeline.length ?? 0) : p.timeline.length,
      timeline: (modo === 'EQUIPES' ? (room.teams[p.team]?.timeline ?? []) : p.timeline)
        .map(c => ({ year: c.year, title: c.title, artist: c.artist }))
    })),
    teams: modo === 'EQUIPES' ? Object.fromEntries(Object.entries(room.teams).map(([k, v]) => [k, {
      fichas: v.fichas, cartas: v.timeline.length,
      timeline: v.timeline.map(c => ({ year: c.year, title: c.title, artist: c.artist }))
    }])) : null,
    reveal: room.round?.phase === 'reveal' ? room.round.results : null
  };
}

function removeRoom(code) {
  const room = rooms.get(code);
  if (room) Object.values(room.timers).forEach(clearTimeout);
  rooms.delete(code);
}

module.exports = {
  rooms, createRoom, getRoom, addPlayer, startGame, startRound,
  placeTurnCard, requestContest, placeContestCard, submitGuess, reveal,
  publicState, timelineOf, removeRoom, entities,
  PLACING_TIMEOUT_MS, CONTEST_WINDOW_MS, GUESS_WINDOW_MS, MAX_PLAYERS
};
