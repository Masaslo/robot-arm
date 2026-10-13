import { ARM_CONFIG, INITIAL_TARGET, INITIAL_PALM_DEG, INITIAL_FINGERS_DEG } from './joint_config.js';
import { buildPose } from './pose.js';
import { sendAngles } from './api.js';
import { createRobotArmView } from './robot_arm.js';

const fieldNames = ['x', 'y', 'z', 'toolPitchDeg', 'palmDeg', 'fingersDeg'];

function poseFromFields(fields, config) {
  const numbers = {};
  for (const name of fieldNames) {
    const raw = fields[name];
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
      return { valid: false, canSend: false, error: 'Vul alle velden in met geldige getallen.', servoAnglesDeg: null };
    }
    numbers[name] = Number(raw);
  }
  return buildPose({ x: numbers.x, y: numbers.y, z: numbers.z, toolPitchDeg: numbers.toolPitchDeg },
    numbers.palmDeg, numbers.fingersDeg, config);
}

/** Owns validation and transmission state; only an explicit submit can send. */
export function createManualController({ readValues, config = ARM_CONFIG, send = sendAngles, onChange = () => {} }) {
  let state = { pose: null, lastValidPose: null, pending: false, previewReady: true, feedback: null, canSend: false };
  function publish() {
    state.canSend = Boolean(state.pose?.canSend && state.previewReady && !state.pending);
    onChange(state);
  }
  function evaluate() {
    state.pose = poseFromFields(readValues(), config);
    if (state.pose.valid) state.lastValidPose = state.pose;
  }
  function update() {
    if (state.pending) return;
    state.feedback = null;
    evaluate();
    publish();
  }
  function setPreviewReady(ready) {
    state.previewReady = Boolean(ready);
    state.feedback = null;
    publish();
  }
  async function submit() {
    if (state.pending) return;
    evaluate();
    if (!state.pose.canSend || !state.previewReady) {
      state.feedback = { kind: 'error', message: !state.previewReady ? '3D-weergave niet beschikbaar. Herlaad de pagina voordat je verstuurt.' :
        state.pose.error || state.pose.blockedReason };
      publish();
      return;
    }
    const snapshot = { ...state.pose.servoAnglesDeg };
    state.pending = true;
    state.feedback = { kind: 'pending', message: 'Hoeken versturen… Wacht op antwoord van de backend.' };
    publish();
    try {
      await send(snapshot);
      state.feedback = { kind: 'success', message: 'Doel geaccepteerd door de backend. De beweging kan nog bezig zijn.' };
    } catch (error) {
      state.feedback = { kind: 'error', message: `${error instanceof Error ? error.message : 'Versturen mislukt.'} Controleer de verbinding en probeer opnieuw.` };
    } finally {
      state.pending = false;
      publish();
    }
  }
  evaluate();
  publish();
  return { get state() { return state; }, update, submit, setPreviewReady };
}

export function mountManual(root, config = ARM_CONFIG) {
  const form = root.querySelector('#manual-form');
  const inputs = Object.fromEntries(fieldNames.map(name => [name, form.elements.namedItem(name)]));
  const button = form.querySelector('#send-angles');
  const feedback = root.querySelector('#send-status');
  const poseStatus = root.querySelector('#pose-status');
  const previewLabel = root.querySelector('#preview-label');
  const calibration = root.querySelector('#calibration-status');
  const readoutsLabel = root.querySelector('#readouts-label');
  const fallback = root.querySelector('#preview-fallback');
  const canvas = root.querySelector('#arm-canvas');
  let view = null;
  let drawnPose = null;

  for (const [name, value] of Object.entries({ ...INITIAL_TARGET, palmDeg: INITIAL_PALM_DEG, fingersDeg: INITIAL_FINGERS_DEG })) {
    inputs[name].value = value;
  }

  // Sliders represent physical servo commands, constrained by their calibrated limits.
  for (const [name, id] of [['palmDeg', 4], ['fingersDeg', 5]]) {
    const joint = config.joints?.find(joint => joint.id === id);
    if (joint && Number.isFinite(joint.minDeg) && Number.isFinite(joint.maxDeg)) {
      inputs[name].min = joint.minDeg;
      inputs[name].max = joint.maxDeg;
    }
    root.querySelector(`[data-range-min="${name}"]`).textContent = `${inputs[name].min}°`;
    root.querySelector(`[data-range-max="${name}"]`).textContent = `${inputs[name].max}°`;
  }
  try { view = createRobotArmView(canvas, config); } catch {
    canvas.hidden = true;
    fallback.hidden = false;
  }

  function render(state) {
    form.setAttribute('aria-busy', String(state.pending));
    for (const input of Object.values(inputs)) input.disabled = state.pending;
    button.disabled = !state.canSend;
    button.textContent = state.pending ? 'Versturen…' : 'Send Angles';
    calibration.textContent = config.calibrated === true ? 'Kalibratie actief · controleer de vrije werkruimte.' :
      'Demomodel · versturen geblokkeerd tot de arm is gekalibreerd.';
    const hasPreview = Boolean(state.lastValidPose && state.previewReady);
    poseStatus.textContent = !state.previewReady ? '3D-weergave niet beschikbaar. Versturen is geblokkeerd.' :
      state.pose.valid ? 'Doel berekend. De weergave toont de berekende pose.' : state.pose.error;
    poseStatus.dataset.kind = state.pose.valid ? 'valid' : 'error';
    for (const name of ['x', 'y', 'z', 'toolPitchDeg']) {
      inputs[name].setAttribute('aria-invalid', String(!state.pose.valid));
    }
    previewLabel.textContent = !state.previewReady ? '3D niet beschikbaar' : !state.pose.valid ?
      (hasPreview ? 'Laatste geldige pose · huidig doel niet toegepast' : 'Nog geen geldige pose') :
      config.calibrated === true ? 'Berekende pose · gekalibreerd model' : 'Berekende pose · demogeometrie';
    root.querySelector('.demo-badge').textContent = config.calibrated === true ? 'Gekalibreerd' : 'Demomodel';
    readoutsLabel.textContent = state.pose.valid ? 'Servohoeken · kanalen 0–5' : 'Laatste geldige servohoeken · huidig doel niet toegepast';
    for (const joint of config.joints ?? []) {
      const output = root.querySelector(`#angle-${joint.id}`);
      if (output) output.value = state.lastValidPose ? `${state.lastValidPose.servoAnglesDeg[joint.id]}°` : '—';
    }
    for (const name of ['palmDeg', 'fingersDeg']) {
      const input = inputs[name];
      root.querySelector(`#${name}-value`).value = `${input.value}°`;
      const extent = Number(input.max) - Number(input.min);
      input.style.setProperty('--slider-fill', `${extent > 0 ? (Number(input.value) - Number(input.min)) / extent * 100 : 0}%`);
    }
    feedback.textContent = state.feedback?.message ?? (state.pose.valid ? state.pose.blockedReason ?? 'Klaar om de zes servohoeken te versturen.' : 'Pas het doel aan om opnieuw te berekenen.');
    feedback.dataset.kind = state.feedback?.kind ?? 'info';
    if (view && state.lastValidPose && state.lastValidPose !== drawnPose) {
      view.setPose(state.lastValidPose);
      drawnPose = state.lastValidPose;
    }
  }
  const controller = createManualController({ readValues: () => Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value])), config, onChange: render });
  if (!view) controller.setPreviewReady(false);
  const onInput = () => controller.update();
  const onSubmit = event => { event.preventDefault(); void controller.submit(); };
  form.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  // Context loss can happen after a successful initial WebGL setup.
  canvas.addEventListener('webglcontextlost', () => {
    view?.setActive(false);
    canvas.hidden = true;
    fallback.hidden = false;
    controller.setPreviewReady(false);
  });
  return { setActive: active => view?.setActive(active), dispose: () => {
    form.removeEventListener('input', onInput);
    form.removeEventListener('submit', onSubmit);
    view?.dispose();
  } };
}
