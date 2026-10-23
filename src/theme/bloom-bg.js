// Living background: luminous pastel forms melting into each other, ray-marched in a fragment shader.
// They drift toward the pointer, and the main form's screen position is published as --blob-x/--blob-y
// so glass rims and surfaces can catch its colour exactly where it passes behind them.
import * as THREE from '../vendor/three.module.js';

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uMouse;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

vec3 P0, P1, P2, P3;   // blob centres, computed once per pixel instead of once per march step

float map(vec3 p) {
  float d = length(p - P0) - 1.05;
  d = smin(d, length(p - P1) - 0.8, 0.85);
  d = smin(d, length(p - P2) - 0.68, 0.8);
  d = smin(d, length(p - P3) - 0.62, 0.75);
  return d;
}

// Tetrahedral normal: four map() calls instead of six.
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.003;
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}

void main() {
  float t = uTime * 0.16;
  vec2 m = (uMouse - 0.5) * vec2(1.6, -1.0);
  P0 = vec3(sin(t * 1.1) * 1.05 + m.x * 0.45, cos(t * 0.9) * 0.55 + m.y * 0.35, sin(t * 0.7) * 0.4);
  P1 = vec3(cos(t * 0.8 + 1.0) * 1.45, sin(t * 1.3 + 2.0) * 0.8, cos(t) * 0.5);
  P2 = vec3(sin(t * 0.6 + 4.0) * 1.5 + 0.6, cos(t * 0.7 + 1.0) * 0.95 - 0.35, 0.3);
  P3 = vec3(cos(t * 1.2 + 3.0) * 0.9 - 0.85, sin(t * 0.5 + 5.0) * 1.05 + 0.25, -0.2);

  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 5.0);
  vec3 rd = normalize(vec3(uv * 1.15, -2.2));

  // The room: dusky rose, a peach window-light top-left and a lilac bounce bottom-right.
  vec3 col = mix(vec3(0.36, 0.2, 0.3), vec3(0.62, 0.4, 0.52), smoothstep(-0.8, 0.9, uv.y + uv.x * 0.25));
  col += vec3(1.0, 0.72, 0.62) * exp(-dot(uv - vec2(-0.6, 0.55), uv - vec2(-0.6, 0.55)) * 2.2) * 0.38;
  col += vec3(0.7, 0.6, 1.0) * exp(-dot(uv - vec2(0.75, -0.55), uv - vec2(0.75, -0.55)) * 2.4) * 0.22;

  // Skip marching entirely for rays that never come near the forms.
  float b = dot(ro, rd), c = dot(ro, ro) - 3.4 * 3.4, disc = b * b - c;
  float minD = 10.0;
  if (disc > 0.0) {
    float dist = max(0.0, -b - sqrt(disc)), tMin = dist;
    for (int i = 0; i < 48; i++) {
      float d = map(ro + rd * dist);
      if (d < minD) { minD = d; tMin = dist; }
      if (d < 0.002) break;
      dist += d;
      if (dist > 8.5) break;
    }
    // Edge anti-aliasing: rays that only graze a form still get partial coverage, shaded at their
    // closest approach, so silhouettes stay smooth even at a very low render resolution.
    float pixel = 2.4 / uRes.y * tMin;
    float cover = 1.0 - smoothstep(0.0, pixel, minD);
    col += vec3(1.0, 0.62, 0.78) * exp(-max(minD, 0.0) * 4.0) * 0.3 * (1.0 - cover);   // soft rose aura
    if (cover > 0.0) {
      vec3 p = ro + rd * tMin, n = normalAt(p), v = -rd;
      float ndv = clamp(dot(n, v), 0.0, 1.0);
      float fr = pow(1.0 - ndv, 3.0);
      // Luminous rose that turns lilac on one flank and peach underneath, with a light thin-film shimmer.
      vec3 base = vec3(1.0, 0.7, 0.82);
      base = mix(base, vec3(0.86, 0.74, 1.0), smoothstep(0.1, 0.9, n.x) * 0.55);
      base = mix(base, vec3(1.0, 0.82, 0.7), smoothstep(0.0, -0.8, n.y) * 0.55);
      base *= 0.92 + 0.12 * (0.5 + 0.5 * cos(6.2831 * ((1.0 - ndv) * 0.7 + uTime * 0.015 + vec3(0.0, 0.15, 0.3))));
      vec3 L1 = normalize(vec3(-0.6, 0.8, 0.65)), L2 = normalize(vec3(0.85, 0.15, 0.5));
      vec3 r = reflect(-v, n);
      float dif = clamp(dot(n, L1), 0.0, 1.0) * 0.45 + 0.62;
      float sp = pow(clamp(dot(r, L1), 0.0, 1.0), 52.0) * 1.2 + pow(clamp(dot(r, L2), 0.0, 1.0), 20.0) * 0.4;
      vec3 surf = base * dif + vec3(1.0, 0.97, 0.98) * sp + vec3(1.0, 0.88, 0.94) * fr * 0.5;
      col = mix(col, surf, cover);
    }
  }

  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
  col += (g - 0.5) * 0.018;                 // film grain keeps gradients from banding
  col *= 1.0 - 0.22 * dot(uv, uv);          // gentle vignette
  gl_FragColor = vec4(col, 1.0);
}`;

// Same motion as P0 in the shader, projected to CSS pixels, so the DOM can follow it.
function mainBlobScreen(time, mouse) {
  const t = time * 0.16;
  const mx = (mouse.x - 0.5) * 1.6, my = (mouse.y - 0.5) * -1.0;
  const x = Math.sin(t * 1.1) * 1.05 + mx * 0.45, y = Math.cos(t * 0.9) * 0.55 + my * 0.35, z = Math.sin(t * 0.7) * 0.4;
  const k = 2.2 / (1.15 * (5 - z));
  return { x: innerWidth / 2 + x * k * innerHeight, y: innerHeight / 2 - y * k * innerHeight };
}

// `scale` is render resolution relative to CSS pixels. The forms are soft, so a low resolution
// upscaled by the compositor looks the same and costs a fraction of the GPU time.
export function createBackground(canvas, { scale = 0.4, fps = 60 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2(0.5, 0.5) } };
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, fragmentShader: FRAG, vertexShader: 'void main(){gl_Position=vec4(position,1.0);}' })));

  const resize = () => {
    renderer.setPixelRatio(scale);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.getDrawingBufferSize(uniforms.uRes.value);
  };
  resize();
  addEventListener('resize', resize);

  const mouse = { x: 0.5, y: 0.5 }, target = { x: 0.5, y: 0.5 };
  addEventListener('pointermove', (e) => { target.x = e.clientX / innerWidth; target.y = e.clientY / innerHeight; }, { passive: true });

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  let last = 0, time = 8, frame = 0, n = 0;
  const listeners = new Set();

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (document.hidden || now - last < 1000 / fps - 2) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    time += dt;
    mouse.x += (target.x - mouse.x) * 0.05;
    mouse.y += (target.y - mouse.y) * 0.05;
    uniforms.uTime.value = time;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    renderer.render(scene, camera);
    // The rim highlights only need ~30 updates a second; halving style writes keeps layout work down.
    if (++n % 2 === 0) {
      const b = mainBlobScreen(time, mouse);
      root.style.setProperty('--blob-x', `${b.x.toFixed(0)}px`);
      root.style.setProperty('--blob-y', `${b.y.toFixed(0)}px`);
    }
    for (const fn of listeners) fn(n);  // runs right after render, while the frame is still readable
    if (still) cancelAnimationFrame(frame);
  }
  frame = requestAnimationFrame(tick);

  return {
    canvas,
    onFrame: (fn) => listeners.add(fn),
    stop: () => cancelAnimationFrame(frame),
  };
}
