import {
  ACESFilmicToneMapping, BoxGeometry, Color, CylinderGeometry, DirectionalLight,
  GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, Object3D,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';

// Drawing only: validation, servo mapping and current angles belong to robot_arm.js.
export function createArmModel(geometry) {
  const group = new Group();
  group.name = 'robot-arm';
  const geometries = new Set();
  const materials = new Set();
  const material = options => {
    const value = new MeshStandardMaterial(options);
    materials.add(value);
    return value;
  };
  const metal = material({ color: 0x343b40, metalness: 0.68, roughness: 0.34 });
  const graphite = material({ color: 0x151b20, metalness: 0.5, roughness: 0.42 });
  const turquoise = material({ color: 0x9ee3e9, metalness: 0.28, roughness: 0.3 });
  const steel = material({ color: 0x8a999f, metalness: 0.85, roughness: 0.25 });
  const rubber = material({ color: 0x111719, metalness: 0, roughness: 0.9 });

  function mesh(parent, shape, surface, position = [0, 0, 0]) {
    geometries.add(shape);
    const node = new Mesh(shape, surface);
    node.position.set(...position);
    node.castShadow = true;
    node.receiveShadow = true;
    parent.add(node);
    return node;
  }
  const box = (parent, size, surface, position) => mesh(parent, new BoxGeometry(...size), surface, position);
  function cylinder(parent, radius, length, surface, position, axis = 'y') {
    const node = mesh(parent, new CylinderGeometry(radius, radius, length, 40), surface, position);
    if (axis === 'z') node.rotation.x = Math.PI / 2;
    if (axis === 'x') node.rotation.z = Math.PI / 2;
    return node;
  }
  function joint(name, parent, x = 0, z = 0) {
    const node = new Group();
    node.name = name;
    node.position.set(x, 0, z);
    parent.add(node);
    return node;
  }
  function pitchHub(parent, radius) {
    cylinder(parent, radius, radius * 1.7, graphite);
    for (const side of [-1, 1]) {
      cylinder(parent, radius * 0.74, 0.025, turquoise, [0, side * radius * 0.88, 0]);
      cylinder(parent, radius * 0.28, 0.03, steel, [0, side * radius * 0.98, 0]);
    }
  }
  function link(parent, length, thickness) {
    box(parent, [length, thickness, thickness], metal, [length / 2, 0, 0]);
    // Two inset side rails give the long links depth under the studio lighting.
    for (const side of [-1, 1]) {
      box(parent, [length * 0.68, 0.018, thickness * 0.42], graphite,
        [length / 2, side * (thickness / 2 + 0.005), 0]);
      box(parent, [length * 0.46, 0.009, 0.018], turquoise,
        [length / 2, side * (thickness / 2 + 0.016), 0]);
    }
  }

  const baseHeight = Math.max(geometry.baseHeight * 0.64, 0.045);
  cylinder(group, 0.36, 0.075, graphite, [0, 0, 0.0375], 'z');
  cylinder(group, 0.29, baseHeight, metal, [0, 0, baseHeight / 2 + 0.055], 'z');
  cylinder(group, 0.295, 0.028, turquoise, [0, 0, baseHeight + 0.035], 'z');
  for (const x of [-0.23, 0.23]) {
    for (const y of [-0.23, 0.23]) cylinder(group, 0.024, 0.012, steel, [x, y, 0.081], 'z');
  }

  const hip = joint('hip', group, 0, geometry.baseHeight);
  box(hip, [0.28, 0.22, Math.max(geometry.baseHeight - baseHeight, 0.1)], graphite,
    [0, 0, -(geometry.baseHeight - baseHeight) / 2]);
  const shoulder = joint('shoulder', hip);
  pitchHub(shoulder, 0.155);
  link(shoulder, geometry.upperArm, 0.17);
  const elbow = joint('elbow', shoulder, geometry.upperArm);
  pitchHub(elbow, 0.135);
  link(elbow, geometry.forearm, 0.135);
  const wrist = joint('wrist', elbow, geometry.forearm);
  pitchHub(wrist, 0.105);

  // The target tip stays independent of palm roll and gripper opening.
  const endEffector = new Object3D();
  endEffector.name = 'end-effector';
  endEffector.position.x = geometry.tool;
  wrist.add(endEffector);
  const palm = joint('palm', wrist, geometry.tool * 0.23);
  cylinder(palm, 0.1, Math.max(geometry.tool * 0.36, 0.04), metal, [0, 0, 0], 'x');
  cylinder(palm, 0.104, 0.025, turquoise, [geometry.tool * 0.12, 0, 0], 'x');
  const fingers = joint('fingers', palm, geometry.tool * 0.14);
  box(fingers, [0.08, 0.28, 0.09], graphite);
  const fingerLength = Math.max(geometry.tool * 0.63, 0.12);
  const left = new Group();
  left.name = 'finger-left';
  const right = new Group();
  right.name = 'finger-right';
  for (const [finger, side] of [[left, 1], [right, -1]]) {
    fingers.add(finger);
    box(finger, [fingerLength, 0.045, 0.07], steel, [fingerLength / 2, 0, 0]);
    box(finger, [fingerLength * 0.38, 0.018, 0.075], rubber,
      [fingerLength * 0.78, -side * 0.027, 0]);
  }

  let disposed = false;
  function setAngles(angles) {
    if (disposed) return;
    hip.rotation.z = angles.hip;
    shoulder.rotation.y = -angles.shoulder;
    elbow.rotation.y = -angles.elbow;
    wrist.rotation.y = -angles.wrist;
    palm.rotation.x = angles.palm;
    // The demo jaws cover a half turn around the neutral servo position.
    const opening = Math.max(0, Math.min(1, 0.5 + angles.fingers / Math.PI));
    const gap = 0.052 + opening * 0.092;
    left.position.y = gap;
    right.position.y = -gap;
    group.updateMatrixWorld(true);
  }
  // A finite neutral gripper is useful even before the first valid pose arrives.
  left.position.y = 0.098;
  right.position.y = -0.098;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const shape of geometries) shape.dispose();
    for (const surface of materials) surface.dispose();
    group.removeFromParent();
  }
  return { group, setAngles, endEffector, dispose };
}

/** Camera, lights and rendering. No browser work happens until this is called. */
export function createArmView(canvas, dimensions) {
  const arm = createArmModel(dimensions);
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (error) {
    arm.dispose();
    throw error;
  }
  renderer.setClearColor(0x202123, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new Scene();
  scene.background = new Color(0x202123);
  scene.add(arm.group);
  const { baseHeight, upperArm, forearm, tool } = dimensions;
  const reach = upperArm + forearm + tool;
  const scale = Math.max(reach, baseHeight, 0.5);
  const camera = new PerspectiveCamera(40, 1, scale * 0.01, scale * 30);
  camera.up.set(0, 0, 1);
  const focus = new Vector3(reach * 0.22, 0, baseHeight + reach * 0.18);
  const cameraOffset = new Vector3(1.2, -1.6, 1.3).multiplyScalar(scale);

  const groundGeometry = new PlaneGeometry(scale * 8, scale * 8);
  const groundMaterial = new MeshStandardMaterial({ color: 0x202629, metalness: 0.12, roughness: 0.94 });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.position.z = -0.006;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new GridHelper(scale * 5, 24, 0x687c80, 0x516165);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.17;
  grid.material.depthWrite = false;
  scene.add(grid);

  const fill = new HemisphereLight(0xe7f7ff, 0x3b4348, 2.5);
  fill.position.set(0, 0, 1);
  scene.add(fill);
  const key = new DirectionalLight(0xffffff, 3.8);
  key.position.set(scale * 1.4, -scale * 1.5, scale * 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -scale * 1.5;
  key.shadow.camera.right = key.shadow.camera.top = scale * 1.5;
  key.shadow.camera.near = scale * 0.1;
  key.shadow.camera.far = scale * 8;
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.0001;
  scene.add(key);
  const rim = new DirectionalLight(0x9ee3e9, 2.2);
  rim.position.set(-scale, scale * 1.3, scale * 1.5);
  scene.add(rim);

  const viewport = canvas.parentElement ?? canvas;
  const browser = canvas.ownerDocument.defaultView;
  let frame = null;
  let active = true;
  let disposed = false;
  let width = 0;
  let height = 0;
  let dpr = 0;

  function syncSize() {
    const nextWidth = viewport.clientWidth;
    const nextHeight = viewport.clientHeight;
    if (nextWidth <= 0 || nextHeight <= 0) return false;
    const nextDpr = Math.min(browser.devicePixelRatio || 1, 2);
    if (nextWidth !== width || nextHeight !== height || nextDpr !== dpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Keep the same viewing angle while retaining space around the arm on narrow canvases.
      camera.position.copy(cameraOffset).multiplyScalar(Math.max(1, 0.8 / camera.aspect)).add(focus);
      camera.lookAt(focus);
      camera.updateProjectionMatrix();
    }
    return true;
  }
  function requestRender() {
    if (disposed || !active || frame !== null) return;
    frame = browser.requestAnimationFrame(() => {
      frame = null;
      if (!disposed && active && syncSize()) renderer.render(scene, camera);
    });
  }
  function resize() {
    if (!disposed && active && syncSize()) requestRender();
  }
  function setAngles(angles) {
    if (disposed) return;
    arm.setAngles(angles);
    requestRender();
    return true;
  }
  function setActive(value) {
    if (disposed) return;
    active = Boolean(value);
    if (!active && frame !== null) {
      browser.cancelAnimationFrame(frame);
      frame = null;
    }
    if (active) resize();
  }
  const observer = new browser.ResizeObserver(resize);
  observer.observe(viewport);
  browser.addEventListener('resize', resize);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame !== null) browser.cancelAnimationFrame(frame);
    frame = null;
    observer.disconnect();
    browser.removeEventListener('resize', resize);
    arm.dispose();
    groundGeometry.dispose();
    groundMaterial.dispose();
    grid.geometry.dispose();
    grid.material.dispose();
    key.shadow.dispose();
    renderer.dispose();
    scene.clear();
  }
  return { setAngles, setActive, dispose };
}
