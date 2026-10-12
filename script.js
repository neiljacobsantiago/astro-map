/* ============================================================================
   THE LONG HALL
   Three.js r160 · GSAP (DOM only) · vanilla ESM · no build step

   A corridor of hung frames. Scroll moves you FORWARD and BACK along Z — the
   frames pass you on either side. Same engine as the astro piece:

     · custom GLSL star field with thin-lens defocus (the autofocus open)
     · quarter-res anamorphic bloom, hand-rolled on FullScreenQuad
     · explicit sRGB decode on every photograph and one encode at the end,
       because three only injects that conversion into its OWN materials
     · each photograph hangs as a MOUNTED print — a lifted board around the
       image — so a dark phone photo still reads as an object in the dark

   THE PART THAT MAKES 50 PHOTOS POSSIBLE:
   fifty 900px textures is ~200 MB of VRAM and will kill a phone. Frames
   stream: a texture is uploaded when the camera comes within LOAD units and
   disposed past UNLOAD, at most CONCURRENT at a time. Eight or so are ever
   resident, so the hall can be any length.
   ========================================================================= */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const gsap = window.gsap || null;

/* ───────────────────────────────────────────── config */
const SPACING = 13;      // metres between frames along the corridor
const SIDE_X  = 8.6;     // how far off-centre each wall hangs
const IMG_H   = 7.4;     // every print hangs to the same height, gallery-style
const MOUNT   = 0.42;
const YAW     = 0.46;    // radians each wall turns toward the centre line

const LOAD = 78, UNLOAD = 118, CONCURRENT = 3;

/* The opening: this is written in starlight before the hall appears. */
const NAME     = 'Jhouana';
const NAME_SUB = 'An archive in fifty frames';

/* ───────────────────────────────────────────── env */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE  = matchMedia('(hover: none)').matches;
const $ = (id) => document.getElementById(id);
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const lerp  = (a,b,t)=>a+(b-a)*t;
const smooth= (t)=>t*t*(3-2*t);
const damp  = (c,to,k,dt)=>c+(to-c)*(1-Math.exp(-k*dt));
const pad3  = (n)=>String(n).padStart(3,'0');

const PHOTOS = (window.PHOTOS && window.PHOTOS.length)
  ? window.PHOTOS
  : Array.from({length:50},(_,i)=>({f:`jho${i+1}.jpg`}));
const N = PHOTOS.length;

const dom = {
  gate:$('gate'), gateBar:$('gateBar'), gateN:$('gateN'), enter:$('enter'),
  fallback:$('fallback'), hud:$('hud'), cue:$('cue'),
  hudNum:$('hudNum'), hudTot:$('hudTot'), marks:$('marks'), railFill:$('railFill'),
  track:$('track'), cursor:$('cursor'),
  plaque:$('plaque'), plaqueId:$('plaqueId'), plaqueX:$('plaqueX'),
  plaqueFav:$('plaqueFav'), plaquePrev:$('plaquePrev'), plaqueNext:$('plaqueNext'),
  chart:$('chart'), chartSvg:$('chartSvg'), chartBtn:$('chartBtn'), chartX:$('chartX'),
  driftBtn:$('driftBtn'), favBtn:$('favBtn'), favN:$('favN'), sndBtn:$('sndBtn'),
  plaqueFull:$('plaqueFull'),
  view:$('view'), viewImg:$('viewImg'), viewSpin:$('viewSpin'), viewX:$('viewX'),
  viewPrev:$('viewPrev'), viewNext:$('viewNext'), viewId:$('viewId'),
  viewFav:$('viewFav')
};
dom.hudTot.textContent = N;
dom.gateN.textContent = N;
dom.track.style.height = (N * 88 + 160) + 'vh';

/* favourites survive a reload; private mode can throw, so it is wrapped */
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem('hall.favs')||'[]')); } catch(_){}
const saveFavs = ()=>{ try{ localStorage.setItem('hall.favs', JSON.stringify([...favs])); }catch(_){} };
dom.favN.textContent = favs.size;

/* ───────────────────────────────────────────── renderer */
const canvas = $('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance',stencil:false,depth:false});
} catch(err){ dom.fallback.hidden=false; dom.gate.style.display='none'; throw err; }

function guessTier(gl){
  let gpu='';
  try{ const e=gl.getExtension('WEBGL_debug_renderer_info');
       if(e) gpu=String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)||'').toLowerCase(); }catch(_){}
  const cores=navigator.hardwareConcurrency||4, mem=navigator.deviceMemory||4;
  const weak=/adreno \(tm\) (3\d\d|4\d\d|5\d\d|6[0-2]\d)|mali-(g5|g3|t\d)|powervr|apple a[789]/.test(gpu);
  const strong=/apple m[1-9]|apple a1[4-9]|adreno \(tm\) (7\d\d|6[5-9]\d)|mali-g7[0-9]|rtx|radeon rx/.test(gpu);
  if(weak||cores<=4||mem<=3) return 'low';
  if(COARSE) return strong?'mid':'low';
  return strong?'high':'mid';
}
const TIERS={
  low :{dpr:1.0 ,stars:7000 ,bloomDiv:6,wide:false,sizeK:.85,load:58,unload:92},
  mid :{dpr:1.35,stars:15000,bloomDiv:4,wide:true ,sizeK:.92,load:72,unload:110},
  high:{dpr:1.7 ,stars:26000,bloomDiv:4,wide:true ,sizeK:1   ,load:78,unload:118}
};
let TIER=guessTier(renderer.getContext()), Q=TIERS[TIER];

renderer.setPixelRatio(Math.min(devicePixelRatio,Q.dpr));
renderer.setSize(innerWidth,innerHeight);
renderer.setClearColor(0x04050a,1);
renderer.autoClear=false;
renderer.toneMapping=THREE.NoToneMapping;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const IS_GL2 = renderer.capabilities.isWebGL2;
const HDR = IS_GL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
canvas.addEventListener('webglcontextlost',(e)=>{e.preventDefault();dom.fallback.hidden=false;});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56,innerWidth/innerHeight,0.4,1400);

/* ───────────────────────────────────────────── star field */
const starMat = new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uDpr:{value:renderer.getPixelRatio()},uSizeK:{value:Q.sizeK},
            uExposure:{value:.55},uDefocus:{value:0},uFocus:{value:40},uAperture:{value:.16}},
  vertexShader:`
    attribute float aMag,aTemp,aTwk;
    uniform float uTime,uDpr,uSizeK,uDefocus,uFocus,uAperture;
    varying float vB,vSp,vT,vC;
    void main(){
      vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_Position=projectionMatrix*mv;
      float dist=max(1.0,-mv.z);
      float lens=min(abs(1.0/uFocus-1.0/dist)*uFocus*uAperture*1.1,0.40);
      vC=clamp(uDefocus+lens*0.30,0.0,1.0);
      float tw=1.0+sin(uTime*2.3+aTwk*137.0)*0.16*(1.0-aMag);
      float size=(2.0+aMag*15.0)*uSizeK*uDpr*tw*(140.0/dist);
      size*=1.0+uDefocus*10.0+lens*2.6;
      gl_PointSize=clamp(size,1.0,42.0*uDpr);
      vB=aMag*clamp(240.0/dist,0.05,1.5)/(1.0+uDefocus*uDefocus*24.0+lens*lens*6.0);
      vSp=smoothstep(0.64,1.0,aMag)*(1.0-vC);
      vT=aTemp;
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uExposure;
    varying float vB,vSp,vT,vC;
    vec3 bb(float t){
      vec3 h=vec3(.64,.75,1.),m=vec3(1.,.98,.94),c=vec3(1.,.66,.40);
      return t<.5?mix(h,m,t*2.):mix(m,c,(t-.5)*2.);
    }
    void main(){
      vec2 p=gl_PointCoord*2.0-1.0; float r=length(p);
      if(r>1.0) discard;
      float core=pow(max(0.0,1.0-r),7.0), halo=pow(max(0.0,1.0-r),2.0)*0.07;
      float sx=exp(-abs(p.x)*26.0)*exp(-abs(p.y)*1.3);
      float sy=exp(-abs(p.y)*26.0)*exp(-abs(p.x)*1.3);
      float ring=smoothstep(1.0,0.90,r)*smoothstep(0.36,0.52,r)*(0.85+0.15*sin(r*34.0));
      float img=mix(core+halo+(sx+sy)*vSp*0.5, ring*0.55+halo*0.5, smoothstep(0.12,0.62,vC));
      float a=img*vB*uExposure;
      if(a<0.0022) discard;
      gl_FragColor=vec4(bb(vT),a);
    }`
});

const CORRIDOR_END = -(N-1)*SPACING;
(function buildStars(){
  const n=TIERS.high.stars, g=new THREE.BufferGeometry();
  const p=new Float32Array(n*3),m=new Float32Array(n),t=new Float32Array(n),w=new Float32Array(n);
  for(let i=0;i<n;i++){
    p[i*3]  =(Math.random()-.5)*420;
    p[i*3+1]=(Math.random()-.5)*340;
    p[i*3+2]=60 - Math.random()*(Math.abs(CORRIDOR_END)+420);
    m[i]=Math.pow(Math.random(),3.4);
    t[i]=Math.pow(Math.random(),0.7);
    w[i]=Math.random();
  }
  g.setAttribute('position',new THREE.BufferAttribute(p,3));
  g.setAttribute('aMag',new THREE.BufferAttribute(m,1));
  g.setAttribute('aTemp',new THREE.BufferAttribute(t,1));
  g.setAttribute('aTwk',new THREE.BufferAttribute(w,1));
  g.setDrawRange(0,Q.stars);
  const pts=new THREE.Points(g,starMat);
  pts.frustumCulled=false; pts.renderOrder=0;
  scene.add(pts);
  window.__stars=pts;
})();

/* ───────────────────────────────────────────── the frames */
const frameMatProto = {
  vertexShader:`
    uniform float uFocus,uAperture,uDefocus;
    varying vec2 vUv; varying float vDist,vC;
    void main(){
      vec4 wp=modelMatrix*vec4(position,1.0);
      vec4 mv=viewMatrix*wp;
      vDist=-mv.z;
      float lens=min(abs(1.0/uFocus-1.0/max(vDist,1.0))*uFocus*uAperture*1.1,0.62);
      vC=clamp(lens+uDefocus,0.0,1.0);
      vUv=uv;
      gl_Position=projectionMatrix*mv;
    }`,
  fragmentShader:`
    precision highp float;
    uniform sampler2D uMap;
    uniform float uHasTex,uGlow,uTime,uMips,uIndex;
    uniform vec2 uMargin;
    varying vec2 vUv; varying float vDist,vC;

    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

    // The JPEG is sRGB-encoded; everything downstream is linear light.
    vec3 toLinear(vec3 c){
      return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045,c));
    }

    void main(){
      vec2 od=min(vUv,1.0-vUv);
      float outer=min(od.x,od.y);
      float card=smoothstep(0.0,0.004,outer);
      if(card<=0.002) discard;

      vec2 iuv=(vUv-uMargin)/(1.0-2.0*uMargin);
      vec2 id=min(iuv,1.0-iuv);
      float wEdge=min(id.x,id.y);

      // THE MOUNT, lifted off pure black on purpose: a dark photograph
      // composited over a dark hall is invisible however well it loaded.
      vec3 col=vec3(0.030,0.031,0.037)*(0.8+uGlow*0.5);

      if(wEdge>0.0){
        if(uHasTex>0.5){
          vec3 c=toLinear(texture2D(uMap,clamp(iuv,0.0,1.0),vC*4.0*uMips).rgb);
          c+=vec3(0.008,0.009,0.013);              // lift the print's own black
          col=c*(0.72+uGlow*0.42);
        }else{
          // still streaming in — a quiet panel, never a black hole
          float s=0.012+0.010*sin(uTime*1.6+uIndex);
          col=vec3(s,s*1.04,s*1.3);
        }
        col+=(hash(vUv*vec2(1200.0,800.0)+floor(uTime*10.0))-0.5)*0.012;
      }

      vec3 accent=vec3(0.49,0.94,0.85);
      float win=1.0-smoothstep(0.0,0.006,abs(wEdge));
      float rim=1.0-smoothstep(0.003,0.007,outer);
      col+=accent*(win*0.16+rim*0.40)*(0.35+uGlow*0.9);

      float a=card*0.97;
      a*=smoothstep(0.6,5.0,vDist)*(1.0-smoothstep(150.0,210.0,vDist));
      if(a<0.004) discard;
      gl_FragColor=vec4(col,a);
    }`
};

function makeFrameMat(i){
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,
    blending:THREE.NormalBlending,
    vertexShader:frameMatProto.vertexShader,
    fragmentShader:frameMatProto.fragmentShader,
    uniforms:{
      uMap:{value:null},uHasTex:{value:0},uGlow:{value:0},uTime:{value:0},
      uMips:{value:IS_GL2?1:0},uIndex:{value:i},
      uMargin:{value:new THREE.Vector2(.05,.05)},
      uFocus:{value:40},uAperture:{value:.16},uDefocus:{value:0}
    }
  });
}

const frames = [];
const loader = new THREE.TextureLoader();

PHOTOS.forEach((p,i)=>{
  const ar = (p.w&&p.h) ? p.w/p.h : 0.75;        // phone photos default to portrait
  const imgW = IMG_H*ar;
  const planeW = imgW+MOUNT*2, planeH = IMG_H+MOUNT*2;

  const side = i%2 ? 1 : -1;
  const mat = makeFrameMat(i);
  mat.uniforms.uMargin.value.set(MOUNT/planeW, MOUNT/planeH);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW,planeH), mat);
  mesh.position.set(side*SIDE_X, Math.sin(i*1.7)*0.55, -i*SPACING);
  mesh.rotation.y = -side*YAW;                    // turn the wall toward the aisle
  mesh.frustumCulled=false;
  mesh.renderOrder=2;
  scene.add(mesh);

  const el=document.createElement('button');
  el.type='button'; el.className='mk';
  el.innerHTML=`<span class="mk__l"></span><span class="mk__n">${pad3(i+1)}</span><span class="mk__s"></span>`;
  el.addEventListener('click',(e)=>{e.stopPropagation();focusFrame(i);});
  dom.marks.appendChild(el);

  frames.push({i,mesh,mat,el,src:`images/${p.f}`,tex:null,state:'idle',
               planeH,dist:9999,vis:false});
});

/* ── texture streaming ─────────────────────────────────────────────────
   Only frames near the camera hold a texture. Everything else is a mount
   board. This is what lets the hall be fifty frames long on a phone.    */
let inflight = 0;

function stream(camZ){
  // nearest first, so what she is about to see loads before what she isn't
  const want = frames
    .filter(f=>f.state==='idle' && Math.abs(f.mesh.position.z-camZ)<Q.load)
    .sort((a,b)=>Math.abs(a.mesh.position.z-camZ)-Math.abs(b.mesh.position.z-camZ));

  while(inflight<CONCURRENT && want.length){
    const f=want.shift();
    f.state='loading'; inflight++;
    loader.load(f.src,
      (t)=>{
        inflight--;
        // she may have flown past while it was in the air
        if(Math.abs(f.mesh.position.z-camera.position.z)>Q.unload){ t.dispose(); f.state='idle'; return; }
        t.colorSpace=THREE.LinearSRGBColorSpace;   // decoded in the shader instead
        t.generateMipmaps=IS_GL2;
        t.minFilter=IS_GL2?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;
        t.magFilter=THREE.LinearFilter;
        t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
        t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        f.tex=t; f.state='ready';
        f.mat.uniforms.uMap.value=t;
        f.mat.uniforms.uHasTex.value=1;
      },
      undefined,
      ()=>{ inflight--; f.state='failed'; f.el.querySelector('.mk__s').textContent='file missing'; }
    );
  }

  for(const f of frames){
    if(f.state==='ready' && Math.abs(f.mesh.position.z-camZ)>Q.unload){
      f.mat.uniforms.uHasTex.value=0;
      f.mat.uniforms.uMap.value=null;
      f.tex.dispose(); f.tex=null; f.state='idle';
    }
  }
}

/* ───────────────────────────────────────────── corridor + camera */
const Z0 = 26, Z1 = CORRIDOR_END - 30;
const rig = {t:0,p:0,warp:0,lookX:0,lookY:0,camX:0,
             lock:null,lockW:0,lockTo:0,focus:40,ap:.16,px:0,py:0,ptx:0,pty:0};

const maxScroll = ()=>Math.max(1,document.documentElement.scrollHeight-innerHeight);
addEventListener('scroll',()=>{rig.t=clamp(scrollY/maxScroll(),0,1);},{passive:true});

const zToP = (z)=>clamp((z-Z0)/(Z1-Z0),0,1);

function flyTo(p,dur=1.5){
  const to=clamp(p,0,1)*maxScroll();
  if(!gsap){ scrollTo(0,to); return; }
  gsap.to({v:scrollY},{v:to,duration:dur,ease:'power3.inOut',
    onUpdate(){ scrollTo(0,this.targets()[0].v); }});
}

/* drag the hall with a mouse; touch keeps native scrolling */
let drag=null;
addEventListener('pointerdown',(e)=>{
  if(e.pointerType==='touch') return;
  if(e.target.closest && e.target.closest('button,.plaque,.gate,.chart')) return;
  drag={y:e.clientY,top:scrollY};
  document.body.style.cursor='grabbing';
});
addEventListener('pointermove',(e)=>{
  if(drag) scrollTo(0,clamp(drag.top+(drag.y-e.clientY)*2.2,0,maxScroll()));
},{passive:true});
['pointerup','pointercancel'].forEach(ev=>addEventListener(ev,()=>{drag=null;document.body.style.cursor='';}));

addEventListener('keydown',(e)=>{
  if(vOpen){
    if(e.key==='Escape') return closeView();
    if(e.key==='ArrowRight'){e.preventDefault();return vStep(1);}
    if(e.key==='ArrowLeft'){e.preventDefault();return vStep(-1);}
    return;
  }
  if(e.key==='Escape'){ if(!$('chart').hidden) return closeChart(); return unfocus(); }
  if(rig.lock!==null){
    if(e.key==='ArrowRight'){e.preventDefault();focusFrame(rig.lock+1);}
    if(e.key==='ArrowLeft'){e.preventDefault();focusFrame(rig.lock-1);}
    return;
  }
  const s=innerHeight*0.5;
  if(e.key==='ArrowDown'||e.key==='PageDown'||e.key===' '){e.preventDefault();flyTo((scrollY+s)/maxScroll(),.6);}
  if(e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();flyTo((scrollY-s)/maxScroll(),.6);}
});

/* ───────────────────────────────────────────── focus a frame */
function focusFrame(i){
  i=(i+N)%N;
  const f=frames[i];
  rig.lock=i; rig.lockTo=1;
  flyTo(zToP(f.mesh.position.z+10.5),1.2);

  dom.plaque.hidden=false;
  dom.plaqueId.textContent='OBJ-'+pad3(i+1);
  dom.plaqueFav.setAttribute('aria-pressed',String(favs.has(i+1)));
  if(gsap) gsap.fromTo(dom.plaque,{opacity:0,y:12},{opacity:1,y:0,duration:.45,ease:'power3.out'});
  seen.add(i); paintChart(); chime(i);
  openView(i);          // the camera flies there behind the photo, so closing
                        // leaves her standing in front of the frame

}
function unfocus(){
  if(rig.lock===null) return;
  rig.lock=null; rig.lockTo=0;
  if(gsap) gsap.to(dom.plaque,{opacity:0,y:8,duration:.28,ease:'power2.in',onComplete:()=>{dom.plaque.hidden=true;}});
  else dom.plaque.hidden=true;
}
dom.plaqueX.addEventListener('click',unfocus);

/* ── full photo ────────────────────────────────────────────────────────
   The hall shows the print hung on a wall, at an angle, part-lit. This is
   the other thing she needs: the actual photograph, whole, flat, as large
   as the screen allows.                                                 */
let vOpen=false, vIdx=0;

function openView(i){
  vIdx=(i+N)%N;
  const f=frames[vIdx];
  dom.view.hidden=false;
  requestAnimationFrame(()=>dom.view.classList.add('on'));
  vOpen=true;

  dom.viewImg.classList.remove('ready');
  dom.viewSpin.hidden=false;
  dom.viewImg.src=f.src;
  dom.viewImg.alt='Photograph '+pad3(vIdx+1);
  dom.viewId.textContent=pad3(vIdx+1);
  dom.viewFav.setAttribute('aria-pressed',String(favs.has(vIdx+1)));
  seen.add(vIdx); paintChart();
}
dom.viewImg.addEventListener('load',()=>{dom.viewImg.classList.add('ready');dom.viewSpin.hidden=true;});
dom.viewImg.addEventListener('error',()=>{dom.viewSpin.hidden=true;});

function closeView(){
  if(!vOpen) return;
  vOpen=false;
  dom.view.classList.remove('on');
  setTimeout(()=>{dom.view.hidden=true;},340);
  pluck(400);
}
const vStep=(d)=>openView(vIdx+d);

dom.viewX.addEventListener('click',closeView);
dom.viewPrev.addEventListener('click',()=>vStep(-1));
dom.viewNext.addEventListener('click',()=>vStep(1));
dom.viewFav.addEventListener('click',()=>toggleFav(vIdx+1));
dom.plaqueFull.addEventListener('click',()=>{ if(rig.lock!==null) openView(rig.lock); });

/* swipe: left/right between photos, down or a tap outside to dismiss */
let vx=0,vy=0,vdrag=false;
dom.view.addEventListener('pointerdown',(e)=>{
  if(e.target.closest('button')) return;
  vx=e.clientX; vy=e.clientY; vdrag=true;
});
dom.view.addEventListener('pointerup',(e)=>{
  if(!vdrag) return; vdrag=false;
  const dx=e.clientX-vx, dy=e.clientY-vy;
  if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)) return vStep(dx<0?1:-1);
  if(dy>95&&Math.abs(dy)>Math.abs(dx)) return closeView();
  if(Math.abs(dx)<10&&Math.abs(dy)<10&&e.target===dom.view) closeView();
});
dom.plaquePrev.addEventListener('click',()=>focusFrame(rig.lock-1));
dom.plaqueNext.addEventListener('click',()=>focusFrame(rig.lock+1));
dom.plaqueFav.addEventListener('click',()=>toggleFav(rig.lock+1));

function toggleFav(n){
  if(favs.has(n)) favs.delete(n); else favs.add(n);
  saveFavs();
  const on=favs.has(n);
  dom.favN.textContent=favs.size;
  frames[n-1].el.classList.toggle('kept',on);
  if(rig.lock===n-1) dom.plaqueFav.setAttribute('aria-pressed',String(on));
  if(vOpen&&vIdx===n-1) dom.viewFav.setAttribute('aria-pressed',String(on));
  paintChart();
}
frames.forEach((f,i)=>{ if(favs.has(i+1)) f.el.classList.add('kept'); });

/* ── tapping the actual frame, not just its label ─────────────────────
   A tap has to be told apart from a drag or a scroll fling, or every swipe
   down the hall would open a photograph.                                */
const ray=new THREE.Raycaster();
const ptr=new THREE.Vector2();
const hitMeshes=frames.map(f=>f.mesh);
let tap=null;

addEventListener('pointerdown',(e)=>{ tap={x:e.clientX,y:e.clientY,t:performance.now()}; },{passive:true});
addEventListener('pointerup',(e)=>{
  if(!tap) return;
  const moved=Math.hypot(e.clientX-tap.x,e.clientY-tap.y), held=performance.now()-tap.t;
  tap=null;
  if(moved>12||held>600) return;
  if(vOpen||!started) return;
  if(e.target.closest && e.target.closest('button,.plaque,.chart,.gate,.dock')) return;

  ptr.x=(e.clientX/innerWidth)*2-1;
  ptr.y=-(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr,camera);
  const hits=ray.intersectObjects(hitMeshes,false);
  if(hits.length){
    const i=frames.findIndex(f=>f.mesh===hits[0].object);
    if(i>=0) focusFrame(i);
  }
},{passive:true});

/* ───────────────────────────────────────────── post chain */
const quad=new FullScreenQuad(null);
let rtScene,rtA,rtB;
function makeTargets(){
  [rtScene,rtA,rtB].forEach(r=>r&&r.dispose());
  const dpr=renderer.getPixelRatio();
  const w=Math.max(2,Math.floor(innerWidth*dpr)), h=Math.max(2,Math.floor(innerHeight*dpr));
  const o={type:HDR,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false};
  rtScene=new THREE.WebGLRenderTarget(w,h,o);
  const bw=Math.max(2,Math.floor(w/Q.bloomDiv)), bh=Math.max(2,Math.floor(h/Q.bloomDiv));
  rtA=new THREE.WebGLRenderTarget(bw,bh,o);
  rtB=new THREE.WebGLRenderTarget(bw,bh,o);
}
const VQ=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

const matBright=new THREE.ShaderMaterial({
  uniforms:{tDiffuse:{value:null},uT:{value:.70},uK:{value:.28}},
  vertexShader:VQ,
  fragmentShader:`precision mediump float;uniform sampler2D tDiffuse;uniform float uT,uK;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float l=dot(c,vec3(.2126,.7152,.0722));
    float s=clamp((l-uT+uK)/(2.*uK),0.,1.);
    gl_FragColor=vec4(c*(max(l-uT,s*s*uK)/max(l,1e-4)),1.);}`
});
const matBlur=new THREE.ShaderMaterial({
  uniforms:{tDiffuse:{value:null},uStep:{value:new THREE.Vector2()}},
  vertexShader:VQ,
  fragmentShader:`precision mediump float;uniform sampler2D tDiffuse;uniform vec2 uStep;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb*.2270270270;
    c+=texture2D(tDiffuse,vUv+uStep*1.3846153846).rgb*.3162162162;
    c+=texture2D(tDiffuse,vUv-uStep*1.3846153846).rgb*.3162162162;
    c+=texture2D(tDiffuse,vUv+uStep*3.2307692308).rgb*.0702702703;
    c+=texture2D(tDiffuse,vUv-uStep*3.2307692308).rgb*.0702702703;
    gl_FragColor=vec4(c,1.);}`
});
const matComp=new THREE.ShaderMaterial({
  uniforms:{tScene:{value:null},tBloom:{value:null},uBloom:{value:.5},uStreak:{value:.3},
            uGrain:{value:.04},uAberr:{value:.0014},uVign:{value:.72},
            uFade:{value:0},uTime:{value:0},uAspect:{value:1}},
  vertexShader:VQ,
  fragmentShader:`
    precision highp float;
    uniform sampler2D tScene,tBloom;
    uniform float uBloom,uStreak,uGrain,uAberr,uVign,uFade,uTime,uAspect;
    varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
    vec3 shoulder(vec3 x){vec3 t=max(x-0.8,0.0);return min(x,vec3(0.8))+0.2*(1.0-exp(-t/0.2));}
    /* three only injects its output conversion into its OWN materials; this is
       a raw ShaderMaterial, so without this encode every photograph lands
       about two and a half stops too dark. */
    vec3 toSRGB(vec3 c){c=max(c,vec3(0.0));
      return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c));}
    void main(){
      vec2 cc=vUv-0.5; float r2=dot(cc,cc);
      vec2 off=cc*r2*uAberr*42.0;
      vec3 col=vec3(texture2D(tScene,vUv+off).r,texture2D(tScene,vUv).g,texture2D(tScene,vUv-off).b);
      vec3 bl=texture2D(tBloom,vUv).rgb;
      col+=bl*uBloom;
      col+=vec3(0.40,0.60,1.00)*dot(bl,vec3(0.33))*uStreak;
      col=toSRGB(shoulder(col));
      float g=hash(vUv*vec2(1920.,1080.)+fract(uTime)*91.7);
      col+=(g-0.5)*uGrain*(1.0-dot(col,vec3(.299,.587,.114))*0.6);
      col*=mix(1.0,smoothstep(1.0,0.16,length(cc*vec2(uAspect,1.0))),uVign);
      gl_FragColor=vec4(max(col,0.0)*uFade,1.0);
    }`
});
function blit(m,t){quad.material=m;renderer.setRenderTarget(t);renderer.clear(true,false,false);quad.render(renderer);}
function renderAll(){
  renderer.setRenderTarget(rtScene);renderer.clear(true,false,false);renderer.render(scene,camera);
  matBright.uniforms.tDiffuse.value=rtScene.texture; blit(matBright,rtA);
  matBlur.uniforms.tDiffuse.value=rtA.texture;
  matBlur.uniforms.uStep.value.set(4.0/rtA.width,0); blit(matBlur,rtB);
  if(Q.wide){
    matBlur.uniforms.tDiffuse.value=rtB.texture;
    matBlur.uniforms.uStep.value.set(10.0/rtA.width,0); blit(matBlur,rtA);
    matBlur.uniforms.tDiffuse.value=rtA.texture;
  } else matBlur.uniforms.tDiffuse.value=rtB.texture;
  matBlur.uniforms.uStep.value.set(0,1.0/rtA.height);
  blit(matBlur,Q.wide?rtB:rtA);
  matComp.uniforms.tScene.value=rtScene.texture;
  matComp.uniforms.tBloom.value=(Q.wide?rtB:rtA).texture;
  quad.material=matComp;renderer.setRenderTarget(null);renderer.clear(true,false,false);quad.render(renderer);
}

/* ───────────────────────────────────────────── chart */
const seen=new Set();
let chartBuilt=false;
function buildChart(){
  if(chartBuilt) return; chartBuilt=true;
  const pts=[];
  for(let i=0;i<N;i++){
    const a=i*2.39996323, r=45*Math.sqrt((i+.5)/N);
    pts.push({x:50+Math.cos(a)*r,y:50+Math.sin(a)*r});
  }
  let s='';
  for(let i=1;i<N;i++) s+=`<line x1="${pts[i-1].x.toFixed(2)}" y1="${pts[i-1].y.toFixed(2)}" x2="${pts[i].x.toFixed(2)}" y2="${pts[i].y.toFixed(2)}"/>`;
  pts.forEach((p,i)=>{s+=`<circle data-i="${i}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.6"><title>${pad3(i+1)}</title></circle>`;});
  dom.chartSvg.innerHTML=s;
  dom.chartSvg.addEventListener('click',(e)=>{
    const c=e.target.closest('circle'); if(!c) return;
    closeChart(); focusFrame(+c.dataset.i);
  });
}
function paintChart(){
  if(!chartBuilt) return;
  dom.chartSvg.querySelectorAll('circle').forEach(c=>{
    const i=+c.dataset.i;
    c.classList.toggle('kept',favs.has(i+1));
    c.classList.toggle('seen',!favs.has(i+1)&&seen.has(i));
  });
}
function openChart(){buildChart();paintChart();dom.chart.hidden=false;dom.chartBtn.classList.add('on');}
function closeChart(){dom.chart.hidden=true;dom.chartBtn.classList.remove('on');}
dom.chartBtn.addEventListener('click',()=>dom.chart.hidden?openChart():closeChart());
dom.chartX.addEventListener('click',closeChart);
dom.driftBtn.addEventListener('click',()=>{focusFrame(Math.floor(Math.random()*N));});
dom.favBtn.addEventListener('click',()=>{
  const list=[...favs].sort((a,b)=>a-b);
  if(!list.length){openChart();return;}
  const cur=rig.lock!==null?rig.lock+1:current+1;
  const nxt=list.find(n=>n>cur);
  focusFrame((nxt!==undefined?nxt:list[0])-1);
});

/* ───────────────────────────────────────────── sound
   A gallery at night. Two things only: the air of a large quiet room, and a
   warm chord that never resolves. Voices cross-fade over eight seconds, so a
   chord change is something you notice having happened, never something you
   hear happen — nothing attacks, nothing lands, there is no melody to follow.
   Off until asked for, and it remembers the choice.                        */

let actx=null, out=null, bed=null, voices=[], muted=true, chordI=0, chordTimer=null;

/* Cmaj9 → Am9 → Fmaj9 → Gsus. Four notes each, same voice count, so every
   voice just slides to its new pitch instead of restarting. */
const BEDS=[
  [130.81,196.00,246.94,329.63],
  [110.00,164.81,246.94,329.63],
  [87.31 ,174.61,261.63,329.63],
  [98.00 ,146.83,246.94,293.66]
];

function audioInit(){
  if(actx) return;
  const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
  actx=new AC();

  out=actx.createGain(); out.gain.value=0.9;
  const soft=actx.createDynamicsCompressor();
  soft.threshold.value=-22; soft.ratio.value=5; soft.attack.value=.05; soft.release.value=.6;
  out.connect(soft); soft.connect(actx.destination);

  // a big, soft room
  const len=Math.floor(actx.sampleRate*4.2);
  const ir=actx.createBuffer(2,len,actx.sampleRate);
  for(let c=0;c<2;c++){
    const d=ir.getChannelData(c);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.2);
  }
  const verb=actx.createConvolver(); verb.buffer=ir;
  const wet=actx.createGain(); wet.gain.value=.55;
  verb.connect(wet); wet.connect(out);

  bed=actx.createGain(); bed.gain.value=0;          // raised by the toggle
  bed.connect(out); bed.connect(verb);

  // ── the air of the room: filtered noise, slowly breathing
  const nb=actx.createBuffer(1,actx.sampleRate*4,actx.sampleRate);
  const nd=nb.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*.5;
  const noise=actx.createBufferSource(); noise.buffer=nb; noise.loop=true;
  const air=actx.createBiquadFilter(); air.type='lowpass'; air.frequency.value=620; air.Q.value=.4;
  const airG=actx.createGain(); airG.gain.value=.022;
  noise.connect(air); air.connect(airG); airG.connect(bed); noise.start();

  const breath=actx.createOscillator(); breath.frequency.value=.028;
  const breathAmt=actx.createGain(); breathAmt.gain.value=.008;
  breath.connect(breathAmt); breathAmt.connect(airG.gain); breath.start();

  // ── the chord: soft triangles behind a filter that drifts open and shut
  const lp=actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=560; lp.Q.value=.7;
  const padG=actx.createGain(); padG.gain.value=.040;
  lp.connect(padG); padG.connect(bed);

  const sweep=actx.createOscillator(); sweep.frequency.value=.021;
  const sweepAmt=actx.createGain(); sweepAmt.gain.value=230;
  sweep.connect(sweepAmt); sweepAmt.connect(lp.frequency); sweep.start();

  BEDS[0].forEach((f,i)=>{
    const o=actx.createOscillator(); o.type='triangle';
    o.frequency.value=f; o.detune.value=(i-1.5)*4;
    const g=actx.createGain(); g.gain.value=i===0?.30:.18;   // root carries
    o.connect(g); g.connect(lp); o.start();
    voices.push(o);

    // a second voice a breath flat, so the chord shimmers instead of sitting still
    const o2=actx.createOscillator(); o2.type='triangle';
    o2.frequency.value=f; o2.detune.value=(i-1.5)*4-7;
    const g2=actx.createGain(); g2.gain.value=.09;
    o2.connect(g2); g2.connect(lp); o2.start();
    voices.push(o2);
  });

  chordTimer=setInterval(nextBed,26000);
}

/* eight-second glide between chords: you never hear the change arrive */
function nextBed(){
  if(!actx||muted) return;
  chordI=(chordI+1)%BEDS.length;
  const t=actx.currentTime;
  voices.forEach((o,k)=>{
    const n=BEDS[chordI][Math.floor(k/2)];
    o.frequency.setTargetAtTime(n,t,2.8);
  });
}

function tapSound(freq=520,gain=.032,dur=.19){
  if(muted||!actx) return;
  const t=actx.currentTime;
  const o=actx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(freq,t);
  o.frequency.exponentialRampToValueAtTime(freq*0.74,t+dur*0.8);
  const g=actx.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(gain,t+.006);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t+dur+.02);
}
const blip =(f)=>tapSound(f||520);
const chime=(i)=>tapSound(560+((i*37)%5)*44,.036,.24);
const pluck=(f)=>tapSound(f||400,.026,.15);

try{ muted = localStorage.getItem('hall.sound')!=='on'; }catch(_){}

function setSound(on){
  audioInit(); if(!actx) return;
  if(actx.state==='suspended') actx.resume();
  muted=!on;
  dom.sndBtn.setAttribute('aria-pressed',String(on));
  try{ localStorage.setItem('hall.sound',on?'on':'off'); }catch(_){}
  // twelve seconds to fade up. A room tone that arrives is a room tone you heard.
  bed.gain.cancelScheduledValues(actx.currentTime);
  bed.gain.linearRampToValueAtTime(on?0.34:0, actx.currentTime+(on?12:1.5));
}
dom.sndBtn.addEventListener('click',()=>setSound(muted));

/* ───────────────────────────────────────────── pointer + gyro */
addEventListener('pointermove',(e)=>{
  if(COARSE) return;
  dom.cursor.style.transform=`translate3d(${e.clientX}px,${e.clientY}px,0)`;
  rig.ptx=(e.clientX/innerWidth)*2-1;
  rig.pty=-((e.clientY/innerHeight)*2-1);
  dom.cursor.classList.toggle('hot',!!(e.target.closest&&e.target.closest('.mk,button')));
},{passive:true});
function attachGyro(){
  addEventListener('deviceorientation',(e)=>{
    if(e.gamma==null) return;
    rig.ptx=clamp(e.gamma/36,-1,1);
    rig.pty=clamp((e.beta-48)/36,-1,1);
  },{passive:true});
}

/* ───────────────────────────────────────────── open */
let started=false,fadeTo=0;

// preload the first handful so the hall is already hung when she walks in
(function warm(){
  let done=0;
  const want=Math.min(5,N);
  for(let i=0;i<want;i++){
    const f=frames[i];
    f.state='loading'; inflight++;
    loader.load(f.src,(t)=>{
      inflight--;
      t.colorSpace=THREE.LinearSRGBColorSpace;
      t.generateMipmaps=IS_GL2;
      t.minFilter=IS_GL2?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;
      t.magFilter=THREE.LinearFilter;
      t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
      f.tex=t; f.state='ready';
      f.mat.uniforms.uMap.value=t; f.mat.uniforms.uHasTex.value=1;
      step();
    },undefined,()=>{inflight--;f.state='failed';step();});
  }
  function step(){
    done++;
    dom.gateBar.style.width=(done/want*100)+'%';
    if(done>=want){ dom.enter.disabled=false; if(gsap) gsap.fromTo(dom.enter,{opacity:.3},{opacity:1,duration:.5}); }
  }
  if(!want){ dom.enter.disabled=false; }
})();

buildName(NAME);

dom.enter.addEventListener('click',async()=>{
  if(started) return; started=true;
  audioInit();
  if(!muted) setSound(true); else dom.sndBtn.setAttribute('aria-pressed','false');
  try{
    const D=window.DeviceOrientationEvent;
    if(COARSE&&D&&typeof D.requestPermission==='function'){ if(await D.requestPermission()==='granted') attachGyro(); }
    else if(COARSE&&D) attachGyro();
  }catch(_){}
  fadeTo=1;
  // scroll stays locked (html.booting) until the name has come and gone
  if(gsap) gsap.to(dom.gate,{opacity:0,duration:.8,ease:'power2.inOut',onComplete:()=>{dom.gate.style.display='none';}});
  else dom.gate.style.display='none';
  introT=0;
});


/* ═══════════════════════════════════════════════════════════════════════
   THE NAME, ASSEMBLED OUT OF STARLIGHT
   Her name is rasterised to an offscreen canvas, the lit pixels become
   target positions, and a cloud of points flies in from a sphere to land on
   them. It holds, then blows apart as the camera falls into the hall. No
   image file and no font file is needed at runtime beyond the one the page
   already loads.
   ══════════════════════════════════════════════════════════════════════ */

const INTRO = { gather:2.4, hold:2.0, scatter:1.8 };
const INTRO_Z0 = 150, INTRO_Z1 = Z0;
let nameMesh=null, nameU=null, introT=-1, introDone=false;

const nameMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, depthTest:false, blending:THREE.AdditiveBlending,
  uniforms:{ uIn:{value:0}, uOut:{value:0}, uScale:{value:26}, uZ:{value:0},
             uDpr:{value:renderer.getPixelRatio()}, uTime:{value:0} },
  vertexShader:`
    attribute vec3 aTarget;    // where the letter is, in normalised units
    attribute vec3 aStart;     // where this mote begins, out in the dark
    attribute float aSeed;
    uniform float uIn,uOut,uScale,uZ,uDpr,uTime;
    varying float vA;
    void main(){
      // each mote lands on its own beat, so the word writes itself
      float local = clamp(uIn*1.38 - aSeed*0.38, 0.0, 1.0);
      local = local*local*(3.0-2.0*local);

      vec3 tgt = vec3(aTarget.xy*uScale, uZ);
      vec3 pos = mix(aStart*uScale + vec3(0.0,0.0,uZ), tgt, local);

      // then it is thrown outward as the hall opens
      pos += normalize(aStart+vec3(0.001)) * uOut*uOut * 150.0;
      pos.y += sin(uTime*0.8 + aSeed*12.0) * 0.06 * local;

      vec4 mv = modelViewMatrix * vec4(pos,1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp((0.9 + aSeed*0.8) * uDpr * (230.0/max(1.0,-mv.z)) * (0.4+local*0.85), 1.0, 4.6*uDpr);
      vA = local * (1.0-uOut) * 0.62;
    }`,
  fragmentShader:`
    precision highp float;
    varying float vA;
    void main(){
      float r = length(gl_PointCoord*2.0-1.0);
      if(r>1.0) discard;
      float s = pow(max(0.0,1.0-r),2.2);
      float a = s*vA*0.80;
      if(a<0.003) discard;
      gl_FragColor = vec4(mix(vec3(0.78,0.89,1.0), vec3(1.0,0.94,0.86), 1.0-vA), a);
    }`
});

async function buildName(text){
  try{ await document.fonts.ready; }catch(_){}

  const W=1024, H=300;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const g=cv.getContext('2d');
  g.fillStyle='#fff'; g.textAlign='center'; g.textBaseline='middle';
  let size=210;
  const font=(s)=>`400 ${s}px 'Bodoni Moda', Georgia, serif`;
  g.font=font(size);
  while(g.measureText(text).width > W*0.86 && size>40){ size-=6; g.font=font(size); }
  g.fillText(text, W/2, H/2);

  const d=g.getImageData(0,0,W,H).data;
  const pts=[];
  const step = COARSE ? 7 : 5;   // Bodoni's stems are ~30px here; 3px sampling
                                 // put ten points across every stroke and fused them
  for(let y=0;y<H;y+=step) for(let x=0;x<W;x+=step){
    if(d[(y*W+x)*4+3]>120){
      pts.push([(x+(Math.random()-0.5)*step*1.6)/W-0.5, -((y+(Math.random()-0.5)*step*1.6)/H-0.5)*(H/W)]);
    }
  }
  if(!pts.length) return;

  const n=pts.length;
  const tg=new Float32Array(n*3), st=new Float32Array(n*3), sd=new Float32Array(n);
  for(let i=0;i<n;i++){
    tg[i*3]=pts[i][0]; tg[i*3+1]=pts[i][1]; tg[i*3+2]=0;
    const th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1), r=1.6+Math.random()*2.6;
    st[i*3]  =r*Math.sin(ph)*Math.cos(th);
    st[i*3+1]=r*Math.sin(ph)*Math.sin(th)*0.6;
    st[i*3+2]=(Math.random()-0.5)*1.2;
    sd[i]=Math.random();
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*3),3));
  geo.setAttribute('aTarget', new THREE.BufferAttribute(tg,3));
  geo.setAttribute('aStart',  new THREE.BufferAttribute(st,3));
  geo.setAttribute('aSeed',   new THREE.BufferAttribute(sd,1));
  nameMesh=new THREE.Points(geo,nameMat);
  nameMesh.frustumCulled=false; nameMesh.renderOrder=5;
  scene.add(nameMesh);
  fitName();
}

/* the word has to fit the screen it lands on, portrait phone included */
function fitName(){
  if(!nameMat) return;
  const dist = INTRO_Z0 - (INTRO_Z0 - 42);
  const vh = 2*42*Math.tan(camera.fov*Math.PI/360);
  const vw = vh*(innerWidth/innerHeight);
  nameMat.uniforms.uScale.value = Math.min(30, vw*0.82);
  nameMat.uniforms.uZ.value = INTRO_Z0 - 42;
}

const veil=document.createElement('div');
veil.className='nameveil';
veil.innerHTML='<p>'+NAME_SUB+'</p>';
document.body.appendChild(veil);

function runIntro(dt){
  if(introDone) return false;
  if(introT<0) return false;
  introT+=dt;

  const g=INTRO.gather, h=g+INTRO.hold, s=h+INTRO.scatter;
  nameMat.uniforms.uTime.value=introT;
  nameMat.uniforms.uIn.value  = clamp(introT/g,0,1);
  nameMat.uniforms.uOut.value = introT<=h ? 0 : clamp((introT-h)/INTRO.scatter,0,1);

  if(introT>g*0.75 && introT<h+0.3) veil.classList.add('on');
  else veil.classList.remove('on');

  // fall into the hall as the word comes apart
  const fly = introT<=h ? 0 : smooth(clamp((introT-h)/INTRO.scatter,0,1));
  camera.position.set(0,0,lerp(INTRO_Z0,INTRO_Z1,fly));
  camera.lookAt(0,0,camera.position.z-30);

  if(introT>=s){
    introDone=true;
    if(nameMesh){ scene.remove(nameMesh); nameMesh.geometry.dispose(); nameMesh=null; }
    veil.remove();
    document.documentElement.classList.remove('booting');
    dom.hud.classList.add('on');
    if(gsap) gsap.to(dom.hud,{opacity:1,duration:1.1,ease:'power2.out'});
    else dom.hud.style.opacity=1;
    return false;
  }
  return true;
}

/* ───────────────────────────────────────────── labels */
const _v=new THREE.Vector3();
let current=0;
function updateMarks(){
  let best=Infinity,bi=current;
  for(const f of frames){
    const m=f.mesh;
    f.dist=camera.position.distanceTo(m.position);

    const dz=Math.abs(m.position.z-camera.position.z);
    if(dz<best){best=dz;bi=f.i;}

    _v.set(m.position.x,m.position.y-f.planeH*0.5-1.1,m.position.z).project(camera);
    const rx=(_v.x*.5+.5)*innerWidth, y=(-_v.y*.5+.5)*innerHeight;
    const on=_v.z<1 && rx>-70 && rx<innerWidth+70 && y>40 && y<innerHeight-100;
    const vis=on && f.dist<70 && rig.lock!==f.i;
    if(vis!==f.vis){ f.vis=vis; f.el.classList.toggle('vis',vis); }
    if(vis) f.el.style.transform=`translate3d(${clamp(rx,62,innerWidth-62)}px,${y}px,0) translate(-50%,0)`;

    // the nearer a frame, the brighter its mount and image read
    const glow=clamp(1-(f.dist-6)/42,0,1);
    f.mat.uniforms.uGlow.value=damp(f.mat.uniforms.uGlow.value,
      rig.lock===f.i?1:glow*0.75, 4, 0.016);
  }
  if(bi!==current){ current=bi; dom.hudNum.textContent=pad3(bi+1); seen.add(bi); }
  dom.railFill.style.width=(rig.p*100)+'%';
}

/* ───────────────────────────────────────────── loop */
const clock=new THREE.Clock();
let T=0, gF=0, gT=0, gDone=false;

function governor(dt){
  if(gDone||!started) return;
  gF++; gT+=dt; if(gT<3) return;
  const fps=gF/gT; gDone=true;
  if(fps>=42||TIER==='low') return;
  TIER=TIER==='high'?'mid':'low'; Q=TIERS[TIER];
  renderer.setPixelRatio(Math.min(devicePixelRatio,Q.dpr));
  renderer.setSize(innerWidth,innerHeight);
  starMat.uniforms.uDpr.value=renderer.getPixelRatio();
  starMat.uniforms.uSizeK.value=Q.sizeK;
  window.__stars.geometry.setDrawRange(0,Q.stars);
  matComp.uniforms.uGrain.value=.03;
  makeTargets();
}

function frame(){
  const dt=Math.min(clock.getDelta(),.05);
  T+=dt;

  if(runIntro(dt)){
    starMat.uniforms.uTime.value=T;
    matComp.uniforms.uTime.value=T;
    matComp.uniforms.uBloom.value=0.20;     // a bright word plus full bloom
    matComp.uniforms.uStreak.value=0.06;    // smears back into a solid slab
    matComp.uniforms.uFade.value=damp(matComp.uniforms.uFade.value,fadeTo,1.2,dt);
    for(const f of frames) f.mat.uniforms.uTime.value=T;
    stream(camera.position.z);
    renderAll();
    return;
  }

  const vel=Math.abs(rig.t-rig.p);
  rig.p=damp(rig.p,rig.t,3.4,dt);
  rig.warp=damp(rig.warp,clamp(vel*26,0,1),4,dt);

  const z=lerp(Z0,Z1,rig.p);
  camera.fov=damp(camera.fov,56+rig.warp*9,3,dt);
  camera.updateProjectionMatrix();

  rig.lockW=damp(rig.lockW,rig.lockTo,rig.lockTo>0?2.4:3,dt);
  rig.px=damp(rig.px,rig.ptx,2.2,dt);
  rig.py=damp(rig.py,rig.pty,2.2,dt);

  // drift gently down the aisle; swing toward a frame when one is open
  let tx=Math.sin(T*.14)*1.3, lx=Math.sin(T*.11)*2.2, ly=Math.cos(T*.09)*1.1;
  if(rig.lock!==null){
    const m=frames[rig.lock].mesh;
    tx=lerp(tx,m.position.x*0.42,rig.lockW);
    lx=lerp(lx,m.position.x*0.92,rig.lockW);
    ly=lerp(ly,m.position.y,rig.lockW);
  }
  rig.camX=damp(rig.camX,tx,2.4,dt);
  rig.lookX=damp(rig.lookX,lx,2.6,dt);
  rig.lookY=damp(rig.lookY,ly,2.6,dt);

  camera.position.set(rig.camX+rig.px*1.8, Math.sin(T*.1)*.7+rig.py*1.2, z);
  camera.lookAt(rig.lookX, rig.lookY, z-26);

  rig.focus=damp(rig.focus, rig.lock!==null?clamp(frames[rig.lock].dist,5,120):34, 2, dt);
  rig.ap=damp(rig.ap, rig.lock!==null?0.26:0.13, 2.2, dt);

  starMat.uniforms.uTime.value=T;
  starMat.uniforms.uFocus.value=rig.focus;
  starMat.uniforms.uAperture.value=rig.ap;

  for(const f of frames){
    const u=f.mat.uniforms;
    u.uTime.value=T; u.uFocus.value=rig.focus; u.uAperture.value=rig.ap;
  }

  matComp.uniforms.uTime.value=T;
  matComp.uniforms.uBloom.value=.46+rig.warp*.26;
  matComp.uniforms.uStreak.value=.26+rig.warp*.3;
  matComp.uniforms.uAberr.value=.0012+rig.warp*.0024;
  matComp.uniforms.uFade.value=damp(matComp.uniforms.uFade.value,fadeTo,1.2,dt);

  if(dom.cue) dom.cue.style.opacity=rig.p>.012?'0':'';

  updateMarks();
  stream(z);
  renderAll();
  governor(dt);
}
renderer.setAnimationLoop(frame);

/* ───────────────────────────────────────────── resize */
function sync(){ matComp.uniforms.uAspect.value=innerWidth/innerHeight; starMat.uniforms.uDpr.value=renderer.getPixelRatio(); }
let rz,lastW=innerWidth;
function resize(){
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio,Q.dpr));
  renderer.setSize(innerWidth,innerHeight);
  makeTargets(); sync(); fitName();
  rig.t=clamp(scrollY/maxScroll(),0,1);
}
addEventListener('resize',()=>{
  if(COARSE&&innerWidth===lastW) return;        // height-only = the URL bar
  lastW=innerWidth; clearTimeout(rz); rz=setTimeout(resize,140);
});
addEventListener('orientationchange',()=>setTimeout(resize,260));
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') clock.getDelta(); });

makeTargets(); sync();