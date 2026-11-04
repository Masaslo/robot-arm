// Vanilla versie van de ControlWidget/useManualDrive uit h-robo-twin-rsl.
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);

/** Toetsenbord en schermknoppen bewegen alleen het endpoint in de preview. */
export function mountKeyboardControl(widget, moveTarget) {
  const document = widget.ownerDocument;
  const browser = document.defaultView;
  const toggle = widget.querySelector('#keyboard-toggle');
  const buttons = [...widget.querySelectorAll('[data-move-key]')];
  const speed = widget.querySelector('#keyboard-speed');
  const speedValue = widget.querySelector('#keyboard-speed-value');
  const status = widget.querySelector('#keyboard-status');
  const keys = new Set();
  const pointers = new Map();
  let enabled = false;
  let available = false;
  let active = true;
  let timer = null;
  let message = 'Bediening uit.';

  function heldKeys() { return new Set([...keys, ...pointers.values()]); }

  function render() {
    const held = heldKeys();
    toggle.disabled = !available || !active;
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Bediening uitschakelen' : 'Bediening inschakelen';
    speed.disabled = !available || !active;
    speedValue.value = `${speed.value}%`;
    speed.style.setProperty('--slider-fill', `${(Number(speed.value) - 10) / 90 * 100}%`);
    for (const button of buttons) {
      button.disabled = !enabled;
      const code = button.dataset.moveKey;
      button.classList.toggle('is-active', held.has(code) || (code === 'ShiftLeft' && held.has('ShiftRight')));
    }
    if (status.textContent !== message) status.textContent = message;
    widget.dataset.enabled = String(enabled);
  }

  function clearKeys() {
    keys.clear();
    pointers.clear();
    browser.clearInterval(timer);
    timer = null;
    render();
  }

  function stop(reason = 'Bediening uit.') {
    enabled = false;
    message = reason;
    clearKeys();
  }

  function move() {
    if (!enabled || !available || !active || document.hidden || !widget.contains(document.activeElement)) {
      stop();
      return;
    }
    const held = heldKeys();
    const x = Number(held.has('KeyW')) - Number(held.has('KeyS'));
    const y = Number(held.has('KeyA')) - Number(held.has('KeyD'));
    const z = Number(held.has('Space')) - Number(held.has('ShiftLeft') || held.has('ShiftRight'));
    const length = Math.hypot(x, y, z);
    if (length === 0) return;

    // Elke 50 ms een kleine stap. Diagonaal bewegen gaat niet sneller.
    const step = 0.5 * Number(speed.value) / 100 * 0.05;
    try {
      moveTarget({ x: x / length * step, y: y / length * step, z: z / length * step });
      message = 'Actief · alleen preview.';
    } catch (error) {
      message = `${error.message} Kies een andere richting.`;
      clearKeys();
    }
    render();
  }

  function startMoving() {
    if (timer === null && heldKeys().size > 0) {
      timer = browser.setInterval(move, 50);
      move();
    }
    render();
  }

  function release() {
    if (heldKeys().size === 0) clearKeys();
    else render();
  }

  function keyCode(event) {
    const button = event.target.closest('[data-move-key]');
    // Space/Enter kan ook een gefocuste schermknop bedienen.
    if (button && (event.code === 'Space' || event.code === 'Enter')) return button.dataset.moveKey;
    return event.code;
  }

  function keydown(event) {
    if (!enabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
      toggle.focus();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) { clearKeys(); return; }
    // De aan/uit-knop blijft met Space en Enter normaal te bedienen.
    if (event.target === toggle && (event.code === 'Space' || event.code === 'Enter')) return;
    if (event.target.closest('input, textarea, select, [contenteditable]')) return;
    const code = keyCode(event);
    if (!movementKeys.has(code)) return;
    event.preventDefault();
    if (event.repeat) return;
    keys.add(code);
    startMoving();
  }

  function keyup(event) {
    if (keys.delete(keyCode(event))) {
      event.preventDefault();
      release();
    }
  }

  function pointerdown(event) {
    const button = event.target.closest('[data-move-key]');
    if (!enabled || !button || event.button !== 0) return;
    event.preventDefault();
    widget.focus();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, button.dataset.moveKey);
    startMoving();
  }

  function pointerup(event) {
    pointers.delete(event.pointerId);
    release();
  }

  function toggleControl() {
    if (enabled) { stop(); return; }
    if (!available || !active) return;
    enabled = true;
    message = 'Actief · alleen preview.';
    widget.focus();
    render();
  }

  function focusout(event) {
    clearKeys();
    if (!widget.contains(event.relatedTarget)) stop('Bediening uit · focus verplaatst.');
  }
  const blur = () => stop('Bediening uit · venster verlaten.');
  const visibility = () => { if (document.hidden) stop(); };
  const updateSpeed = () => { clearKeys(); render(); };

  toggle.addEventListener('click', toggleControl);
  speed.addEventListener('input', updateSpeed);
  widget.addEventListener('keydown', keydown);
  widget.addEventListener('keyup', keyup);
  widget.addEventListener('pointerdown', pointerdown);
  widget.addEventListener('pointerup', pointerup);
  widget.addEventListener('pointercancel', pointerup);
  widget.addEventListener('lostpointercapture', pointerup);
  widget.addEventListener('focusout', focusout);
  browser.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility);
  render();

  return {
    setAvailable(value, reason = 'Bediening tijdelijk niet beschikbaar.') {
      const wasAvailable = available;
      available = Boolean(value);
      if (!available) stop(reason);
      else {
        if (!wasAvailable) message = 'Bediening uit.';
        render();
      }
    },
    setActive(value) { active = Boolean(value); if (!active) stop(); else render(); },
    dispose() {
      stop();
      toggle.removeEventListener('click', toggleControl);
      speed.removeEventListener('input', updateSpeed);
      widget.removeEventListener('keydown', keydown);
      widget.removeEventListener('keyup', keyup);
      widget.removeEventListener('pointerdown', pointerdown);
      widget.removeEventListener('pointerup', pointerup);
      widget.removeEventListener('pointercancel', pointerup);
      widget.removeEventListener('lostpointercapture', pointerup);
      widget.removeEventListener('focusout', focusout);
      browser.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
