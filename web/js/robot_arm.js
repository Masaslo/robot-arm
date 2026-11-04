import { createArmView } from './arm_view.js';

// Edit the arm here. These are demo measurements, not hardware calibration.
export const ARM_SETTINGS = {
  calibrated: false,
  dimensions: { baseHeight: 0.5, upperArm: 1, forearm: 0.8, tool: 0.35 },
  joints: {
    hip:      { servoId: 0, label: 'Heup',     offset: 90,  direction: 1, min: 0, max: 180 },
    shoulder: { servoId: 1, label: 'Schouder', offset: 0,   direction: 1, min: 0, max: 180 },
    elbow:    { servoId: 2, label: 'Elleboog', offset: 180, direction: 1, min: 0, max: 180 },
    wrist:    { servoId: 3, label: 'Pols',     offset: 90,  direction: 1, min: 0, max: 180 },
    palm:     { servoId: 4, label: 'Palm',     offset: 90,  direction: 1, min: 0, max: 180 },
    fingers:  { servoId: 5, label: 'Vingers',  offset: 90,  direction: 1, min: 0, max: 180 },
  },
};

export const toRadians = degrees => degrees * Math.PI / 180;
export const toDegrees = radians => radians * 180 / Math.PI;
const jointNames = ['hip', 'shoulder', 'elbow', 'wrist', 'palm', 'fingers'];
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** One arm owns its angles. Omit canvas to use the arm without a browser preview. */
export function createRobotArm(canvas = null, settings = ARM_SETTINGS) {
  const dimensions = Object.freeze({ ...settings?.dimensions });
  if (!['baseHeight', 'upperArm', 'forearm', 'tool'].every(name => finite(dimensions[name])) ||
      dimensions.baseHeight < 0 || dimensions.upperArm <= 0 || dimensions.forearm <= 0 || dimensions.tool < 0) {
    throw new Error('Ongeldige armgeometrie: controleer de lengtes.');
  }
  if (typeof settings?.calibrated !== 'boolean' || !settings.joints ||
      Reflect.ownKeys(settings.joints).length !== jointNames.length) {
    throw new Error('Geef instellingen voor precies zes benoemde gewrichten op.');
  }
  const joints = Object.freeze(Object.fromEntries(jointNames.map(name => {
    const joint = settings.joints[name];
    if (!Object.hasOwn(settings.joints, name) || !joint ||
        !Number.isInteger(joint.servoId) || joint.servoId < 0 || joint.servoId > 5 ||
        typeof joint.label !== 'string' || !joint.label.trim() ||
        ![joint.offset, joint.min, joint.max].every(finite) ||
        joint.min < 0 || joint.max > 180 || joint.min > joint.max || ![1, -1].includes(joint.direction)) {
      throw new Error(`Ongeldige servo-instellingen voor ${name}.`);
    }
    return [name, Object.freeze({ ...joint })];
  })));
  if (new Set(Object.values(joints).map(joint => joint.servoId)).size !== 6) {
    throw new Error('Elk gewricht moet een eigen servo-ID hebben.');
  }
  const calibrated = settings.calibrated;
  let angles = Object.fromEntries(jointNames.map(name => [name, 0]));
  let view = null;
  let previewReady = false;
  let disposed = false;
  const listeners = new Set();

  // Servo values are derived, never stored as a second copy of the arm state.
  function servoAnglesFor(next) {
    const result = {};
    for (const [name, joint] of Object.entries(joints)) {
      if (!finite(next[name])) throw new Error(`${joint.label}: geef een eindige hoek in radialen op.`);
      const raw = joint.offset + joint.direction * toDegrees(next[name]);
      const rounded = Math.round(raw);
      // Allow only arithmetic round-off at a limit, not real overshoot.
      if (raw < joint.min - 1e-10 || raw > joint.max + 1e-10 ||
          rounded < joint.min || rounded > joint.max) {
        throw new Error(`${joint.label} valt buiten de servogrenzen (${joint.min}–${joint.max}°).`);
      }
      result[joint.servoId] = rounded;
    }
    return result;
  }
  servoAnglesFor(angles);

  function notify() {
    for (const callback of listeners) {
      try { callback(getAngles()); } catch (error) { console.error('Armweergave bijwerken mislukt.', error); }
    }
  }

  /** Apply a partial set of named angles; reject the entire change on any error. */
  function setAngles(changes) {
    if (disposed) throw new Error('Deze robotarm is opgeruimd.');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('Geef benoemde gewrichtshoeken op.');
    }
    for (const name of Reflect.ownKeys(changes)) {
      if (!jointNames.includes(name)) throw new Error(`Onbekend gewricht: ${String(name)}.`);
    }
    const next = { ...angles, ...changes };
    servoAnglesFor(next);
    if (jointNames.every(name => next[name] === angles[name])) return getAngles();
    view?.setAngles(next);
    angles = next;
    notify();
    return getAngles();
  }

  /** Set one absolute local angle, for example turnJoint('hip', Math.PI / 4). */
  function turnJoint(joint, radians) { return setAngles({ [joint]: radians }); }

  /** Read a snapshot in radians; changing it cannot change the arm. */
  function getAngles() { return { ...angles }; }

  /** Read integer servo degrees, keyed by the six servo IDs. */
  function getServoAngles() { return servoAnglesFor(angles); }

  /** Subscribe to angle/preview changes; call the returned function to unsubscribe. */
  function onChange(callback) {
    if (disposed || typeof callback !== 'function') throw new Error('Geef een callback voor een actieve arm op.');
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /** Pause rendering while the Manual tab is hidden. */
  function setActive(active) { if (!disposed) view?.setActive(active && previewReady); }

  function losePreview(event) {
    event.preventDefault();
    previewReady = false;
    view?.setActive(false);
    notify();
  }

  /** Release browser listeners and all graphics resources, once. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    previewReady = false;
    canvas?.removeEventListener('webglcontextlost', losePreview);
    view?.dispose();
    notify();
    listeners.clear();
  }

  if (canvas) {
    try {
      view = createArmView(canvas, dimensions);
      view.setAngles(angles);
      previewReady = true;
    } catch {
      view?.dispose();
      view = null;
    }
    canvas.addEventListener('webglcontextlost', losePreview);
  }
  return Object.freeze({
    dimensions, joints, calibrated,
    get previewReady() { return previewReady; },
    turnJoint, setAngles, getAngles, getServoAngles, onChange, setActive, dispose,
  });
}
