import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const globalStyles = `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
    user-select: none;
    -webkit-user-select: none;
  }
  .canvas-container {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #000;
  }
  canvas {
    display: block;
    width: 100vw;
    height: 100vh;
    touch-action: none;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
`;

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  #define PI 3.14159265359
  #define MAX_STEPS 160

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec3  camPos;
  uniform vec3  camRight;
  uniform vec3  camUp;
  uniform vec3  camForward;
  uniform float camFov;
  uniform float uRs;
  uniform float uDiskInner;
  uniform float uDiskOuter;
  uniform float uDiskRotSpeed;
  uniform float uDiskSpin;
  uniform float uExposure;
  uniform float uAxisTilt;
  uniform float uCameraRoll;
  uniform vec3  uTravel;

  // ---- Hash y Ruido 3D Ultra-Optimizado -------------------------------------
  float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
  }

  float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
      float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

      float x00 = mix(n000, n100, f.x);
      float x10 = mix(n010, n110, f.x);
      float x01 = mix(n001, n101, f.x);
      float x11 = mix(n011, n111, f.x);

      float y0 = mix(x00, x10, f.y);
      float y1 = mix(x01, x11, f.y);

      return mix(y0, y1, f.z);
  }

  float fbm(vec3 p) {
      float v = 0.55 * noise3(p);
      v += 0.30 * noise3(p * 2.04 + vec3(11.7, 3.1, 7.9));
      v += 0.15 * noise3(p * 4.08 + vec3(23.4, 6.2, 15.8));
      return v;
  }

  float fbmFlow(vec3 p, float lac) {
      float v = 0.60 * noise3(p);
      v += 0.28 * noise3(p * lac + vec3(5.3, 9.1, 2.7));
      v += 0.12 * noise3(p * (lac * 2.0) + vec3(12.1, 4.3, 8.9));
      return v;
  }

  // ---- Fondo HD: Estrellas Nítidas y Nebulosas Cósmicas ---------------------
  vec3 starfield(vec3 dir, vec3 travel) {
      vec3 col = vec3(0.0);
      for (int layer = 0; layer < 2; layer++) {
          float scale = 65.0 + float(layer) * 45.0;
          vec3 p = dir * scale + travel * (0.35 + float(layer) * 0.45);
          vec3 cell = floor(p);
          vec3 f = fract(p);

          float h = hash13(cell + float(layer) * 17.0);
          if (h > 0.962) {
              vec3 c = vec3(
                  0.2 + 0.6 * hash13(cell + 1.7),
                  0.2 + 0.6 * hash13(cell + 5.3),
                  0.2 + 0.6 * hash13(cell + 9.1)
              );
              float d = length(f - c);
              float s = smoothstep(0.10, 0.0, d);
              float temp = hash13(cell + 3.3);
              vec3 tint = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.92, 0.85), temp);
              col += tint * s * (0.8 + 1.6 * hash13(cell + 21.0));
          }
      }
      return col;
  }

  vec3 bigStars(vec3 dir, vec3 travel) {
      vec3 p = dir * 20.0 + travel * 0.10;
      vec3 cell = floor(p);
      vec3 f = fract(p);

      float h = hash13(cell + 41.0);
      if (h < 0.94) return vec3(0.0);

      vec3 c = vec3(
          0.25 + 0.5 * hash13(cell + 2.2),
          0.25 + 0.5 * hash13(cell + 6.6),
          0.25 + 0.5 * hash13(cell + 10.4)
      );
      float d = length(f - c);
      float core = smoothstep(0.065, 0.0, d);
      float glow = exp(-d * 16.0) * 0.4;
      float temp = hash13(cell + 8.8);
      vec3 tint = mix(vec3(0.8, 0.92, 1.0), vec3(1.0, 0.95, 0.88), temp);
      return tint * (core * 2.6 + glow) * (0.7 + 0.8 * hash13(cell + 30.0));
  }

  vec3 nebulaClouds(vec3 dir, vec3 travel) {
      float n1 = fbm(dir * 2.0 + travel * 0.02 + vec3(3.0, 1.0, 7.0));
      float n2 = fbm(dir * 4.2 + travel * 0.035 + vec3(9.0, 4.0, 2.0));
      float m = smoothstep(0.40, 0.85, n1 * 0.65 + n2 * 0.35);

      // Colores de nebulosa idénticos a la referencia: morados oscuros y azulados
      vec3 colA = vec3(0.12, 0.05, 0.22); // Púrpura interestelar
      vec3 colB = vec3(0.03, 0.09, 0.20); // Azul espacial profundo
      vec3 colC = vec3(0.07, 0.02, 0.15); // Violeta tenue
      vec3 neb = mix(colA, colB, n2);
      neb = mix(neb, colC, smoothstep(0.5, 0.9, n1) * 0.5);
      return neb * m * 0.65;
  }

  // ---- Paleta de Azul Cósmico Brillante (Gargantua Azul) -------------------
  vec3 diskRamp(float t) {
      // Centro incandescente blanco-azulado (como en la imagen de referencia)
      vec3 whiteCore = vec3(0.88, 0.96, 1.00) * 3.6;
      vec3 skyBlue   = vec3(0.35, 0.82, 1.00) * 3.0;
      vec3 midBlue   = vec3(0.10, 0.55, 1.00) * 2.6;
      vec3 deepBlue  = vec3(0.03, 0.25, 0.92) * 2.1;
      vec3 navy      = vec3(0.01, 0.08, 0.48) * 1.4;
      vec3 darkEdge  = vec3(0.005, 0.02, 0.18) * 0.6;

      vec3 c = mix(whiteCore, skyBlue, smoothstep(-0.02, 0.15, t));
      c = mix(c, midBlue, smoothstep(0.10, 0.42, t));
      c = mix(c, deepBlue, smoothstep(0.35, 0.68, t));
      c = mix(c, navy, smoothstep(0.55, 0.88, t));
      c = mix(c, darkEdge, smoothstep(0.75, 1.05, t));
      c = mix(c, vec3(0.0), smoothstep(0.98, 1.25, t));
      return c;
  }

  // ---- Estrellitas / Partículas: POCAS Y JUSTO AL TERMINAR LA PARTE AZUL ---
  float boundaryParticles(float r, float phi, float innerR, float outerR, float time) {
      float t = (r - innerR) / (outerR - innerR);

      // Estrictamente al terminar la parte azul (borde exterior sutil)
      if (t < 0.88 || t > 1.08) return 0.0;

      // Franja muy fina y suave justo donde el azul se funde con el espacio
      float edgeMask = smoothstep(0.88, 0.94, t) * (1.0 - smoothstep(1.02, 1.08, t));

      float rRatio = max(r, innerR * 0.7) / innerR;
      float omega = 1.15 / (rRatio * sqrt(rRatio));
      float rotAngle = phi - omega * (7.0 + time * 1.4) * uDiskRotSpeed * uDiskSpin;

      // Celdas más espaciadas para que sean POCAS y esparcidas naturalmente
      float radialScale = 7.0;
      float angularBins = floor(r * 10.0);

      float rCell = floor(r * radialScale);
      float rFract = fract(r * radialScale);

      float aCoord = (rotAngle / (2.0 * PI) + 0.5) * angularBins;
      float aCell = floor(aCoord);
      float aFract = fract(aCoord);

      vec3 seed = vec3(rCell, mod(aCell, max(angularBins, 1.0)), 19.3);
      float prob = hash13(seed);

      float pAccum = 0.0;
      // Umbral alto (0.91): solo aparecen pocas motas de polvo estelar aisladas
      if (prob > 0.91) {
          vec2 center = vec2(0.3 + 0.4 * hash13(seed + 4.1), 0.3 + 0.4 * hash13(seed + 8.7));
          vec2 d = vec2((rFract - center.x) * 1.5, (aFract - center.y) * 0.9);
          float dist = length(d);
          float size = 0.12 + 0.14 * hash13(seed + 13.5);
          float spark = smoothstep(size, 0.0, dist);
          float twinkle = 0.6 + 0.4 * sin(time * (4.0 + prob * 5.0) + prob * 35.0);
          pAccum = spark * twinkle * (0.7 + 0.6 * prob);
      }

      return pAccum * edgeMask;
  }

  // ---- Disco de Acreción de Gargantua --------------------------------------
  vec4 evaluateDiskAndClouds(vec3 p, vec3 rayDir, float innerR, float outerR, float time) {
      float r = length(p.xz);
      float t = (r - innerR) / (outerR - innerR);
      if (t < -0.06 || t > 1.25) return vec4(0.0);

      float phi = atan(p.z, p.x);

      float rRatio = max(r, innerR * 0.75) / innerR;
      float omega = 1.15 / (rRatio * sqrt(rRatio));
      float windTime = 6.0 + time * 1.2;
      float swirl = phi - omega * windTime * uDiskRotSpeed * uDiskSpin;

      vec2 flowXY = vec2(cos(swirl), sin(swirl)) * r;
      vec3 flowP = vec3(flowXY.x * 0.22, flowXY.y * 0.22, r * 0.05 - time * 0.06);

      float nFilaments = clamp(fbmFlow(flowP, 2.6), 0.0, 1.0);
      float grooveWave1 = sin(r * 4.2 + nFilaments * 2.0) * 0.5 + 0.5;
      float grooveWave2 = sin(r * 11.0 + nFilaments * 1.5) * 0.5 + 0.5;
      float concentricRings = mix(0.70, 1.25, smoothstep(0.1, 0.9, grooveWave1 * 0.6 + grooveWave2 * 0.4));

      float cloudSwirl = phi - omega * (3.0 + time * 1.0) * uDiskRotSpeed * uDiskSpin;
      vec2 cloudXY = vec2(cos(cloudSwirl), sin(cloudSwirl)) * r;
      float cloudBillows = fbm(vec3(cloudXY * 0.45, r * 0.16 + time * 0.08));
      float cloudStructure = smoothstep(0.24, 0.8, cloudBillows);

      float lanes = noise3(vec3(flowXY.x * 0.5, flowXY.y * 0.5, time * 0.08));
      float dustLane = smoothstep(0.18, 0.78, lanes);

      // Zona interior brillante
      float yOmega = omega * 1.7;
      float ySwirl = phi - yOmega * (3.0 + time * 1.2) * uDiskRotSpeed * uDiskSpin;
      vec2 yXY = vec2(cos(ySwirl), sin(ySwirl)) * r;
      float yPat = fbm(vec3(yXY * 0.35, time * 0.05));
      float coreZone = 1.0 - smoothstep(0.0, 0.50, t);
      float tShift = (0.5 - yPat) * 0.22 * coreZone;

      vec3 baseColor = diskRamp(t + tShift + (nFilaments - 0.5) * 0.11 - (concentricRings - 0.9) * 0.03);

      float edgeNoise = noise3(vec3(cos(phi) * 2.2, sin(phi) * 2.2, time * 0.03));
      float outerEdge = 0.92 + edgeNoise * 0.35;
      float innerCloudEdge = smoothstep(-0.06, 0.04, t + (cloudStructure - 0.5) * 0.04);
      float radialMask = innerCloudEdge * (1.0 - smoothstep(0.55, outerEdge, t));

      float spiral = 0.75 + 0.25 * sin(3.0 * swirl + r * 0.55) + 0.14 * sin(5.0 * swirl - r * 0.9);
      float density = radialMask * (0.65 + 0.45 * nFilaments) * concentricRings * mix(0.65, 1.1, dustLane) * spiral;

      vec3 tangent = normalize(vec3(-p.z, 0.0, p.x)) * uDiskSpin;
      float vOrb = clamp(sqrt(uRs / (2.0 * max(r, uRs))), 0.0, 0.95);
      float mu = dot(tangent, -rayDir);
      float dopplerFactor = 1.0 / max(0.16, (1.0 - vOrb * mu));
      float beaming = dopplerFactor * dopplerFactor;

      vec3 col = baseColor * density * beaming * (1.0 + 0.25 * (yPat - 0.5) * coreZone);

      // Partículas sutiles justo en el término del disco azul
      float particles = boundaryParticles(r, phi, innerR, outerR, time);
      vec3 particleCol = vec3(0.35, 0.72, 1.0) * beaming * 1.2;
      col += particleCol * particles;

      col.b *= clamp(dopplerFactor, 0.6, 1.6);
      col.r *= clamp(2.0 - dopplerFactor, 0.5, 1.3);

      col = col / (1.0 + 0.55 * col);

      float alpha = clamp(max(max(col.r, col.g), col.b) * 0.85 + particles * 0.5, 0.0, 0.98);
      return vec4(max(col, 0.0), alpha);
  }

  vec3 acesFilm(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 rotateX(vec3 v, float a) {
      float c = cos(a), s = sin(a);
      return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  }

  // ---- Raymarching Geodésico Ultra-Rápido -----------------------------------
  vec3 traceRay(vec3 ro, vec3 rd) {
      vec3 pos = rotateX(ro, -uAxisTilt);
      vec3 dir = rotateX(rd, -uAxisTilt);
      vec3 h = cross(pos, dir);
      float h2 = dot(h, h);

      float escapeR = uRs * 190.0;
      bool hitHorizon = false;
      float lensR = uDiskOuter * 0.5;

      float photonR = uRs * 2.1;
      float ringWidth = uRs * 0.08;
      float minR = escapeR;

      vec3 accumColor = vec3(0.0);
      float accumAlpha = 0.0;

      for (int i = 0; i < MAX_STEPS; i++) {
          float r = length(pos);
          minR = min(minR, r);

          if (r < uRs * 1.02) { hitHorizon = true; break; }

          // Optimización de escape: si el rayo se aleja del agujero y ya salió de la zona gravitatoria activa
          if ((r > uDiskOuter * 1.35 && dot(pos, dir) > 0.0) || r > escapeR || accumAlpha > 0.98) {
              break;
          }

          float dt = clamp(r * 0.16, 0.035, 1.9);

          // Atenuación y aceleración gravitatoria optimizada sin pow()
          float rl = r / lensR;
          float rl2 = rl * rl;
          float rl4 = rl2 * rl2;
          float atten = 1.0 / (1.0 + rl4 * rl4);

          float r2 = r * r;
          vec3 accel = (-1.5 * uRs * h2 * atten / (r2 * r2 * r)) * pos;
          vec3 newDir = normalize(dir + accel * dt);
          vec3 newPos = pos + newDir * dt;

          // Detección de cruce del plano ecuatorial del disco
          if (sign(pos.y) != sign(newPos.y)) {
              float tc = pos.y / (pos.y - newPos.y);
              vec3 hitP = mix(pos, newPos, tc);
              float rHit = length(hitP.xz);
              if (rHit > uDiskInner * 0.8 && rHit < uDiskOuter * 1.25) {
                  vec4 diskSample = evaluateDiskAndClouds(hitP, newDir, uDiskInner, uDiskOuter, iTime);
                  accumColor += (1.0 - accumAlpha) * diskSample.rgb;
                  accumAlpha += (1.0 - accumAlpha) * diskSample.a;
              }
          }

          pos = newPos;
          dir = newDir;
      }

      // Fondo galáctico nítido en HD
      vec3 bg = hitHorizon ? vec3(0.0) : (starfield(dir, uTravel) + bigStars(dir, uTravel) + nebulaClouds(dir, uTravel));

      // Resplandor del anillo de fotones
      float diff = (minR - photonR) / ringWidth;
      float ringGlow = exp(-diff * diff);
      vec3 ring = diskRamp(0.02) * ringGlow * 1.9;

      return accumColor + (1.0 - accumAlpha) * (bg + ring);
  }

  void main() {
      vec2 uv = (gl_FragCoord.xy / iResolution.xy - 0.5) * 2.0;
      uv.x *= iResolution.x / iResolution.y;

      float tanFov = tan(camFov * 0.5);
      vec3 rayDir = normalize(camForward + uv.x * tanFov * camRight + uv.y * tanFov * camUp);

      vec3 col = traceRay(camPos, rayDir);

      col = acesFilm(col * uExposure);

      // Saturación cinematográfica
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = clamp(mix(vec3(luma), col, 1.28), 0.0, 1.0);

      col = pow(col, vec3(1.0 / 2.2));

      gl_FragColor = vec4(col, 1.0);
  }
`;

function App() {
  const mountRef = useRef(null);

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp',
    });

    // HD total con pixelRatio nítido 1:1 o hasta 1.5 en pantallas de alta densidad
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const mount = mountRef.current;
    if (mount) {
      mount.appendChild(renderer.domElement);
    }

    const uniforms = {
      iResolution:   { value: new THREE.Vector2() },
      iTime:         { value: 0 },
      camPos:        { value: new THREE.Vector3() },
      camRight:      { value: new THREE.Vector3() },
      camUp:         { value: new THREE.Vector3() },
      camForward:    { value: new THREE.Vector3() },
      camFov:        { value: THREE.MathUtils.degToRad(42.0) },
      uRs:           { value: 1.0 },   // Radio de Schwarzschild
      uDiskInner:    { value: 2.2 },   // ISCO
      uDiskOuter:    { value: 19.5 },  // Disco exterior amplio
      uDiskRotSpeed: { value: 2.6 },   // Velocidad de rotación del disco
      uDiskSpin:     { value: 1.0 },
      uExposure:     { value: 1.5 },
      uAxisTilt:     { value: 0.0 },
      uCameraRoll:   { value: 0.0 },
      uTravel:       { value: new THREE.Vector3() },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    // Ángulo de cámara idéntico a la imagen de referencia (perspectiva panorámica)
    let theta = 0.0;
    let phi = 1.35;
    let radius = 33.0;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const dom = renderer.domElement;

    const onPointerDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    };

    const onPointerUp = () => {
      dragging = false;
    };

    const onPointerCancel = () => {
      dragging = false;
    };

    const onPointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      theta -= dx * 0.004;
      phi -= dy * 0.004;
      phi = Math.min(Math.max(phi, 0.2), Math.PI - 0.2);
    };

    const onWheel = (e) => {
      e.preventDefault();
      radius *= Math.exp(e.deltaY * 0.0015);
      radius = Math.min(Math.max(radius, 10.0), 100.0);
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('wheel', onWheel, { passive: false });

    function updateCamera() {
      const camPos = uniforms.camPos.value;
      camPos.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      const forward = uniforms.camForward.value.copy(camPos).multiplyScalar(-1).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const right = uniforms.camRight.value.crossVectors(forward, worldUp).normalize();
      uniforms.camUp.value.crossVectors(right, forward).normalize();
    }

    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      uniforms.iResolution.value.set(w * pr, h * pr);
    }

    window.addEventListener('resize', onResize);
    onResize();

    const clock = new THREE.Clock();
    const travelVelocity = new THREE.Vector3(0.55, 0.12, -0.82).normalize().multiplyScalar(5.5);
    let lastT = 0;
    let animationId;

    function animate() {
      animationId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dtFrame = Math.min(t - lastT, 0.1);
      lastT = t;
      uniforms.iTime.value = t;

      uniforms.uTravel.value.addScaledVector(travelVelocity, dtFrame);
      uniforms.uAxisTilt.value = 0.05 * Math.sin(t * 0.35);

      updateCamera();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', onResize);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('wheel', onWheel);

      if (mount && renderer.domElement && mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }

      material.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <style>{globalStyles}</style>
      <div ref={mountRef} className="canvas-container" />
    </>
  );
}

export default App;
