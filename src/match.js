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

// Palavras irrelevantes ignoradas na comparacao por tokens
const STOP = new Set(['the', 'a', 'o', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'dos', 'das', 'e', 'and', 'banda', 'grupo', 'mc', 'dj', 'feat', 'ft', 'part']);

function tokens(s) {
  return normalize(s).split(' ').filter(w => w.length > 1 && !STOP.has(w));
}

// Pontuacao por tokens: cada palavra do palpite conta se casar (com tolerancia a
// erro de digitacao) com alguma palavra do alvo. Assim "bohemian rapsody",
// "queen bohemian" ou "ravel bolero" passam mesmo sem escrita exata.
function tokenScore(guess, target) {
  const tg = tokens(guess), tt = tokens(target);
  if (!tg.length || !tt.length) return 0;
  let hits = 0;
  for (const w of tg) if (tt.some(x => similarity(x, w) >= 0.8)) hits++;
  return hits / Math.max(tg.length, tt.length);
}

// Casamento tolerante: aceita similaridade global alta (erros de digitacao),
// contencao (ja tratada em similarity) ou 2/3 das palavras relevantes batendo
function fuzzyMatch(guess, target) {
  if (!guess || !target) return false;
  return similarity(guess, target) >= 0.74 || tokenScore(guess, target) >= 0.67;
}

// Aceita resposta se bater com o interprete OU com o autor original,
// inteiro ou qualquer um dos nomes (ex: "jobim" vale para "Tom Jobim e Vinicius de Moraes")
function matchArtist(guess, song) {
  const targets = [song.artist, song.composer].filter(Boolean);
  return targets.some(t =>
    fuzzyMatch(guess, t) ||
    t.split(/[,&\/]| e /i).some(part => part.trim() && fuzzyMatch(guess, part))
  );
}

function matchTitle(guess, song) {
  return fuzzyMatch(guess, song.title);
}

module.exports = { normalize, similarity, tokenScore, fuzzyMatch, matchArtist, matchTitle };
