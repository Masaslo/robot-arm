import {
  ACESFilmicToneMapping, Color, DirectionalLight, GridHelper, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry,
  Scene, Vector3, WebGLRenderer,
} from 'three';
import { ARM_CONFIG } from './joint_config.js';
import { createArmModel } from './arm_model.js';

/** Create a fixed camera preview. The caller handles WebGL failure and UI fallback. */
export function createRobotArmView(canvas, config = ARM_CONFIG) {
  const arm = createArmModel(config);
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
  const { baseHeight, upperArm, forearm, tool } = config.geometry;
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
  function setPose(pose) {
    if (disposed || !arm.setPose(pose)) return false;
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
  return { setPose, resize, setActive, dispose };
}
