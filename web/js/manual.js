import { createRobotArm, toRadians } from './robot_arm.js';
import { solveIK, IK_COMPLETE } from './inverse_kinematics.js';
import { sendAngles } from './api.js';
import { mountKeyboardControl } from './keyboard_control.js';

const initialTarget = { x: 1.3, y: 0, z: 1.1 };
const targetFields = ['x', 'y', 'z'];
const fieldNames = [...targetFields, 'palmDeg', 'fingersDeg'];
const handFields = { palmDeg: 'palm', fingersDeg: 'fingers' };

function readFields(readValues) {
  const fields = readValues();
  return Object.fromEntries(fieldNames.map(name => {
    const raw = fields[name];
    if (!['string', 'number'].includes(typeof raw) || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
      throw new Error('Vul alle velden in met geldige getallen.');
    }
    return [name, Number(raw)];
  }));
}

function handAngle(arm, name, degrees) {
  const joint = arm.joints[name];
  return toRadians((degrees - joint.offset) / joint.direction);
}

/** Form status only. All joint angles live in the arm, including direct code edits. */
export function createManualController({ arm, readValues, send = sendAngles, onChange = () => {}, ikComplete = IK_COMPLETE }) {
  const state = { valid: false, error: null, plane: null, pending: false, feedback: null, canSend: false, blockedReason: null };
  let appliedTarget = null;
  let updating = false;
  let disposed = false;

  function publish({ syncHand = state.valid } = {}) {
    state.blockedReason = !state.valid ? state.error : !arm.previewReady ?
      '3D-weergave niet beschikbaar. Herlaad de pagina voordat je verstuurt.' : !ikComplete ?
      'De IK is nog niet volledig uitgewerkt. Werk de IK uit voordat je verstuurt.' : null;
    state.canSend = !disposed && !state.pending && state.blockedReason === null;
    onChange(state, { syncHand });
  }

  // A slider changes just that joint; target edits apply IK and the hand together.
  function update(field = null) {
    if (disposed || state.pending) return;
    updating = true;
    state.feedback = null;
    try {
      const values = readFields(readValues);
      const targetChanged = !appliedTarget || targetFields.some(name => values[name] !== appliedTarget[name]);
      if (handFields[field] && !targetChanged) {
        const name = handFields[field];
        arm.turnJoint(name, handAngle(arm, name, values[field]));
      } else {
        const target = { x: values.x, y: values.y, z: values.z };
        state.plane = solveIK(arm, target, {
          palm: handAngle(arm, 'palm', values.palmDeg),
          fingers: handAngle(arm, 'fingers', values.fingersDeg),
        });
        appliedTarget = Object.fromEntries(targetFields.map(name => [name, values[name]]));
      }
      state.valid = true;
      state.error = null;
    } catch (error) {
      state.valid = false;
      state.error = error.message;
    } finally {
      updating = false;
      publish();
    }
  }

  /** Verplaats het doel zonder een onbereikbare stap in de bediening toe te passen. */
  function moveTarget(delta) {
    if (disposed || state.pending || !state.valid || !arm.previewReady) {
      throw new Error('De arm is momenteel niet beschikbaar voor toetsenbordbediening.');
    }
    const values = readFields(readValues);
    const next = Object.fromEntries(targetFields.map(name =>
      [name, Number((values[name] + delta[name]).toFixed(5))]));
    updating = true;
    try {
      state.plane = solveIK(arm, next);
      appliedTarget = next;
      state.feedback = null;
    } finally {
      updating = false;
    }
    publish();
    return next;
  }

  async function submit() {
    if (disposed || state.pending) return;
    let snapshot;
    try {
      const values = readFields(readValues);
      // Detect edits without an input event, but never rerun IK or overwrite the arm.
      snapshot = arm.getServoAngles();
      if (!appliedTarget || targetFields.some(name => values[name] !== appliedTarget[name]) ||
          Object.entries(handFields).some(([field, name]) => values[field] !== snapshot[arm.joints[name].servoId])) {
        throw new Error('De invoer is gewijzigd. Pas de bediening aan voordat je verstuurt.');
      }
    } catch (error) {
      state.valid = false;
      state.error = error.message;
    }
    publish();
    if (!state.canSend) {
      state.feedback = { kind: 'error', message: state.blockedReason };
      publish();
      return;
    }
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
      if (!disposed) publish();
    }
  }

  const unsubscribe = arm.onChange(() => {
    if (!updating && !disposed) {
      if (!state.pending) state.feedback = null;
      publish({ syncHand: true });
    }
  });
  update();
  return { state, update, moveTarget, submit, dispose() { disposed = true; unsubscribe(); } };
}

/** Connect the page to one arm. The returned arm is also usable from your own code. */
export function mountManual(root) {
  const form = root.querySelector('#manual-form');
  const inputs = Object.fromEntries(fieldNames.map(name => [name, form.elements.namedItem(name)]));
  const button = root.querySelector('#send-angles');
  const canvas = root.querySelector('#arm-canvas');
  const arm = createRobotArm(canvas);
  let keyboard = null;
  const hand = arm.getServoAngles();
  for (const [name, value] of Object.entries({ ...initialTarget,
    palmDeg: hand[arm.joints.palm.servoId], fingersDeg: hand[arm.joints.fingers.servoId] })) inputs[name].value = value;
  for (const [field, name] of Object.entries(handFields)) {
    inputs[field].min = Math.ceil(arm.joints[name].min);
    inputs[field].max = Math.floor(arm.joints[name].max);
    root.querySelector(`[data-range-min="${field}"]`).textContent = `${inputs[field].min}°`;
    root.querySelector(`[data-range-max="${field}"]`).textContent = `${inputs[field].max}°`;
  }
  for (const [name, joint] of Object.entries(arm.joints)) {
    root.querySelector(`[data-servo-id="${name}"]`).textContent = joint.servoId;
  }

  function render(state, { syncHand }) {
    const servoAngles = arm.getServoAngles();
    form.setAttribute('aria-busy', String(state.pending));
    for (const input of Object.values(inputs)) input.disabled = state.pending;
    button.disabled = !state.canSend;
    button.textContent = state.pending ? 'Versturen…' : 'Send Angles';
    canvas.hidden = !arm.previewReady;
    root.querySelector('#preview-fallback').hidden = arm.previewReady;
    const poseStatus = root.querySelector('#pose-status');
    const poseMessage = !arm.previewReady ? '3D-weergave niet beschikbaar. Versturen is geblokkeerd.' :
      !state.valid ? state.error : IK_COMPLETE ? '' :
        'De inverse kinematics is nog in opbouw.';
    if (poseStatus.textContent !== poseMessage) poseStatus.textContent = poseMessage;
    poseStatus.dataset.kind = state.valid ? 'valid' : 'error';
    for (const name of fieldNames) inputs[name].setAttribute('aria-invalid', String(!state.valid));
    root.querySelector('#preview-label').textContent = !arm.previewReady ? '3D niet beschikbaar' :
      !state.valid ? 'Actuele armstand · ongeldige invoer niet toegepast' :
        IK_COMPLETE ? '' : 'Actuele armstand · IK in opbouw';
    root.querySelector('.demo-badge').textContent = arm.calibrated ? 'Gekalibreerd' : 'Demomodel';
    for (const [name, joint] of Object.entries(arm.joints)) {
      root.querySelector(`#angle-${name}`).value = `${servoAngles[joint.servoId]}°`;
    }
    for (const [field, name] of Object.entries(handFields)) {
      const input = inputs[field];
      if (syncHand) input.value = servoAngles[arm.joints[name].servoId];
      root.querySelector(`#${field}-value`).value = `${input.value}°`;
      const extent = Number(input.max) - Number(input.min);
      input.style.setProperty('--slider-fill', `${extent > 0 ? (Number(input.value) - Number(input.min)) / extent * 100 : 0}%`);
    }
    const feedback = root.querySelector('#send-status');
    const feedbackMessage = state.feedback?.message ?? state.blockedReason ?? '';
    if (feedback.textContent !== feedbackMessage) feedback.textContent = feedbackMessage;
    feedback.dataset.kind = state.feedback?.kind ?? 'info';
    keyboard?.setAvailable(!state.pending && arm.previewReady && state.valid,
      state.pending ? 'Wacht tot de hoeken zijn verstuurd.' :
        !arm.previewReady ? '3D-weergave niet beschikbaar.' : 'Vul eerst een geldige doelpositie in.');
  }

  const controller = createManualController({ arm, onChange: render,
    readValues: () => Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value])) });
  keyboard = mountKeyboardControl(root.querySelector('#keyboard-widget'), delta => {
    const next = controller.moveTarget(delta);
    for (const name of targetFields) inputs[name].value = next[name];
  });
  render(controller.state, { syncHand: true });
  const onInput = event => { if (fieldNames.includes(event.target.name)) controller.update(event.target.name); };
  const onSubmit = event => { event.preventDefault(); void controller.submit(); };
  form.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  return { arm, setActive: active => { arm.setActive(active); keyboard.setActive(active); }, dispose() {
    form.removeEventListener('input', onInput);
    form.removeEventListener('submit', onSubmit);
    keyboard.dispose();
    controller.dispose();
    arm.dispose();
  } };
}
