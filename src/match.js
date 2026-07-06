// Comparacao tolerante para validar respostas digitadas (artista, titulo)

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')      // remove acentos
    .replace(/\(.*?\)|\[.*?\]/g, ' ')      // remove parenteses: (ao vivo), [remix]
    .replace(/feat\.?|ft\.?|part\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// Aceita resposta se bater com o interprete OU com o autor original
function matchArtist(guess, song) {
  const targets = [song.artist, song.composer].filter(Boolean);
  return targets.some(t =>
    t.split(/[,&\/]| e /i).some(part => similarity(guess, part) >= 0.78) ||
    similarity(guess, t) >= 0.78
  );
}

function matchTitle(guess, song) {
  return similarity(guess, song.title) >= 0.78;
}

module.exports = { normalize, similarity, matchArtist, matchTitle };
