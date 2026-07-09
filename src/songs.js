// Carrega o banco de musicas e monta o baralho conforme os filtros da sala
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'songs.json');
const EXTRA_PATH = path.join(__dirname, '..', 'data', 'songs-extra.json'); // gerado por scripts/import-deezer.js

let cache = null;

function loadAll() {
  if (cache) return cache;
  const base = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  let extra = [];
  if (fs.existsSync(EXTRA_PATH)) {
    try { extra = JSON.parse(fs.readFileSync(EXTRA_PATH, 'utf8')); } catch (e) { extra = []; }
  }
  const seen = new Set();
  cache = [...base, ...extra].filter(s => {
    if (!s.title || !s.artist || !s.year) return false;
    const key = `${s.title}::${s.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    s.id = s.id || key.replace(/[^a-z0-9]+/g, '-');
    s.decade = Math.floor(s.year / 10) * 10;
    return true;
  });
  return cache;
}

/**
 * filtros:
 *  origem: 'BR' | 'INTL' | 'AMBAS'
 *  billboardUS: bool (somente musicas que ja estiveram no Hot 100 dos EUA)
 *  billboardBR: bool (somente musicas que ja estiveram no Top 100 Brasil)
 *  decadaMin / decadaMax: ex 1960 / 2020
 *  Se billboardUS e billboardBR estiverem ambos ativos, aceita quem satisfaz qualquer um dos dois.
 */
function buildDeck(filtros = {}, excludeIds = null) {
  const all = loadAll();
  const origem = filtros.origem || 'AMBAS';
  const dMin = filtros.decadaMin || 0;
  const dMax = filtros.decadaMax || 9999;

  let deck = all.filter(s => {
    if (excludeIds && excludeIds.has(s.id)) return false;   // ja tocou nesta sessao
    if (origem === 'BR' && s.origem !== 'BR') return false;
    if (origem === 'INTL' && s.origem !== 'INTL') return false;
    if (s.year < dMin || s.year > dMax + 9) return false;
    if (filtros.billboardUS || filtros.billboardBR) {
      const okUS = filtros.billboardUS && s.billboardUS;
      const okBR = filtros.billboardBR && s.billboardBR;
      if (!okUS && !okBR) return false;
    }
    return true;
  });

  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function stats() {
  const all = loadAll();
  return {
    total: all.length,
    br: all.filter(s => s.origem === 'BR').length,
    intl: all.filter(s => s.origem === 'INTL').length,
    billboardUS: all.filter(s => s.billboardUS).length,
    billboardBR: all.filter(s => s.billboardBR).length,
    decadas: [...new Set(all.map(s => s.decade))].sort()
  };
}

module.exports = { loadAll, buildDeck, stats };
