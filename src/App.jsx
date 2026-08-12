import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const EVENT_HORIZON = 6.0;
const BEAM_DIR = Math.PI * 0.95;

const noiseShader = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0);
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

        vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
`;

const GravitationalLensingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMass: { value: 0.1 },
    uAspect: { value: window.innerWidth / window.innerHeight },
  },
  vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uMass;
        uniform float uAspect;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv - 0.5;
            uv.x *= uAspect;

            float dist = length(uv);
            vec2 dirNorm = dist > 0.0001 ? uv / dist : vec2(0.0);
            float distortion = (uMass * uMass) / max(dist, 0.01);
            distortion *= smoothstep(0.01, 0.08, dist);
            vec2 offset = dirNorm * distortion;
            vec2 lensedUv = uv - offset;
            lensedUv.x /= uAspect;
            lensedUv += 0.5;
            vec4 col = texture2D(tDiffuse, lensedUv);
            gl_FragColor = col;
        }
    `,
};

const globalStyles = `
  html, body, #root {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #000000;
    font-family: 'Inter', sans-serif;
  }

  body {
    cursor: grab;
  }

  body:active {
    cursor: grabbing;
  }

  .app-shell,
  .scene-root {
    width: 100%;
    height: 100%;
  }

  .scene-root {
    position: relative;
    overflow: hidden;
  }

  .scene-root canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .loading {
    position: absolute;
    inset: 0;
    background-color: #000;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: #ff8833;
    font-family: monospace;
    font-size: 1.2rem;
    z-index: 100;
    transition: opacity 1.5s ease;
    pointer-events: none;
    letter-spacing: 2px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 2px solid transparent;
    border-top-color: #ff8833;
    border-bottom-color: #ff8833;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

function App() {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current) return;

    let camera;
    let renderer;
    let composer;
    let controls;
    let bgScene;
    let fgScene;
    let clipPlaneBack;
    let clipPlaneFront;
    let lensingPass;
    let animationId;

    const clock = new THREE.Clock();
    const materialsToUpdate = [];

    const init = () => {
      bgScene = new THREE.Scene();
      fgScene = new THREE.Scene();

      camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
      camera.position.set(0, 12, 35);

      clipPlaneBack = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.1);
      clipPlaneFront = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.1);

      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.localClippingEnabled = true;
      mountRef.current.appendChild(renderer.domElement);

      composer = new EffectComposer(renderer);
      const renderBg = new RenderPass(bgScene, camera);
      composer.addPass(renderBg);

      lensingPass = new ShaderPass(GravitationalLensingShader);
      composer.addPass(lensingPass);

      const renderFg = new RenderPass(fgScene, camera);
      renderFg.clear = false;
      renderFg.clearDepth = true;
      composer.addPass(renderFg);

      const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.5, 0.2);
      composer.addPass(bloomPass);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.04;
      controls.maxDistance = 150;
      controls.minDistance = 10;
      controls.enablePan = false;
      controls.target.set(0, 0, 0);
      controls.autoRotate = true;
      controls.autoRotateSpeed = -0.2;

      buildBlackHole();
      buildAccretionDisk();
      buildStars();

      const loadingElement = document.getElementById('loading');
      if (loadingElement) {
        loadingElement.style.opacity = '0';
        setTimeout(() => {
          if (loadingElement) loadingElement.style.display = 'none';
        }, 1500);
      }
    };

    const buildAccretionDisk = () => {
      const diskGeometry = new THREE.RingGeometry(6.45, 33, 128, 64);
      diskGeometry.rotateX(-Math.PI / 2);

      const diskVertexShader = `
        #include <clipping_planes_pars_vertex>
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
            vUv = uv;
            vPos = position;
            #include <begin_vertex>
            #include <project_vertex>
            #include <clipping_planes_vertex>
        }
    `;

      const diskFragmentShader = `
        #include <clipping_planes_pars_fragment>

        uniform float uTime;
        uniform float uBeamDir;
        varying vec2 vUv;
        varying vec3 vPos;

        ${noiseShader}

        void main() {
            #include <clipping_planes_fragment>
            float dist = length(vPos.xz);
            float normalizedDist = (dist - 6.45) / (33.0 - 6.45);
            float angle = atan(vPos.z, vPos.x);
            float speed = 12.0 / (dist * 0.6);
            float rotatingAngle = angle + uTime * speed;

            vec3 noiseCoord = vec3(cos(rotatingAngle) * dist, 0.0, sin(rotatingAngle) * dist);
            float n1 = snoise(noiseCoord * 0.5 - vec3(0, uTime * 0.5, 0));
            float n2 = snoise(noiseCoord * 2.0 + vec3(uTime * 0.2, 0, 0));
            float totalNoise = (n1 * 0.6 + n2 * 0.4) * 0.5 + 0.5;

            float rings = sin(dist * 15.0) * 0.5 + 0.5;
            totalNoise = mix(totalNoise, rings, 0.15);

            float radialFalloff = exp(-3.8 * normalizedDist);
            float innerEdge = smoothstep(0.0, 0.04, normalizedDist);
            float outerTail = smoothstep(1.0, 0.4, normalizedDist);
            float brightness = radialFalloff * innerEdge * outerTail;
            brightness *= (0.3 + 0.7 * totalNoise);

            vec3 colorInner = vec3(1.0, 0.95, 0.8);
            vec3 colorMid = vec3(1.0, 0.35, 0.02);
            vec3 colorOuter = vec3(0.2, 0.02, 0.0);

            vec3 color = mix(colorMid, colorInner, smoothstep(0.25, 0.0, normalizedDist));
            color = mix(colorOuter, color, smoothstep(0.85, 0.1, normalizedDist));

            float beaming = 0.5 + 0.5 * cos(angle - uBeamDir);
            vec3 beamShift = mix(vec3(1.0, 0.6, 0.4), vec3(0.9, 0.95, 1.0), beaming);
            float beamFactor = mix(0.1, 2.5, pow(beaming, 2.0));
            color *= beamFactor * beamShift;

            float finalAlpha = clamp(brightness * 2.0, 0.0, 1.0);
            gl_FragColor = vec4(color * brightness * 2.0, finalAlpha);
        }
    `;

      const diskUniforms = {
        uTime: { value: 0 },
        uBeamDir: { value: BEAM_DIR },
      };

      const matBack = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes: [clipPlaneBack],
        uniforms: diskUniforms,
        vertexShader: diskVertexShader,
        fragmentShader: diskFragmentShader,
      });
      const diskBack = new THREE.Mesh(diskGeometry, matBack);
      diskBack.rotation.z = 0.15;
      diskBack.rotation.x = 0.08;
      bgScene.add(diskBack);
      materialsToUpdate.push(matBack);

      const matFront = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes: [clipPlaneFront],
        uniforms: diskUniforms,
        vertexShader: diskVertexShader,
        fragmentShader: diskFragmentShader,
      });
      const diskFront = new THREE.Mesh(diskGeometry, matFront);
      diskFront.rotation.copy(diskBack.rotation);
      fgScene.add(diskFront);
      materialsToUpdate.push(matFront);
    };

    const buildBlackHole = () => {
      const bhGeometry = new THREE.SphereGeometry(EVENT_HORIZON, 64, 64);
      const bhMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const blackHole = new THREE.Mesh(bhGeometry, bhMaterial);
      fgScene.add(blackHole);

      const photonGeo = new THREE.SphereGeometry(EVENT_HORIZON + 0.08, 64, 64);
      const photonMat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPos.xyz;
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = dot(viewDir, normal);
                fresnel = smoothstep(0.0, 0.15, fresnel) * smoothstep(0.4, 0.15, fresnel);
                gl_FragColor = vec4(vec3(1.0, 0.8, 0.6) * fresnel * 3.0, fresnel);
            }
        `,
      });
      const photonRing = new THREE.Mesh(photonGeo, photonMat);
      fgScene.add(photonRing);
    };

    const buildStars = () => {
      const starsGeo = new THREE.BufferGeometry();
      const count = 15000;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i += 3) {
        const r = 600 + Math.random() * 800;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pos[i] = r * Math.sin(phi) * Math.cos(theta);
        pos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i + 2] = r * Math.cos(phi);
      }
      starsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const starsMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.9,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const stars = new THREE.Points(starsGeo, starsMat);
      bgScene.add(stars);
    };

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      lensingPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    };

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();
      materialsToUpdate.forEach((mat) => {
        if (mat.uniforms && mat.uniforms.uTime) {
          mat.uniforms.uTime.value = elapsedTime;
        }
      });

      const cameraDir = new THREE.Vector3();
      camera.getWorldDirection(cameraDir);
      clipPlaneBack.normal.copy(cameraDir);
      clipPlaneFront.normal.copy(cameraDir).negate();

      const dist = camera.position.length();
      const screenMass = 6.4 / dist;
      lensingPass.uniforms.uMass.value = screenMass;

      controls.update();
      composer.render();
    };

    init();
    animate();
    window.addEventListener('resize', onWindowResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', onWindowResize);
      if (mountRef.current && renderer) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer?.dispose();
      composer?.dispose();
      controls?.dispose();
    };
  }, []);

  return (
    <>
      <style>{globalStyles}</style>
      <div className="app-shell">
        <div id="loading" className="loading">
          <div className="spinner" />
          CALCULANDO MÉTRICA DE SCHWARZSCHILD...
        </div>
        <div ref={mountRef} className="scene-root" />
      </div>
    </>
  );
}

export default App;
