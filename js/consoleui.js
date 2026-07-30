/* Kartenburg — console-style focus navigation, in the spirit of the Xbox
 * design principles for 10-foot UI: exactly one focused element on every
 * screen, arrows / d-pad move it, Enter / A selects, Esc / B goes back,
 * and a persistent hint bar says so. A pure overlay: mouse and touch
 * keep working exactly as before. */

(() => {
  const byId = id => document.getElementById(id);
  const vis = id => { const el = byId(id); return el && !el.classList.contains('hidden'); };

  let layerKey = '';
  let focusEl = null;
  let padSeen = false;
  let lastHints = null;

  /* The topmost interactive layer, its focusable scope and its hints. */
  function activeLayer() {
    if (document.body.classList.contains('on-title')) {
      return { el: byId('titleScreen'), key: 'title', hints: null };
    }
    if (vis('howto')) return { el: byId('howto'), key: 'howto', hints: 'page' };
    if (vis('actionModal')) {
      return { el: byId('actionModal'), key: 'am:' + byId('amTitle').textContent, hints: 'select' };
    }
    if (vis('handoff')) return { el: byId('handoff'), key: 'handoff', hints: 'select' };
    if (vis('endModal')) return { el: byId('endModal'), key: 'end', hints: 'select' };
    if (vis('pauseMenu')) return { el: byId('pauseMenu'), key: 'pause', hints: 'selectback' };
    if (vis('logDrawer')) return { el: byId('logDrawer'), key: 'log', hints: 'selectback' };
    if (vis('setup')) {
      if (vis('menuPlayers')) {
        return { el: byId('menuPlayers'), key: 'players', hints: 'selectback', esc: () => showMainMenu() };
      }
      return { el: byId('menuMain'), key: 'main', hints: 'select' };
    }
    if (vis('gameArea') && vis('tutorBox') &&
        byId('tutNextBtn').style.display !== 'none') {
      return { el: byId('tutorBox'), key: 'tut', hints: 'select' };
    }
    return null;
  }

  function focusables(layer) {
    if (!layer) return [];
    return Array.from(layer.el.querySelectorAll('button, .am-option, .am-cards .pcard'))
      .filter(el => !el.disabled && el.getClientRects().length);
  }

  function setFocus(el) {
    if (focusEl && focusEl !== el) focusEl.classList.remove('kb-focus');
    focusEl = el || null;
    if (focusEl) {
      focusEl.classList.add('kb-focus');
      if (focusEl.scrollIntoView) focusEl.scrollIntoView({ block: 'nearest' });
    }
  }

  /* Default focus: the primary action, else the first control on the layer. */
  function refresh() {
    const layer = activeLayer();
    const key = layer ? layer.key : '';
    if (key !== layerKey) {
      layerKey = key;
      setFocus(null);
      if (layer && layer.hints) {
        const list = focusables(layer);
        setFocus(list.find(el => el.classList.contains('primary')) || list[0] || null);
      }
    } else if (focusEl && !focusEl.getClientRects().length) {
      setFocus(null); // the focused control re-rendered away
    }
    updateHints(layer);
    return layer;
  }

  /* The kit lives in ui.js; guard so consoleui keeps working on its own. */
  function say(name) {
    if (typeof sfx !== 'undefined' && sfx.play) sfx.play(name);
  }

  function move(dir) {
    const layer = activeLayer();
    if (!layer || !layer.hints) return false;
    const list = focusables(layer);
    if (!list.length) return false;
    let idx = list.indexOf(focusEl);
    idx = idx === -1 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
    setFocus(list[idx]);
    say('menu-move');
    return true;
  }

  function activate() {
    const layer = activeLayer();
    if (!layer || !layer.hints) return false;
    const target = (focusEl && focusEl.getClientRects().length) ? focusEl : focusables(layer)[0];
    if (!target) return false;
    say('menu-select');
    target.click();
    return true;
  }

  document.addEventListener('keydown', e => {
    const layer = refresh();
    if (!layer) return;
    if (e.key === 'Escape' && layer.esc) { say('menu-back'); layer.esc(); e.preventDefault(); return; }
    if (layer.key === 'title') {
      if (e.key === 'Enter') { enterMenu(); e.preventDefault(); }
      return;
    }
    if (!layer.hints) return;
    if (layer.key === 'howto' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      howtoStep(e.key === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { if (move(1)) e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { if (move(-1)) e.preventDefault(); }
    else if (e.key === 'Enter') { if (activate()) e.preventDefault(); }
  });

  /* ── Gamepad: d-pad / left stick, A select, B back ──────────────────── */

  const padAt = {};
  function padPress(name, down) {
    const now = Date.now();
    if (!down) { padAt[name] = 0; return false; }
    if (now - (padAt[name] || 0) < 240) return false;
    padAt[name] = now;
    return true;
  }

  setInterval(() => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (!pads.length) return;
    if (!padSeen) { padSeen = true; lastHints = null; }
    const p = pads[0];
    const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
    const layer = refresh();
    if (!layer) return;
    if (padPress('down', b(13) || p.axes[1] > 0.55)) move(1);
    if (padPress('up', b(12) || p.axes[1] < -0.55)) move(-1);
    if (layer.key === 'howto') {
      if (padPress('right', b(15) || p.axes[0] > 0.55)) howtoStep(1);
      if (padPress('left', b(14) || p.axes[0] < -0.55)) howtoStep(-1);
    }
    if (padPress('a', b(0))) {
      if (layer.key === 'title') enterMenu();
      else activate();
    }
    if (padPress('b', b(1))) {
      say('menu-back');
      if (layer.esc) layer.esc();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
  }, 50);

  /* ── Hint bar ────────────────────────────────────────────────────────── */

  const KEYS = {
    select: () => padSeen ? 'Ⓐ' : '⏎',
    back: () => padSeen ? 'Ⓑ' : 'Esc',
    page: () => padSeen ? '✚' : '◀ ▶',
  };

  function updateHints(layer) {
    const bar = byId('hintBar');
    if (!bar) return;
    const mode = layer && layer.hints;
    const sig = (mode || '') + (padSeen ? '!p' : '');
    if (sig === lastHints) return;
    lastHints = sig;
    if (!mode) { bar.classList.add('hidden'); return; }
    const chip = (k, label) => '<span class="hint"><span class="key">' + k + '</span>' + label + '</span>';
    let html = chip(KEYS.select(), 'Select');
    if (mode === 'selectback') html += chip(KEYS.back(), 'Back');
    if (mode === 'page') html = chip(KEYS.page(), 'Page') + html + chip(KEYS.back(), 'Close');
    bar.innerHTML = html;
    bar.classList.remove('hidden');
  }

  // Layers open and close from many code paths; a light poll keeps the
  // focus target and hints honest without touching every call site.
  setInterval(refresh, 300);
})();
