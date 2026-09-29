/* ============================================================================
   UNDER THE SAME SKY
   Photographs by Neil Jacob Santiago
   Three.js r160 · GSAP 3 (DOM only) · vanilla ESM · no build step

   The photographs are the subject. Everything else — the star field, the
   focus, the grain — exists to hold them and then get out of the way.

   One idea runs through the whole scene: nothing is ever "blurred", it is
   OUT OF FOCUS. Stars, dust and the photographs themselves all share a single
   thin-lens circle of confusion:

       coc = |1/focus - 1/distance| · focus · aperture

   A defocused star becomes a wider, dimmer annulus with a central obstruction,
   which is exactly what you see through a reflector before you nail focus.
   A defocused photograph walks up its own mip chain. When the telescope racks
   onto a frame, everything else in the sky falls out of focus around it.

   EDIT THE WORDS: search for "CAPTIONS".
   ========================================================================== */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const gsap = window.gsap || null;

/* ---------------------------------------------------------------- 0 · env */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE  = matchMedia('(hover: none)').matches;

const $ = (id) => document.getElementById(id);
const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp   = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const damp   = (c, to, k, dt) => c + (to - c) * (1 - Math.exp(-k * dt));

const dom = {
  open: $('open'), openBar: $('openBar'), openBtn: $('openBtn'),
  fallback: $('fallback'), hud: $('hud'), cue: $('cue'),
  seen: $('seen'), sound: $('sound'), marks: $('marks'),
  railF: $('railF'), railT: $('railT'),
  stackBtn: $('stackBtn'), stackFill: $('stackFill'), stackLbl: $('stackLbl'), stackNote: $('stackNote'),
  cap: $('cap'), capX: $('capX'), capDate: $('capDate'), capTitle: $('capTitle'), capBody: $('capBody'),
  cursor: $('cursor')
};

function guessTier(gl) {
  let gpu = '';
  try {
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    if (e) gpu = String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
  } catch (_) {}
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const weak = /adreno \(tm\) (3\d\d|4\d\d|5\d\d|6[0-2]\d)|mali-(g5|g3|t\d)|powervr|apple a[789]/.test(gpu);
  const strong = /apple m[1-9]|apple a1[4-9]|adreno \(tm\) (7\d\d|6[5-9]\d)|mali-g7[0-9]|rtx|radeon rx/.test(gpu);
  if (weak || cores <= 4 || mem <= 3) return 'low';
  if (COARSE) return strong ? 'mid' : 'low';
  return strong ? 'high' : 'mid';
}

const TIERS = {
  low:  { dpr: 1.0,  stars: 8000,  dust: 26, bloomDiv: 6, wide: false, sizeK: 0.85 },
  mid:  { dpr: 1.4,  stars: 17000, dust: 44, bloomDiv: 4, wide: true,  sizeK: 0.92 },
  high: { dpr: 1.75, stars: 30000, dust: 64, bloomDiv: 4, wide: true,  sizeK: 1.0  }
};

/* ----------------------------------------------------------- 1 · renderer */

const canvas = $('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
} catch (err) {
  dom.fallback.hidden = false; dom.open.style.display = 'none';
  throw err;
}

let TIER = guessTier(renderer.getContext());
let Q = TIERS[TIER];
const IS_GL2 = renderer.capabilities.isWebGL2;

renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.autoClear = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const HDR = IS_GL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dom.fallback.hidden = false; });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 900);
camera.position.set(0, 0, 120);

/* ------------------------------------------------------------- 2 · noise */

function noiseChannel(size, freq) {
  const g = new Float32Array(freq * freq);
  for (let i = 0; i < g.length; i++) g[i] = Math.random();
  const out = new Float32Array(size * size);
  const f = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * freq, y0 = Math.floor(gy), ty = f(gy - y0);
    const a0 = (y0 % freq) * freq, a1 = ((y0 + 1) % freq) * freq;
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * freq, x0 = Math.floor(gx), tx = f(gx - x0);
      const b0 = x0 % freq, b1 = (x0 + 1) % freq;
      out[y * size + x] = lerp(lerp(g[a0 + b0], g[a0 + b1], tx), lerp(g[a1 + b0], g[a1 + b1], tx), ty);
    }
  }
  return out;
}

const NOISE = (() => {
  const s = 256;
  const ch = [noiseChannel(s, 4), noiseChannel(s, 8), noiseChannel(s, 16), noiseChannel(s, 32)];
  const d = new Uint8Array(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    d[i * 4] = ch[0][i] * 255; d[i * 4 + 1] = ch[1][i] * 255;
    d[i * 4 + 2] = ch[2][i] * 255; d[i * 4 + 3] = ch[3][i] * 255;
  }
  const t = new THREE.DataTexture(d, s, s, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
})();

/* --------------------------------------------------------- 3 · star field */

const starMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 }, uDpr: { value: renderer.getPixelRatio() },
    uSizeK: { value: Q.sizeK }, uSeeing: { value: 1 }, uExposure: { value: 0.55 },
    uDefocus: { value: 1 }, uFocus: { value: 60 }, uAperture: { value: 0.2 }
  },
  vertexShader: `
    attribute float aMag, aTemp, aTwk;
    uniform float uTime, uDpr, uSizeK, uSeeing, uDefocus, uFocus, uAperture;
    varying float vB, vSp, vT, vC;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float dist = max(1.0, -mv.z);

      // lens defocus: softens and mildly enlarges, capped so a rack focus can
      // never turn the entire field into annuli
      float lens = min(abs(1.0/uFocus - 1.0/dist) * uFocus * uAperture * 1.1, 0.40);
      // the full annulus belongs to the opening autofocus alone
      vC = clamp(uDefocus + lens * 0.30, 0.0, 1.0);

      float tw = 1.0 + sin(uTime*2.3 + aTwk*137.0) * 0.16 * (1.0-aMag) * uSeeing;
      float size = (2.0 + aMag*16.0) * uSizeK * uDpr * tw * (140.0/dist);
      size *= 1.0 + uDefocus*10.0 + lens*2.6;
      gl_PointSize = clamp(size, 1.0, 44.0*uDpr);

      float spread = 1.0 + (uDefocus*uDefocus*24.0) + lens*lens*6.0;   // energy conservation
      vB = aMag * clamp(260.0/dist, 0.05, 1.6) / spread;
      vSp = smoothstep(0.62, 1.0, aMag) * (1.0-vC);
      vT = aTemp;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uExposure;
    varying float vB, vSp, vT, vC;
    vec3 blackbody(float t){
      vec3 hot=vec3(0.64,0.75,1.00), mid=vec3(1.00,0.98,0.94), cool=vec3(1.00,0.66,0.40);
      return t<0.5 ? mix(hot,mid,t*2.0) : mix(mid,cool,(t-0.5)*2.0);
    }
    void main(){
      vec2 p = gl_PointCoord*2.0-1.0;
      float r = length(p);
      if(r>1.0) discard;
      float core = pow(max(0.0,1.0-r),7.0);
      float halo = pow(max(0.0,1.0-r),2.0)*0.07;
      float sx = exp(-abs(p.x)*26.0)*exp(-abs(p.y)*1.3);
      float sy = exp(-abs(p.y)*26.0)*exp(-abs(p.x)*1.3);
      float spike = (sx+sy)*vSp*0.5;
      float ring = smoothstep(1.0,0.90,r)*smoothstep(0.36,0.52,r);
      ring *= 0.85 + 0.15*sin(r*34.0);
      float img = mix(core+halo+spike, ring*0.55+halo*0.5, smoothstep(0.12,0.62,vC));
      float a = img*vB*uExposure;
      if(a<0.0022) discard;
      gl_FragColor = vec4(blackbody(vT), a);
    }
  `
});

(function buildStars() {
  const n = TIERS.high.stars;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), m = new Float32Array(n), t = new Float32Array(n), w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p[i*3]     = (Math.random() - 0.5) * 360;
    p[i*3 + 1] = (Math.random() - 0.5) * 320;
    p[i*3 + 2] = -200 + Math.random() * 440;
    m[i] = Math.pow(Math.random(), 3.4);   // many faint, very few bright
    t[i] = Math.pow(Math.random(), 0.7);   // population skews cool
    w[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aMag',  new THREE.BufferAttribute(m, 1));
  g.setAttribute('aTemp', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aTwk',  new THREE.BufferAttribute(w, 1));
  g.setDrawRange(0, Q.stars);
  const pts = new THREE.Points(g, starMat);
  pts.frustumCulled = false;
  pts.renderOrder = 0;
  scene.add(pts);
  window.__stars = pts;
})();

/* ----------------------------------------------- 4 · faint drifting dust
   Not a nebula any more — just enough structure to give the dark some depth
   and parallax. It never competes with a photograph.                       */

const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: {
    uNoise: { value: NOISE }, uTime: { value: 0 }, uOpacity: { value: 0.055 },
    uStack: { value: 0 }, uFocus: { value: 60 }, uAperture: { value: 0.2 }, uDefocus: { value: 1 }
  },
  vertexShader: `
    attribute vec3 aPos; attribute float aScale, aRot, aSeed;
    uniform float uFocus, uAperture, uDefocus;
    varying vec2 vUv; varying float vSeed, vDist, vC;
    void main(){
      float c = cos(aRot), s = sin(aRot);
      vec2 q = vec2(position.x*c - position.y*s, position.x*s + position.y*c) * aScale;
      vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec4 mv = viewMatrix * vec4(aPos + R*q.x + U*q.y, 1.0);
      vDist = -mv.z;
      float lens = min(abs(1.0/uFocus - 1.0/max(vDist,1.0))*uFocus*uAperture*1.1, 0.5);
      vC = clamp(lens + uDefocus*0.8, 0.0, 1.0);
      vUv = uv; vSeed = aSeed;
      gl_Position = projectionMatrix * mv;
      // cull clouds the camera is inside before they ever rasterise
      if(vDist < 6.0 || vDist > 300.0) gl_Position = vec4(2.0,2.0,2.0,1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D uNoise; uniform float uTime, uOpacity, uStack;
    varying vec2 vUv; varying float vSeed, vDist, vC;
    const vec4 W = vec4(0.50,0.26,0.15,0.09);
    void main(){
      float fall = smoothstep(1.0, 0.02, length(vUv-0.5)*2.0);
      if(fall <= 0.004) discard;
      vec2 o = vec2(vSeed*7.31, vSeed*3.17);
      float d = dot(texture2D(uNoise, vUv*1.2 + o + uTime*0.004, vC*3.6), W);
      d = pow(clamp(d,0.0,1.0), 1.8);
      vec3 col = mix(vec3(0.16,0.17,0.26), vec3(0.34,0.30,0.33), d);
      float a = d*fall*uOpacity*mix(0.7,1.3,uStack);
      a *= smoothstep(2.0,22.0,vDist) * (1.0 - smoothstep(160.0,280.0,vDist));
      if(a < 0.003) discard;
      gl_FragColor = vec4(col, a);
    }
  `
});

(function buildDust() {
  const n = TIERS.high.dust;
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.instanceCount = Q.dust;
  const p = new Float32Array(n*3), s = new Float32Array(n), r = new Float32Array(n), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = lerp(130, -150, Math.random());
    p[i*3] = (Math.random()-0.5)*190; p[i*3+1] = (Math.random()-0.5)*140; p[i*3+2] = z;
    s[i] = 40 + Math.random()*70; r[i] = Math.random()*6.283; sd[i] = Math.random();
  }
  g.setAttribute('aPos',   new THREE.InstancedBufferAttribute(p, 3));
  g.setAttribute('aScale', new THREE.InstancedBufferAttribute(s, 1));
  g.setAttribute('aRot',   new THREE.InstancedBufferAttribute(r, 1));
  g.setAttribute('aSeed',  new THREE.InstancedBufferAttribute(sd, 1));
  g.frustumCulled = false;
  const m = new THREE.Mesh(g, dustMat);
  m.frustumCulled = false; m.renderOrder = 1;
  scene.add(m);
  window.__dust = m;
})();

/* ===========================================================================
   5 · CAPTIONS — the photographs and what you want to say about them.
   Edit the title / date / body freely. Nothing else in the file needs to change.
   ======================================================================== */

const PHOTOS = [
  {
    src: 'images/moon-full.jpg', aspect: 4/3, z: 96, x: -22, y: 9,
    title: 'The easy one',
    date: '1 April 2026',
    body: 'The first thing anybody points a camera at, and the last thing you learn to shoot properly. It took me about two years to stop blowing out the highlights and actually get the craters.'
  },
  {
    src: 'images/star-trails.jpg', aspect: 3/2, z: 58, x: 26, y: -11,
    title: 'Proof the ground moves',
    date: 'Tracking off, intervals stacked',
    body: 'Every dash is one star. The gaps are the second between frames.\n\nNothing up there moved to make this. That is just the ground I was standing on, turning.'
  },
  {
    src: 'images/wide-field.jpg', aspect: 3/2, z: 20, x: -25, y: -7,
    title: 'What is actually up there',
    date: 'Wide lens, no telescope',
    body: 'No telescope for this one, just a fast lens and somewhere dark enough. The purple is not a filter — it is there every night, your eyes are simply too slow to collect it.\n\nThe tight knot of stars near the top right all formed together and are still travelling together.'
  },
  {
    src: 'images/andromeda.jpg', aspect: 3/2, z: -14, x: 22, y: 11,
    title: 'Two and a half million years',
    date: 'Andromeda, through gaps in the cloud',
    body: 'The small smudge in the middle is an entire other galaxy.\n\nThe light in this frame left it about two and a half million years ago, crossed everything in between, and landed on my sensor on an ordinary night over the neighbour\u2019s roof.'
  },
  {
    src: 'images/eclipse.jpg', aspect: 4/3, z: -46, x: -21, y: -9,
    title: 'Red for a couple of hours',
    date: 'Total lunar eclipse',
    body: 'It goes that colour because every sunrise and sunset happening on Earth at that moment is bending light around us and dropping it onto the moon.\n\nI set an alarm for two in the morning for this. I would do it again.'
  },
  {
    src: 'images/moon-venus.jpg', aspect: 3/2, z: -78, x: 6, y: 5,
    title: 'Not as close as they look',
    date: 'Moon and Venus, same frame',
    body: 'They look like they are sitting next to each other. The moon is about 384,000 km away. Venus, that night, was closer to 100 million.\n\nSame frame, nowhere near each other. 130 km is nothing. It clears the horizon around nine if you ever want to look.',
    needsStack: 0.75
  }
];

const PHOTO_W = 13.5;
const MOUNT = 0.62;     // width of the mount board around each print

/* --------------------------------------------------------- photo material */

function makePhotoMaterial(tex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.NormalBlending, side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: tex }, uDevelop: { value: 0 }, uStack: { value: 0 },
      uHasTex: { value: 0 }, uMissing: { value: 0 },
      uFocus: { value: 60 }, uAperture: { value: 0.2 }, uDefocus: { value: 1 },
      uTime: { value: 0 }, uMips: { value: IS_GL2 ? 1 : 0 },
      uMargin: { value: new THREE.Vector2(0.05, 0.05) }
    },
    vertexShader: `
      uniform float uFocus, uAperture, uDefocus;
      varying vec2 vUv; varying float vDist, vC;
      void main(){
        // billboard so the print always faces the viewer
        vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz + R*position.x + U*position.y;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vDist = -mv.z;
        float lens = min(abs(1.0/uFocus - 1.0/max(vDist,1.0))*uFocus*uAperture*1.1, 0.62);
        vC = clamp(lens + uDefocus, 0.0, 1.0);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uDevelop, uStack, uTime, uMips, uHasTex, uMissing;
      uniform vec2 uMargin;
      varying vec2 vUv; varying float vDist, vC;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

      // The JPEG holds sRGB-encoded values. Everything downstream is linear
      // light, so decode explicitly rather than trusting the driver.
      vec3 sRGBToLinear(vec3 c){
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      }

      void main(){
        vec2 od = min(vUv, 1.0 - vUv);
        float outer = min(od.x, od.y);
        float card = smoothstep(0.0, 0.004, outer);
        if (card <= 0.002) discard;

        // window cut in the mount
        vec2 iuv = (vUv - uMargin) / (1.0 - 2.0 * uMargin);
        vec2 id = min(iuv, 1.0 - iuv);
        float wEdge = min(id.x, id.y);              // positive inside the window

        // THE MOUNT. Deliberately lifted off pure black. An astrophotograph is
        // mostly night sky at value zero, and a black picture composited over a
        // black sky is invisible no matter how well it loaded. The print needs
        // a physical card behind it to exist as an object.
        vec3 col = vec3(0.026, 0.027, 0.032) * mix(0.75, 1.15, uDevelop);

        if (wEdge > 0.0) {
          vec3 c = sRGBToLinear(texture2D(uMap, clamp(iuv, 0.0, 1.0), vC*4.5*uMips).rgb) * uHasTex;
          c += vec3(0.010, 0.011, 0.016);           // lift the print's own black
          float lum = dot(c, vec3(0.299,0.587,0.114));
          vec3 held = mix(vec3(lum), c, 0.62) * 0.70;
          col = mix(held, c, uDevelop);
          col += (hash(vUv*vec2(1400.0,900.0) + floor(uTime*12.0)) - 0.5) * 0.035 * (1.0 - uDevelop);

          if (uMissing > 0.5) {
            float hatch = step(0.5, fract((iuv.x + iuv.y) * 18.0));
            col = mix(vec3(0.05,0.02,0.01), vec3(0.50,0.18,0.08), hatch);
          }
        }

        vec3 accent = vec3(0.85, 0.55, 0.31);
        float win = 1.0 - smoothstep(0.0, 0.006, abs(wEdge));   // window edge
        float rim = 1.0 - smoothstep(0.003, 0.007, outer);      // card edge
        col += accent * (win * 0.20 + rim * 0.45) * (0.40 + uDevelop * 0.70);
        if (uMissing > 0.5) col += accent * rim * 0.6;

        float a = card * mix(0.88, 1.0, uDevelop);
        a *= smoothstep(1.0, 8.0, vDist) * (1.0 - smoothstep(190.0, 280.0, vDist));
        if (a < 0.004) discard;

        gl_FragColor = vec4(col, a);
      }
    `
  });
}

/* ------------------------------------------------------------ 6 · corridor */

const Z_START = 120, Z_END = -100;
const FOV_NEAR = 50, FOV_FAR = 74;
const progressToZ = (p) => lerp(Z_START, Z_END, p);
const zToProgress = (z) => (z - Z_START) / (Z_END - Z_START);

const rig = {
  target: 0, p: 0, fov: FOV_NEAR, warp: 0,
  lookX: 0, lookY: 0, lockW: 0, lockTarget: 0, lock: null,
  focus: 60, aperture: 0.2,
  px: 0, py: 0, ptx: 0, pty: 0
};

const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
addEventListener('scroll', () => { rig.target = clamp(scrollY / maxScroll(), 0, 1); }, { passive: true });

/* Eased NATIVE scroll rather than a hijacked virtual scroller, so momentum,
   rubber-banding and the mobile URL bar all keep working. */
function scrollToProgress(p, dur = 1.5) {
  const to = clamp(p, 0, 1) * maxScroll();
  if (!gsap) { scrollTo(0, to); return; }
  gsap.to({ v: scrollY }, {
    v: to, duration: dur, ease: 'power3.inOut',
    onUpdate() { scrollTo(0, this.targets()[0].v); }
  });
}

/* ---------------------------------------------------------- 7 · post chain
   scene -> bright -> wide horizontal blur (anamorphic) -> vertical -> composite
   Everything except the scene and the composite runs at quarter resolution. */

const quad = new FullScreenQuad(null);
let rtScene, rtA, rtB;

function makeTargets() {
  [rtScene, rtA, rtB].forEach((r) => r && r.dispose());
  const dpr = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(innerWidth * dpr));
  const h = Math.max(2, Math.floor(innerHeight * dpr));
  const o = { type: HDR, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  rtScene = new THREE.WebGLRenderTarget(w, h, o);
  const bw = Math.max(2, Math.floor(w / Q.bloomDiv)), bh = Math.max(2, Math.floor(h / Q.bloomDiv));
  rtA = new THREE.WebGLRenderTarget(bw, bh, o);
  rtB = new THREE.WebGLRenderTarget(bw, bh, o);
}

const VQ = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`;

const matBright = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.72 }, uKnee: { value: 0.28 } },
  vertexShader: VQ,
  fragmentShader: `
    precision mediump float;
    uniform sampler2D tDiffuse; uniform float uThreshold, uKnee; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      float s = clamp((l - uThreshold + uKnee)/(2.0*uKnee), 0.0, 1.0);
      gl_FragColor = vec4(c * (max(l-uThreshold, s*s*uKnee)/max(l,1e-4)), 1.0);
    }
  `
});

const matBlur = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
  vertexShader: VQ,
  fragmentShader: `
    precision mediump float;
    uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
      c += texture2D(tDiffuse, vUv + uStep*1.3846153846).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv - uStep*1.3846153846).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv + uStep*3.2307692308).rgb * 0.0702702703;
      c += texture2D(tDiffuse, vUv - uStep*3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }
  `
});

const matComp = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tBloom: { value: null },
    uBloom: { value: 0.5 }, uStreak: { value: 0.32 },
    uGrain: { value: 0.045 }, uAberr: { value: 0.0014 },
    uVign: { value: 0.72 }, uFade: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }
  },
  vertexShader: VQ,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tScene, tBloom;
    uniform float uBloom, uStreak, uGrain, uAberr, uVign, uFade, uTime, uAspect;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

    /* Filmic shoulder that is EXACTLY identity below 0.8 and rolls off above.
       A full ACES curve maps white to 0.80 and would visibly darken every
       photograph; this leaves them as shot and only tames the highlights the
       bloom adds. */
    vec3 shoulder(vec3 x){
      vec3 t = max(x - 0.8, 0.0);
      return min(x, vec3(0.8)) + 0.2 * (1.0 - exp(-t / 0.2));
    }

    /* Three.js only injects its output colour-space conversion into its OWN
       materials. This is a raw ShaderMaterial, so the encode has to be here.
       Without it every linear value is written as though it were already sRGB
       and the photographs come out about two and a half stops too dark. */
    vec3 linearToSRGB(vec3 c){
      c = max(c, vec3(0.0));
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
    }

    void main(){
      vec2 cc = vUv - 0.5;
      float r2 = dot(cc, cc);

      vec2 off = cc * r2 * uAberr * 42.0;
      vec3 col = vec3(
        texture2D(tScene, vUv + off).r,
        texture2D(tScene, vUv).g,
        texture2D(tScene, vUv - off).b
      );

      vec3 bloom = texture2D(tBloom, vUv).rgb;
      col += bloom * uBloom;
      col += vec3(0.42,0.58,1.0) * dot(bloom, vec3(0.33)) * uStreak;

      col = linearToSRGB(shoulder(col));

      // grain is sensor noise, so it belongs in display space, after the encode
      float g = hash(vUv*vec2(1920.0,1080.0) + fract(uTime)*91.7);
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col += (g-0.5) * uGrain * (1.0 - lum*0.6);

      col *= mix(1.0, smoothstep(1.0, 0.16, length(cc*vec2(uAspect,1.0))), uVign);
      gl_FragColor = vec4(max(col,0.0) * uFade, 1.0);
    }
  `
});

function blit(m, t) {
  quad.material = m;
  renderer.setRenderTarget(t);
  renderer.clear(true, false, false);
  quad.render(renderer);
}

function renderPipeline() {
  renderer.setRenderTarget(rtScene);
  renderer.clear(true, false, false);
  renderer.render(scene, camera);

  matBright.uniforms.tDiffuse.value = rtScene.texture;
  blit(matBright, rtA);

  matBlur.uniforms.tDiffuse.value = rtA.texture;
  matBlur.uniforms.uStep.value.set(4.0 / rtA.width, 0);
  blit(matBlur, rtB);

  if (Q.wide) {
    matBlur.uniforms.tDiffuse.value = rtB.texture;
    matBlur.uniforms.uStep.value.set(10.0 / rtA.width, 0);
    blit(matBlur, rtA);
    matBlur.uniforms.tDiffuse.value = rtA.texture;
  } else {
    matBlur.uniforms.tDiffuse.value = rtB.texture;
  }
  matBlur.uniforms.uStep.value.set(0, 1.0 / rtA.height);
  blit(matBlur, Q.wide ? rtB : rtA);

  matComp.uniforms.tScene.value = rtScene.texture;
  matComp.uniforms.tBloom.value = (Q.wide ? rtB : rtA).texture;
  quad.material = matComp;
  renderer.setRenderTarget(null);
  renderer.clear(true, false, false);
  quad.render(renderer);
}

/* ------------------------------------------------------------- 8 · audio */

const Audio = {
  ctx: null, master: null, verb: null, sOsc: null, sGain: null, muted: false, ready: false,
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 3.4);
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    verb.connect(wet); wet.connect(this.master);
    this.verb = verb;

    const bed = ctx.createGain(); bed.gain.value = 0.17;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 2;
    lp.connect(bed); bed.connect(this.master);
    [36, 54].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.detune.value = (i - 0.5) * 8;
      const g = ctx.createGain(); g.gain.value = 0.55;
      o.connect(g); g.connect(lp); o.start();
    });

    const nb = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random()*2-1)*0.5;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=900; bp.Q.value=0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.016;
    noise.connect(bp); bp.connect(ng); ng.connect(this.master); noise.start();

    const so = ctx.createOscillator(); so.type='triangle'; so.frequency.value=164.8;
    const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sg); sg.connect(this.master); sg.connect(verb); so.start();
    this.sOsc = so; this.sGain = sg;

    this.ready = true;
  },
  start() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime + 3.2);
  },
  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.8, this.ctx.currentTime + 0.3);
  },
  tick(gain = 0.09) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const b = this.ctx.createBuffer(1, 1100, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*Math.pow(1 - i/d.length, 6);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1500; f.Q.value=1.1;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.verb);
    s.start(t);
  },
  chord(fs, dur = 2.4, gain = 0.055) {
    if (!this.ready || this.muted) return;
    fs.forEach((f, i) => {
      const t = this.ctx.currentTime + i*0.12;
      const o = this.ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
      o.connect(g); g.connect(this.master); g.connect(this.verb);
      o.start(t); o.stop(t+dur+0.1);
    });
  },
  setStack(v) {
    if (!this.ready) return;
    this.sGain.gain.setTargetAtTime(this.muted ? 0 : v*0.04, this.ctx.currentTime, 0.4);
    this.sOsc.frequency.setTargetAtTime(164.8 + v*82.4, this.ctx.currentTime, 0.6);
  }
};

dom.sound.addEventListener('click', () => {
  const on = dom.sound.getAttribute('aria-pressed') !== 'true';
  dom.sound.setAttribute('aria-pressed', String(on));
  Audio.setMuted(!on);
  Audio.tick(0.06);
});

/* -------------------------------------------------------- 9 · build frames */

const frames = [];
let seen = 0, stack = 0, holding = false, openFrame = null;

const loadMgr = new THREE.LoadingManager();
loadMgr.onProgress = (url, loaded, total) => {
  dom.openBar.style.width = (loaded / total) * 100 + '%';
};
loadMgr.onLoad = () => {
  dom.openBar.style.width = '100%';
  dom.openBtn.disabled = false;
  if (gsap) gsap.fromTo(dom.openBtn, { opacity: 0.3, y: 6 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
};
loadMgr.onError = () => {
  // a missing image must never trap her on the opening screen
  dom.openBtn.disabled = false;
};

const texLoader = new THREE.TextureLoader(loadMgr);

/* A 404 on a photograph used to look identical to empty sky. Now it says so,
   on screen, with the path it tried. */
const missingSrc = [];
function reportMissing(src) {
  missingSrc.push(src);
  let bar = document.getElementById('missing');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'missing';
    bar.className = 'missing';
    document.body.appendChild(bar);
  }
  bar.textContent = missingSrc.length + ' of ' + PHOTOS.length +
    ' photographs failed to load. Check that the images folder sits next to index.html. Missing: ' +
    missingSrc.join(', ');
  console.error('[under-the-same-sky] image failed to load:', src);
}

PHOTOS.forEach((ph, i) => {
  const mat = makePhotoMaterial(null);

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'mark';
  el.innerHTML = '<span class="mark__l"></span>' +
                 '<span class="mark__t">' + ph.title + '</span>' +
                 '<span class="mark__s">Tap to open</span>';
  dom.marks.appendChild(el);

  const tex = texLoader.load(
    ph.src,
    () => { mat.uniforms.uHasTex.value = 1; },
    undefined,
    () => {
      mat.uniforms.uMissing.value = 1;
      el.querySelector('.mark__s').textContent = 'Image not found';
      reportMissing(ph.src);
    }
  );
  // Decoded explicitly in the shader instead of by the hardware, so the
  // result is identical on WebGL1 and WebGL2 and cannot silently change.
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.generateMipmaps = IS_GL2;            // NPOT mipmaps need WebGL2
  tex.minFilter = IS_GL2 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const imgH   = PHOTO_W / ph.aspect;
  const planeW = PHOTO_W + MOUNT * 2;
  const planeH = imgH + MOUNT * 2;
  const h = planeH;
  mat.uniforms.uMap.value = tex;
  mat.uniforms.uMargin.value.set(MOUNT / planeW, MOUNT / planeH);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
  mesh.position.set(ph.x, ph.y, ph.z);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  const tick = document.createElement('i');
  tick.className = 't';
  tick.style.top = clamp(zToProgress(ph.z), 0, 1) * 100 + '%';
  dom.railT.appendChild(tick);

  const f = {
    data: ph, mesh, mat, el, tick, index: i, h,
    develop: 0, developTo: 0, opened: false, visible: false, dist: 999
  };

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if ((ph.needsStack || 0) > stack) {
      Audio.tick(0.05);
      dom.stackNote.textContent = 'That one is too faint yet. Hold the button.';
      if (gsap) gsap.fromTo(dom.stackNote, { opacity: 0.2 }, { opacity: 1, duration: 0.5 });
      return;
    }
    openPhoto(f);
  });

  frames.push(f);
});

/* ------------------------------------------------------- 10 · open / close */

function openPhoto(f) {
  openFrame = f;
  f.developTo = 1;
  rig.lock = f;
  rig.lockTarget = 1;
  Audio.tick();
  document.body.classList.add('reading');

  // pull the corridor to a distance where the print fills most of the frame
  const d = f.h * 1.45;
  scrollToProgress(zToProgress(f.data.z + d), 1.4);

  dom.cap.hidden = false;
  dom.capDate.textContent = f.data.date;
  dom.capTitle.textContent = f.data.title;
  dom.capBody.textContent = '';
  if (gsap) gsap.fromTo(dom.cap, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });

  setTimeout(() => reveal(dom.capBody, f.data.body), 320);

  if (!f.opened) {
    f.opened = true;
    f.el.classList.add('is-seen');
    f.el.querySelector('.mark__s').textContent = 'Seen';
    f.tick.classList.add('on');
    seen++;
    dom.seen.textContent = String(seen);
    Audio.chord([392, 523.25, 659.25], 2.2, 0.05);
    if (seen === frames.length) setTimeout(finish, 2400);
  }
}

function closePhoto() {
  if (!openFrame) return;
  openFrame.developTo = 0;
  openFrame = null;
  rig.lock = null;
  rig.lockTarget = 0;
  document.body.classList.remove('reading');
  Audio.tick(0.06);
  if (gsap) gsap.to(dom.cap, { opacity: 0, y: 8, duration: 0.3, ease: 'power2.in', onComplete: () => { dom.cap.hidden = true; } });
  else dom.cap.hidden = true;
}

dom.capX.addEventListener('click', closePhoto);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePhoto();
  if (e.key === 'm' || e.key === 'M') dom.sound.click();
});

function finish() {
  dom.stackNote.textContent = 'That is all of them. Thank you for looking.';
  Audio.chord([261.63, 329.63, 392.0, 523.25], 3.6, 0.05);
}

/* soft type-on reveal — readable, not a decryption effect */
let revealRAF = null;
function reveal(el, text) {
  if (revealRAF) cancelAnimationFrame(revealRAF);
  if (REDUCED) { el.textContent = text; return; }
  const t0 = performance.now();
  const ms = Math.min(1500, 400 + text.length * 4);
  const step = () => {
    const p = clamp((performance.now() - t0) / ms, 0, 1);
    const n = Math.floor(smooth(p) * text.length);
    el.textContent = text.slice(0, n);
    if (p < 1) revealRAF = requestAnimationFrame(step);
    else el.textContent = text;
  };
  step();
}

/* -------------------------------------------------------- 11 · projection */

const _v = new THREE.Vector3();

function updateMarks() {
  for (const f of frames) {
    const locked = (f.data.needsStack || 0) > stack;

    _v.set(f.mesh.position.x, f.mesh.position.y - f.h * 0.5 - 1.4, f.mesh.position.z).project(camera);
    f.dist = camera.position.distanceTo(f.mesh.position);

    const rawX = (_v.x * 0.5 + 0.5) * innerWidth;
    const x = clamp(rawX, 76, innerWidth - 76);
    const y = (-_v.y * 0.5 + 0.5) * innerHeight;
    const on = _v.z < 1 && rawX > -60 && rawX < innerWidth + 60 && y > -40 && y < innerHeight - 20;
    const vis = on && f.dist < 120 && openFrame !== f;

    if (vis !== f.visible) {
      f.visible = vis;
      f.el.classList.toggle('is-vis', vis);
    }
    if (!vis) continue;

    f.el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) translate(-50%,0)';
    f.el.classList.toggle('is-locked', locked);
    if (locked) f.el.querySelector('.mark__s').textContent = 'Too faint yet';
    else if (!f.opened) f.el.querySelector('.mark__s').textContent = 'Tap to open';
  }
}

/* Desktop navigation. The wheel alone is not enough — grabbing the sky and
   pulling it is the obvious gesture, and arrow keys make it reachable without
   a pointer at all. */
let drag = null;

addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;             // never fight native touch scroll
  if (e.target.closest && e.target.closest('button, .cap, .open')) return;
  drag = { y: e.clientY, top: scrollY, moved: false };
  document.body.style.cursor = 'grabbing';
});

addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = drag.y - e.clientY;
  if (Math.abs(dy) > 3) drag.moved = true;
  scrollTo(0, clamp(drag.top + dy * 2.2, 0, maxScroll()));
}, { passive: true });

['pointerup', 'pointercancel'].forEach((ev) => addEventListener(ev, () => {
  drag = null;
  document.body.style.cursor = '';
}));

addEventListener('keydown', (e) => {
  const step = innerHeight * (e.key === 'PageDown' || e.key === 'PageUp' ? 0.9 : 0.34);
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault(); scrollToProgress(clamp((scrollY + step) / maxScroll(), 0, 1), 0.6);
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault(); scrollToProgress(clamp((scrollY - step) / maxScroll(), 0, 1), 0.6);
  }
});

addEventListener('pointermove', (e) => {
  if (COARSE) return;
  dom.cursor.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  rig.ptx = (e.clientX / innerWidth) * 2 - 1;
  rig.pty = -((e.clientY / innerHeight) * 2 - 1);
  dom.cursor.classList.toggle('is-hot', !!(e.target.closest && e.target.closest('.mark, button')));
}, { passive: true });

function attachGyro() {
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    rig.ptx = clamp(e.gamma / 38, -1, 1);
    rig.pty = clamp((e.beta - 48) / 38, -1, 1);
  }, { passive: true });
}

/* ------------------------------------------------------------ 12 · stack */

dom.stackBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holding = true; Audio.tick(0.07); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
  dom.stackBtn.addEventListener(ev, () => { holding = false; }));
dom.stackBtn.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------------------------------------- 13 · open */

let started = false, fadeTo = 0;

async function begin() {
  if (started) return;
  started = true;

  Audio.init(); Audio.start(); Audio.tick(0.12);

  try {
    const DOE = window.DeviceOrientationEvent;
    if (COARSE && DOE && typeof DOE.requestPermission === 'function') {
      if (await DOE.requestPermission() === 'granted') attachGyro();
    } else if (COARSE && DOE) attachGyro();
  } catch (_) {}

  document.documentElement.classList.remove('is-booting');
  fadeTo = 1;

  const defocusTargets = [starMat.uniforms.uDefocus, dustMat.uniforms.uDefocus]
    .concat(frames.map((f) => f.mat.uniforms.uDefocus));

  if (gsap) {
    gsap.to(dom.open, { opacity: 0, duration: 0.9, ease: 'power2.inOut', onComplete: () => { dom.open.style.display = 'none'; } });
    gsap.to(dom.hud, { opacity: 1, duration: 1.5, delay: 0.6, ease: 'power2.out' });
    // focusing: everything collapses from defocused annuli to points
    gsap.to(defocusTargets, { value: 0, duration: 3.8, delay: 0.7, ease: 'power3.inOut' });
  } else {
    dom.open.style.display = 'none';
    dom.hud.style.opacity = 1;
    defocusTargets.forEach((u) => { u.value = 0; });
  }
}

dom.openBtn.addEventListener('click', begin);

/* --------------------------------------------------------- 14 · governor */

let gF = 0, gT = 0, gDone = false;
function governor(dt) {
  if (gDone || !started) return;
  gF++; gT += dt;
  if (gT < 3) return;
  const fps = gF / gT;
  gDone = true;
  if (fps >= 42 || TIER === 'low') return;
  TIER = TIER === 'high' ? 'mid' : 'low';
  Q = TIERS[TIER];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  renderer.setSize(innerWidth, innerHeight);
  starMat.uniforms.uDpr.value = renderer.getPixelRatio();
  starMat.uniforms.uSizeK.value = Q.sizeK;
  window.__stars.geometry.setDrawRange(0, Q.stars);
  window.__dust.geometry.instanceCount = Q.dust;
  matComp.uniforms.uGrain.value = 0.05;
  makeTargets();
}

/* ------------------------------------------------------------- 15 · loop */

const clock = new THREE.Clock();
let T = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  T += dt;

  const vel = Math.abs(rig.target - rig.p);
  rig.p = damp(rig.p, rig.target, 3.2, dt);
  const p = rig.p;
  rig.warp = damp(rig.warp, clamp(vel * 24, 0, 1), 4, dt);

  const z = progressToZ(p);
  rig.fov = damp(rig.fov, lerp(FOV_NEAR, FOV_FAR, smooth(p)) + rig.warp * 5, 3, dt);
  camera.fov = rig.fov;
  camera.updateProjectionMatrix();

  rig.lockW = damp(rig.lockW, rig.lockTarget, rig.lockTarget > 0 ? 2.4 : 3, dt);

  let lx = Math.sin(T * 0.06) * 2.6;
  let ly = Math.cos(T * 0.05) * 1.8;
  if (rig.lock) {
    lx = lerp(lx, rig.lock.mesh.position.x, rig.lockW);
    ly = lerp(ly, rig.lock.mesh.position.y, rig.lockW);
    if (rig.lock.dist > 150) closePhoto();
  }
  rig.lookX = damp(rig.lookX, lx, 2.6, dt);
  rig.lookY = damp(rig.lookY, ly, 2.6, dt);
  rig.px = damp(rig.px, rig.ptx, 2.2, dt);
  rig.py = damp(rig.py, rig.pty, 2.2, dt);

  camera.position.set(
    Math.sin(T * 0.04) * 3.4 + rig.px * 2.2 + (rig.lock ? rig.lock.mesh.position.x * rig.lockW * 0.9 : 0),
    Math.cos(T * 0.034) * 2.4 + rig.py * 1.6 + (rig.lock ? rig.lock.mesh.position.y * rig.lockW * 0.9 : 0),
    z
  );
  camera.lookAt(rig.lookX, rig.lookY, z - 40);

  // focus rides ahead of the camera, then racks onto whatever is open
  rig.focus = damp(rig.focus, rig.lock ? clamp(rig.lock.dist, 6, 240) : 44, 2, dt);
  rig.aperture = damp(rig.aperture, rig.lock ? 0.30 : 0.14, 2.2, dt);

  // stacking
  if (holding && stack < 1) {
    stack = Math.min(1, stack + dt * 0.16);
    dom.stackFill.style.width = stack * 100 + '%';
    if (stack >= 1) {
      dom.stackBtn.classList.add('is-full');
      dom.stackLbl.textContent = 'Stacked';
      dom.stackNote.textContent = 'The faint frame is visible now.';
      Audio.chord([261.63, 392.0, 523.25], 3, 0.05);
    } else {
      dom.stackLbl.textContent = 'Stacking ' + Math.floor(stack * 100) + '%';
    }
  } else if (!holding && stack > 0 && stack < 1) {
    dom.stackLbl.textContent = 'Hold to stack ' + Math.floor(stack * 100) + '%';
  }
  Audio.setStack(stack);

  // uniforms
  starMat.uniforms.uTime.value = T;
  starMat.uniforms.uFocus.value = rig.focus;
  starMat.uniforms.uAperture.value = rig.aperture;
  starMat.uniforms.uSeeing.value = 1 - stack * 0.55;
  starMat.uniforms.uExposure.value = 0.55 + stack * 0.18;

  dustMat.uniforms.uTime.value = T;
  dustMat.uniforms.uFocus.value = rig.focus;
  dustMat.uniforms.uAperture.value = rig.aperture;
  dustMat.uniforms.uStack.value = stack;

  for (const f of frames) {
    f.develop = damp(f.develop, f.developTo, 2.6, dt);
    const u = f.mat.uniforms;
    u.uDevelop.value = f.develop;
    u.uStack.value = stack;
    u.uTime.value = T;
    u.uFocus.value = rig.focus;
    u.uAperture.value = rig.aperture;
  }

  matComp.uniforms.uTime.value = T;
  matComp.uniforms.uGrain.value = damp(matComp.uniforms.uGrain.value, 0.045 - stack * 0.03, 2, dt);
  matComp.uniforms.uBloom.value = 0.48 + rig.warp * 0.22;
  matComp.uniforms.uStreak.value = 0.28 + rig.warp * 0.3;
  matComp.uniforms.uAberr.value = 0.0012 + p * 0.0016 + rig.warp * 0.0018;
  matComp.uniforms.uFade.value = damp(matComp.uniforms.uFade.value, fadeTo, 1.2, dt);

  dom.railF.style.height = p * 100 + '%';
  if (dom.cue) dom.cue.style.opacity = p > 0.015 ? '0' : '';
  updateMarks();

  renderPipeline();
  governor(dt);
}

renderer.setAnimationLoop(frame);

/* ----------------------------------------------------------- 16 · resize */

function sync() {
  matComp.uniforms.uAspect.value = innerWidth / innerHeight;
  starMat.uniforms.uDpr.value = renderer.getPixelRatio();
}

let rTimer, lastW = innerWidth;
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  renderer.setSize(innerWidth, innerHeight);
  makeTargets();
  sync();
  rig.target = clamp(scrollY / maxScroll(), 0, 1);
}

addEventListener('resize', () => {
  // on phones a height-only change is the URL bar, not a layout change
  if (COARSE && innerWidth === lastW) return;
  lastW = innerWidth;
  clearTimeout(rTimer);
  rTimer = setTimeout(resize, 140);
});
addEventListener('orientationchange', () => setTimeout(resize, 260));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') clock.getDelta();
});

makeTargets();
sync();
