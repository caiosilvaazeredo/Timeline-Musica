// Expande o banco em direcao a milhares de musicas usando a API publica do Deezer (sem chave).
// 1) Descobre playlists reais por busca (nao depende de IDs fixos que podem sumir)
// 2) Coleta as faixas de cada playlist
// 3) Resolve o ano de lancamento (via /album/{id}) com um pool de requisicoes paralelas,
//    porque a listagem de faixas nao traz o ano, so o album relacionado
//
// Uso:  node scripts/import-deezer.js [alvo_de_musicas]
// Saida: data/songs-extra.json (mesclado automaticamente pelo servidor com data/songs.json)

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'songs-extra.json');
const BASE = path.join(__dirname, '..', 'data', 'songs.json');
const TARGET = Number(process.argv[2]) || 3200;
const CONCURRENCY = 16;

// Termos de busca de playlists: cobrem decadas e generos, nacionais e internacionais.
// origem e so um palpite inicial (heuristico pelo termo); refinado por deteccao de idioma do titulo.
const QUERIES = [
  ...['anos 60', 'anos 70', 'anos 80', 'anos 90', 'anos 2000', 'anos 2010', 'hits 2020', 'hits 2024']
    .map(q => ({ q, origem: 'AMBAS' })),
  ...['MPB', 'samba', 'bossa nova', 'pagode', 'sertanejo', 'sertanejo universitario', 'forro',
      'axe music', 'funk carioca', 'rock brasileiro', 'rap nacional', 'trap brasileiro', 'pisadinha',
      'pagode raiz', 'samba enredo', 'brega funk', 'reggae brasileiro', 'rock nacional anos 80']
    .map(q => ({ q, origem: 'BR' })),
  ...['60s hits', '70s hits', '80s hits', '90s hits', '2000s hits', '2010s hits',
      'classic rock', 'pop hits', 'r&b classics', 'hip hop classics', 'disco hits',
      'indie rock', 'k-pop hits', 'reggae classics', 'country hits', 'edm hits',
      'grunge hits', 'britpop', 'latin pop hits', 'soul classics', 'punk rock classics']
    .map(q => ({ q, origem: 'INTL' }))
];

const BR_HINT = /[çãõáéíóúâêô]|brasil|sertanej|pagode|samba|forr[oó]|ax[eé]|funk carioca|mpb/i;

// Fora do espirito de "hits que todo mundo reconhece": hinos, covers, karaoke, etc.
const PLAYLIST_BLACKLIST = /hino|gospel|evangeli|coverr?s?\b|karaok[eê]|tributo|tribute|instrumental|playback|infantil|desenho/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(600 * (i + 1)); continue; }
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(300 * (i + 1));
    }
  }
}

// pool simples de concorrencia
async function pool(items, limit, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i).catch(() => {});
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(run));
}

async function findPlaylists(query, want = 2) {
  const data = await getJson(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}`);
  return (data?.data || [])
    .filter(p => p.nb_tracks >= 30 && !PLAYLIST_BLACKLIST.test(p.title))
    .sort((a, b) => b.nb_tracks - a.nb_tracks)
    .slice(0, want);
}

async function collectTracks(playlistId, seenKeys, out, origem, cap = 250) {
  let url = `https://api.deezer.com/playlist/${playlistId}/tracks?limit=100`;
  let collected = 0;
  while (url && collected < cap) {
    const page = await getJson(url);
    if (!page?.data) break;
    for (const t of page.data) {
      if (!t.artist?.name || !t.title_short) continue;
      const key = `${t.title_short}::${t.artist.name}`.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({ dzId: t.id, title: t.title_short, artist: t.artist.name, albumId: t.album?.id, preview: t.preview || null, origemHint: origem });
      collected++;
    }
    url = page.next || null;
  }
  return collected;
}

(async () => {
  console.log(`Alvo: ${TARGET} musicas. Descobrindo playlists...`);
  const seenKeys = new Set();
  const existingBase = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : [];
  existingBase.forEach(s => seenKeys.add(`${s.title}::${s.artist}`.toLowerCase()));

  const raw = [];
  for (const { q, origem } of QUERIES) {
    if (raw.length >= TARGET * 1.7) break; // buffer para descartes sem ano valido
    try {
      const playlists = await findPlaylists(q);
      for (const pl of playlists) {
        const added = await collectTracks(pl.id, seenKeys, raw, origem, 250);
        console.log(`  "${q}" -> ${pl.title} (${pl.nb_tracks} faixas): +${added} novas | total bruto ${raw.length}`);
      }
    } catch (e) {
      console.warn(`  falha em "${q}": ${e.message}`);
    }
  }

  console.log(`Faixas brutas coletadas: ${raw.length}. Resolvendo anos de lancamento (${CONCURRENCY} em paralelo)...`);
  const albumCache = new Map();
  const uniqueAlbumIds = [...new Set(raw.map(r => r.albumId).filter(Boolean))];
  let done = 0;
  await pool(uniqueAlbumIds, CONCURRENCY, async (albumId) => {
    try {
      const a = await getJson(`https://api.deezer.com/album/${albumId}`);
      const year = a?.release_date ? Number(a.release_date.slice(0, 4)) : null;
      albumCache.set(albumId, year);
    } catch { albumCache.set(albumId, null); }
    done++;
    if (done % 200 === 0) console.log(`  albuns resolvidos: ${done}/${uniqueAlbumIds.length}`);
  });

  const out = [];
  const nowYear = new Date().getFullYear();
  for (const r of raw) {
    const year = albumCache.get(r.albumId);
    if (!year || year < 1930 || year > nowYear) continue;
    if (!r.preview) continue;   // sem preview: descarta por seguranca de qualidade
    const isBR = r.origemHint === 'BR' || (r.origemHint === 'AMBAS' && BR_HINT.test(r.artist + ' ' + r.title));
    out.push({
      id: `dz-${r.dzId}`,
      title: r.title,
      artist: r.artist,
      composer: r.artist,   // API publica do Deezer nao expoe compositor de forma confiavel
      year,
      origem: isBR ? 'BR' : 'INTL',
      billboardUS: false,
      billboardBR: isBR,
      preview: r.preview,
      deezerId: r.dzId
    });
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`Concluido: ${out.length} musicas novas gravadas em ${path.relative(process.cwd(), OUT)}`);
  console.log(`Total do banco (curado + novas): ${existingBase.length + out.length}`);
})();
