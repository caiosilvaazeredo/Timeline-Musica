/* Vitrola FX: feedback grande e imediato para cada acao, estilo 1-2-Switch */
(function () {
  const layer = document.createElement('div');
  layer.id = 'fx-flash';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(layer));

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
    }
  };
})();
