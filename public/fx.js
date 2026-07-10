/* Vitrola FX: feedback grande e imediato para cada acao, estilo 1-2-Switch */
(function () {
  const layer = document.createElement('div');
  layer.id = 'fx-flash';

  // ---------------- faixa inferior de tamanho da interface ----------------
  // Ajusta o tamanho de tudo na tela (util pra TV longe do sofa ou celular pequeno).
  // Persiste por aparelho (localStorage: o tamanho de tela e do aparelho, faz sentido lembrar).
  const SCALE_KEY = 'vitrola_ui_scale';
  const SCALE_MIN = 0.75, SCALE_MAX = 1.6, SCALE_STEP = 0.05;

  function applyScale(v) {
    document.documentElement.style.setProperty('--ui-scale', v);
    const pct = document.getElementById('ui-scale-pct');
    if (pct) pct.textContent = Math.round(v * 100) + '%';
  }

  function buildScaleBar() {
    if (document.getElementById('ui-scale-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ui-scale-bar';
    bar.innerHTML = `
      <button type="button" id="ui-scale-down" aria-label="Diminuir tamanho">A−</button>
      <input type="range" id="ui-scale-range" min="${SCALE_MIN}" max="${SCALE_MAX}" step="${SCALE_STEP}" value="1">
      <span id="ui-scale-pct" class="num">100%</span>
      <button type="button" id="ui-scale-up" aria-label="Aumentar tamanho">A+</button>
      <button type="button" id="ui-fullscreen" aria-label="Tela cheia" title="Tela cheia (mantem a tela acesa)">Tela cheia</button>
    `;
    document.body.appendChild(bar);

    let saved = parseFloat(localStorage.getItem(SCALE_KEY));
    if (!saved || isNaN(saved)) saved = 1;
    saved = Math.min(SCALE_MAX, Math.max(SCALE_MIN, saved));
    bar.querySelector('#ui-scale-range').value = saved;
    applyScale(saved);

    const range = bar.querySelector('#ui-scale-range');
    function set(v) {
      v = Math.min(SCALE_MAX, Math.max(SCALE_MIN, v));
      range.value = v;
      applyScale(v);
      localStorage.setItem(SCALE_KEY, v);
    }
    range.addEventListener('input', () => set(parseFloat(range.value)));
    bar.querySelector('#ui-scale-down').addEventListener('click', () => set(parseFloat(range.value) - SCALE_STEP));
    bar.querySelector('#ui-scale-up').addEventListener('click', () => set(parseFloat(range.value) + SCALE_STEP));

    // tela cheia + wake lock: evita o celular apagar/travar por inatividade
    const fsBtn = bar.querySelector('#ui-fullscreen');
    fsBtn.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); fsBtn.textContent = 'Sair da tela cheia'; }
        else { await document.exitFullscreen(); fsBtn.textContent = 'Tela cheia'; }
      } catch {}
      window.FX?.keepAwake();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(layer);
    buildScaleBar();
  });

  function themeVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  window.FX = {
    // flash de tela inteira (cor do tema por padrao)
    flash(color) {
      layer.style.background = color || themeVar('--gold');
      layer.classList.remove('on');
      void layer.offsetWidth; // reinicia a animacao
      layer.classList.add('on');
    },

    // chacoalha um elemento (padrao: tela toda)
    shake(el) {
      el = el || document.body;
      el.classList.remove('fx-shake');
      void el.offsetWidth;
      el.classList.add('fx-shake');
      setTimeout(() => el.classList.remove('fx-shake'), 600);
    },

    zoom(el) {
      if (!el) return;
      el.classList.remove('fx-zoom-pulse');
      void el.offsetWidth;
      el.classList.add('fx-zoom-pulse');
    },

    // chuva de confete nas cores do tema
    confetti(n = 90) {
      const colors = [themeVar('--gold'), themeVar('--hot'), themeVar('--ok'), themeVar('--cream')];
      for (let i = 0; i < n; i++) {
        const p = document.createElement('span');
        p.className = 'confetti-piece';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.background = colors[i % colors.length];
        p.style.animationDuration = (2 + Math.random() * 2.2) + 's';
        p.style.animationDelay = (Math.random() * .8) + 's';
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 5200);
      }
    },

    // vibracao no celular (ignorada onde nao ha suporte)
    vibrate(pattern) {
      try { navigator.vibrate?.(pattern); } catch {}
    },

    // contagem animada de numero (ex: ano na revelacao)
    countUp(el, target, ms = 900) {
      const start = Math.max(1900, target - 45);
      const t0 = performance.now();
      function tick(t) {
        const k = Math.min(1, (t - t0) / ms);
        const ease = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(start + (target - start) * ease);
        if (k < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    },

    // aplica o tema da sala em qualquer tela
    theme(name) {
      if (name) document.documentElement.dataset.theme = name;
    },

    // mantem a tela acesa (Screen Wake Lock), readquirindo ao voltar para a aba
    async keepAwake() {
      try {
        if (!('wakeLock' in navigator)) return;
        if (window._wakeLock) return;
        window._wakeLock = await navigator.wakeLock.request('screen');
        window._wakeLock.addEventListener('release', () => { window._wakeLock = null; });
        if (!window._wakeBound) {
          window._wakeBound = true;
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') window.FX.keepAwake();
          });
        }
      } catch { window._wakeLock = null; }
    }
  };
})();
