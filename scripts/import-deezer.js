// Expande o banco em direcao a 10 mil musicas usando a API publica do Deezer (sem chave).
// Percorre playlists editoriais e charts, extrai titulo, interprete, ano do album e preview.
// Uso:
//   node scripts/import-deezer.js                  -> importa das playlists padrao
//   node scripts/import-deezer.js 1111143121 ...   -> importa das playlists informadas (IDs do Deezer)
//
// O resultado e gravado em data/songs-extra.json e mesclado automaticamente pelo servidor.
// Observacao: o Deezer nao expoe o compositor de forma confiavel via API publica,
// entao o campo composer fica igual ao interprete quando desconhecido. As musicas do
// banco curado (data/songs.json) tem prioridade na deduplicacao e mantem o autor original.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'songs-extra.json');

// Playlists editoriais do Deezer com boa cobertura por decada e por pais
const DEFAULT_PLAYLISTS = [
  '1111141961', // 60s
  '1111142221', // 70s
  '1111142361', // 80s
  '1111143121', // 90s
  '1111143391', // 2000s
  '1111143511', // 2010s
  '3155776842', // Top Brasil
  '1479458365', // MPB
  '1111141961',
  '53362031',   // 100% Sertanejo
  '715993725',  // Funk Hits
  '1266971851', // Rock BR
  '1313621735', // Top mundial
];

const BR_HINTS = /(mpb|sertanej|pagode|samba|forro|forró|ax[eé]|funk|brasil|bossa)/i;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function albumYear(albumId, cache) {
  if (cache.has(albumId)) return cache.get(albumId);
  try {
    const a = await fetchJson(`https://api.deezer.com/album/${albumId}`);
    const y = a.release_date ? Number(a.release_date.slice(0, 4)) : null;
    cache.set(albumId, y);
    return y;
  } catch { return null; }
}

async function importPlaylist(id, out, seen, yearCache) {
  let url = `https://api.deezer.com/playlist/${id}`;
  const pl = await fetchJson(url);
  const isBRList = BR_HINTS.test(pl.title || '');
  console.log(`Playlist ${id}: ${pl.title} (${pl.nb_tracks} faixas)`);

  let next = `https://api.deezer.com/playlist/${id}/tracks?limit=100`;
  while (next) {
    const page = await fetchJson(next);
    for (const t of page.data || []) {
      const key = `${t.title_short || t.title}::${t.artist?.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const year = await albumYear(t.album?.id, yearCache);
      if (!year || year < 1930) continue;
      out.push({
        id: `dz-${t.id}`,
        title: t.title_short || t.title,
        artist: t.artist?.name,
        composer: t.artist?.name,
        year,
        origem: isBRList ? 'BR' : 'INTL',
        billboardUS: false,
        billboardBR: isBRList,
        preview: t.preview || null,
        deezerId: t.id
      });
    }
    next = page.next || null;
    await new Promise(r => setTimeout(r, 250)); // respeita rate limit
  }
}

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PLAYLISTS;
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'songs.json'), 'utf8'));
  const seen = new Set([...base, ...existing].map(s => `${s.title}::${s.artist}`.toLowerCase()));
  const out = [...existing];
  const yearCache = new Map();

  for (const id of ids) {
    try { await importPlaylist(id, out, seen, yearCache); }
    catch (e) { console.warn(`Falha na playlist ${id}: ${e.message}`); }
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`Total em songs-extra.json: ${out.length} musicas`);
})();
