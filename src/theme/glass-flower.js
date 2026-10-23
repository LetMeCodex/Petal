// A real 3D glass flower. Cupped petals on hinges, a glass dome at the centre.
// The glass refracts a backdrop texture (the desktop, or the pink background) with a little dispersion,
// reflects a pink studio, catches an orbiting softbox, and blushes from inside when touched.
import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uBackdrop;
uniform float uHasBackdrop;
uniform vec2 uRes;
uniform vec3 uLight;
uniform float uHot;
uniform float uDormant;
uniform float uOpacity;
uniform float uRefract;
uniform float uTint;
uniform float uEdgeMode;   // 0: petal (rim at the outline), 1: dome (rim at the equator)
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vV);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.4);

  // Refraction with dispersion: each channel bends a little differently.
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 off = N.xy * uRefract * (0.6 + fr);
  vec3 refr = vec3(0.42, 0.47, 0.52);
  if (uHasBackdrop > 0.5) {
    refr = vec3(texture2D(uBackdrop, uv + off * 0.9).r, texture2D(uBackdrop, uv + off).g, texture2D(uBackdrop, uv + off * 1.12).b);
  }

  // A pink studio reflected in the glass.
  vec3 R = reflect(-V, N);
  vec3 env = mix(vec3(0.3, 0.1, 0.2), vec3(1.0, 0.8, 0.9), smoothstep(-0.35, 0.9, R.y));
  env = mix(env, vec3(0.86, 0.76, 1.0), smoothstep(0.15, 1.0, R.x) * 0.4);
  env = mix(env, vec3(1.0, 0.82, 0.72), smoothstep(0.2, 1.0, -R.x) * 0.3);
  vec3 L = normalize(uLight);
  float spec = pow(max(dot(R, L), 0.0), 140.0) * 1.1                 // sharp softbox glint
             + pow(max(dot(R, L), 0.0), 18.0) * 0.18                   // its soft bloom
             + pow(max(dot(R, normalize(vec3(-L.x, -L.y * 0.5, L.z))), 0.0), 14.0) * 0.12;

  // Frosted pearl body with a little rose, lighter toward the tip and shadowed at the hinge for volume.
  float along = uEdgeMode > 0.5 ? 1.0 - vUv.y : vUv.y;
  // Rose glass: whatever is refracted takes on a blush, deeper at the hinge, pearly toward the tip.
  vec3 body = mix(vec3(0.74, 0.4, 0.56), vec3(1.0, 0.85, 0.91), along);
  vec3 col = mix(refr * vec3(1.0, 0.84, 0.9), body, 0.26 + uTint * 0.22);
  col *= 0.82 + 0.22 * smoothstep(0.0, 0.5, along);
  col = mix(col, env, fr * 0.5);
  vec3 blush = vec3(1.0, 0.72, 0.79);
  col = mix(col, col * 0.45 + blush * 0.62, uHot * 0.82);
  col += spec * vec3(1.0, 0.96, 0.98);

  // Thin pearl rim on the real outline, like the reference's beveled edge.
  float edge;
  if (uEdgeMode > 0.5) edge = smoothstep(0.93, 1.0, vUv.y);
  else edge = max(1.0 - smoothstep(0.0, 0.07, min(vUv.x, 1.0 - vUv.x)), smoothstep(0.96, 1.0, vUv.y));
  col = mix(col, vec3(0.97, 0.97, 1.0), edge * 0.65);
  col = mix(col, vec3(dot(col, vec3(0.333))) * 0.9, uDormant * 0.75);

  float a = uOpacity * mix(0.9, 1.0, max(fr, edge)) * (1.0 - uDormant * 0.45);
  gl_FragColor = vec4(col, a);
}`;

// Cupped, slightly drooping petal. Base at the origin, tip along +y, facing +z.
function petalGeometry(length, width, cup, droop) {
  const SU = 22, SV = 40;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= SV; j++) {
    const v = j / SV;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.98 + 0.02)), 0.72) * (0.62 + 0.38 * Math.sin(Math.PI * 0.5 * v + 0.25));
    for (let i = 0; i <= SU; i++) {
      const s = (i / SU - 0.5) * 2;
      pos.push(s * w, v * length, cup * s * s * (w / width) - droop * v * v);
      uv.push(i / SU, v);
    }
  }
  for (let j = 0; j < SV; j++) for (let i = 0; i < SU; i++) {
    const a = j * (SU + 1) + i, b = a + SU + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Critically-damped-ish spring with a touch of overshoot.
class Spring {
  constructor(x, stiff = 170, damp = 0.84) { this.x = x; this.t = x; this.v = 0; this.k = stiff; this.d = damp; }
  step(dt) { this.v += (this.t - this.x) * this.k * dt; this.v *= this.d; this.x += this.v * dt; return this.x; }
}

export function createFlower(canvas, {
  size = 440, count = 10, base = 64, reach = 196, petalWidth = 42, domeRadius = 56, refract = 0.05, tint = 0.25, maxFps = 60,
} = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const fov = 26;
  const dist = (size / 2) / Math.tan((fov * Math.PI) / 360);
  const camera = new THREE.PerspectiveCamera(fov, 1, dist * 0.3, dist * 3);
  camera.position.z = dist;
  const scene = new THREE.Scene();
  const flower = new THREE.Group();
  scene.add(flower);

  const res = new THREE.Vector2();
  renderer.getDrawingBufferSize(res);
  const backdrop = { texture: null };
  const light = new THREE.Vector3(0.4, 0.6, 0.8);

  const material = (extra = {}) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: {
      uBackdrop: { value: null }, uHasBackdrop: { value: 0 }, uRes: { value: res }, uLight: { value: light },
      uHot: { value: 0 }, uDormant: { value: 0 }, uOpacity: { value: 1 }, uRefract: { value: refract }, uTint: { value: tint }, uEdgeMode: { value: 0 },
      ...extra,
    },
  });

  const length = reach - base;
  const k = size / 440;   // everything below was tuned on the 440 px wheel; scale it for small buds
  const geo = petalGeometry(length, petalWidth, petalWidth * 0.14, length * 0.06);
  const step = (Math.PI * 2) / count;
  const petals = Array.from({ length: count }, (_, i) => {
    const arm = new THREE.Group();
    arm.rotation.z = -i * step;                    // clockwise from the top
    const hinge = new THREE.Group();
    hinge.position.y = base;
    const mesh = new THREE.Mesh(geo, material());
    mesh.renderOrder = 1;
    hinge.add(mesh);
    arm.add(hinge);
    flower.add(arm);
    return {
      arm, hinge, mesh, u: mesh.material.uniforms,
      fold: new Spring(1.35), scale: new Spring(0.5), lift: new Spring(0), spread: new Spring(0), opacity: new Spring(0, 120, 0.8),
      hot: 0, dormant: 0, startAt: 0, plucked: false,
    };
  });

  const domeGeo = new THREE.SphereGeometry(domeRadius, 56, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.rotateX(Math.PI / 2);
  domeGeo.scale(1, 1, 0.42);
  const dome = new THREE.Mesh(domeGeo, material({ uRefract: { value: refract * 1.4 }, uEdgeMode: { value: 1 } }));
  dome.position.z = 26 * k;
  dome.renderOrder = 2;
  flower.add(dome);
  const domeState = { scale: new Spring(0.4), hot: 0 };

  const spin = new Spring(0.55, 90, 0.86);
  const tilt = { x: new Spring(0, 60, 0.85), y: new Spring(0, 60, 0.85) };
  let bloom = 1;           // 0 = closed bud, 1 = fully open
  let spinRate = 0;        // radians/sec, for "working" states
  let hotKey = null, pointer = null, lastPointerAt = 0, lightAngle = 0.6, running = false, raf = 0, last = 0, clock = 0;
  const frameListeners = new Set();

  function setBackdrop(source) {
    if (!source) {
      backdrop.texture = null;
    } else if (!backdrop.texture || backdrop.texture.image !== source) {
      backdrop.texture?.dispose();
      // Left in "no colour space": the shader writes pixels straight out, so sampled values must stay as-is.
      backdrop.texture = new THREE.CanvasTexture(source);
    } else {
      backdrop.texture.needsUpdate = true;
    }
    for (const m of [...petals.map((p) => p.mesh), dome]) {
      m.material.uniforms.uBackdrop.value = backdrop.texture;
      m.material.uniforms.uHasBackdrop.value = backdrop.texture ? 1 : 0;
    }
  }

  function open() {
    const now = performance.now();
    spin.x = 0.55; spin.t = 0; spin.v = 0;
    domeState.scale.x = 0.4; domeState.scale.t = 1;
    petals.forEach((p, i) => {
      p.plucked = false; p.hot = 0; p.dormant = 0;
      p.fold.x = 1.35; p.fold.v = 0; p.scale.x = 0.5; p.opacity.x = 0; p.lift.x = 0; p.spread.x = 0;
      p.hinge.position.y = base;
      p.startAt = now + i * 34;
    });
    hotKey = null;
    start();
  }

  function setHot(key) { hotKey = key; }                         // petal index, 'dome', or null
  function setDormant(i, on) { petals[i].dormant = on ? 1 : 0; }
  function setPointer(x, y) { pointer = x == null ? null : { x, y }; lastPointerAt = performance.now(); }

  // The chosen petal lifts and sinks into the dome; the rest fold back into a bud.
  function pluck(i) {
    petals.forEach((p, j) => {
      if (j === i) { p.plucked = true; p.pluckAt = performance.now(); }
      else { p.startAt = Infinity; p.fold.t = 1.4; p.opacity.t = 0; p.scale.t = 0.45; }
    });
    domeState.scale.t = 0.55;
    hotKey = null;
  }
  function close() {
    petals.forEach((p) => { p.startAt = Infinity; p.fold.t = 1.4; p.opacity.t = 0; p.scale.t = 0.5; });
    domeState.scale.t = 0.3;
    spin.t = -0.4;
  }

  function update(dt) {
    const now = performance.now();
    clock += dt;

    // Light: follows the pointer, otherwise orbits slowly so reflections keep sliding over the glass.
    const idle = !pointer || now - lastPointerAt > 900;
    if (idle) lightAngle += dt * 0.55;
    else lightAngle = Math.atan2(-(pointer.y - size / 2), pointer.x - size / 2);
    light.set(Math.cos(lightAngle) * 0.75, Math.sin(lightAngle) * 0.75, 0.9);

    // Lean toward the pointer.
    tilt.x.t = pointer && !idle ? ((pointer.y - size / 2) / size) * 0.32 : Math.sin(clock * 0.5) * 0.04;
    tilt.y.t = pointer && !idle ? ((pointer.x - size / 2) / size) * 0.32 : Math.cos(clock * 0.4) * 0.04;
    flower.rotation.x = tilt.x.step(dt);
    flower.rotation.y = tilt.y.step(dt);
    spin.t += spinRate * dt;
    flower.rotation.z = spin.step(dt);

    const hotIndex = typeof hotKey === 'number' ? hotKey : -1;
    petals.forEach((p, i) => {
      const isHot = i === hotIndex && !p.dormant;
      if (now >= p.startAt) {
        const breathe = Math.sin(clock * 1.3 + i * 0.7) * 0.025;
        p.fold.t = (1 - bloom) * 1.15 + (p.dormant ? 0.55 : isHot ? 0.2 : 0) + breathe;
        p.scale.t = isHot ? 1.07 : p.dormant ? 0.92 : 1;
        p.opacity.t = 1;
        p.lift.t = isHot ? 24 * k : 0;
        const d = (i - hotIndex + 10) % 10;
        p.spread.t = hotIndex < 0 ? 0 : d === 1 ? -0.06 : d === 9 ? 0.06 : 0; // neighbours part away from the lifted petal
      }
      if (p.plucked) {
        const k = Math.min(1, (now - p.pluckAt) / 520);
        p.fold.t = 0.35 + k * 0.5; p.lift.t = 60 * (size / 440) * (1 - k); p.scale.t = 1.12 - k; p.opacity.t = 1 - k;
        p.hinge.position.y = base * (1 - k * 0.9);
      }
      p.hot += ((isHot || p.plucked ? 1 : 0) - p.hot) * Math.min(1, dt * 10);
      p.hinge.rotation.x = p.fold.step(dt);
      const s = Math.max(0.001, p.scale.step(dt));
      p.mesh.scale.set(s, s, s);
      p.hinge.position.z = p.lift.step(dt);
      p.arm.rotation.z = -i * step + p.spread.step(dt);
      p.u.uHot.value = p.hot;
      p.u.uDormant.value += (p.dormant - p.u.uDormant.value) * Math.min(1, dt * 8);
      p.u.uOpacity.value = Math.max(0, Math.min(1, p.opacity.step(dt)));
    });

    domeState.hot += ((hotKey === 'dome' ? 1 : 0) - domeState.hot) * Math.min(1, dt * 10);
    const ds = domeState.scale.step(dt) * (1 + Math.sin(clock * 1.6) * 0.012);
    dome.scale.set(ds, ds, ds);
    dome.material.uniforms.uHot.value = domeState.hot * 0.7;
  }

  // Screen-space anchors for DOM overlays (icons), in CSS px.
  const tmp = new THREE.Vector3();
  function anchors() {
    return petals.map((p) => {
      tmp.set(0, length * 0.46, 8 * k);
      p.mesh.localToWorld(tmp);
      tmp.project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * size, y: (-tmp.y * 0.5 + 0.5) * size, opacity: p.u.uOpacity.value, hot: p.hot, scale: p.mesh.scale.x, dormant: p.dormant };
    });
  }

  // Capped at maxFps: on a 144 Hz screen requestAnimationFrame fires 144 times a second, and every
  // rendered frame recomposites a transparent window. 60 looks the same for a flower and costs less than half.
  const minFrame = 1000 / maxFps - 1.5;
  function frame(now) {
    raf = running ? requestAnimationFrame(frame) : 0;
    if (now - last < minFrame) return;
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    for (const fn of frameListeners) fn();
  }
  function start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function setBloom(k) { bloom = Math.max(0, Math.min(1, k)); }
  function setSpin(rate) { spinRate = rate; }

  return { open, close, pluck, setHot, setBloom, setSpin, setDormant, setPointer, setBackdrop, anchors, start, stop, onFrame: (fn) => frameListeners.add(fn), domeState };
}
