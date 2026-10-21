/* =========================================================================
   app.js —— 渲染 / 昼夜光照 / 交互 / 控制台 UI
   ========================================================================= */
(function () {
  'use strict';
  const T = THREE;
  const V3 = T.Vector3;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const params = new URLSearchParams(location.search);

  /* ============================ 渲染器 ============================ */
  const canvas = document.getElementById('scene');
  const renderer = new T.WebGLRenderer({
    canvas: canvas, antialias: true, powerPreference: 'high-performance',
    preserveDrawingBuffer: true, alpha: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = T.SRGBColorSpace;

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x0a1020, 80, 330);
  const camera = new T.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 2000);
  camera.position.set(37, 45, 37);

  /* ============================ 天空 ============================ */
  const skyUniforms = {
    uZenith: { value: new T.Color(0x2f6fbe) },
    uHorizon: { value: new T.Color(0xe2eef7) },
    uGround: { value: new T.Color(0x6a6355) },
    uSunColor: { value: new T.Color(0xfff2d6) },
    uSunDir: { value: new V3(0, 1, 0) },
    uMoonDir: { value: new V3(0, -1, 0) },
    uNight: { value: 0 },
    uSunGlow: { value: 1 }
  };
  const skyMat = new T.ShaderMaterial({
    uniforms: skyUniforms,
    side: T.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir, uMoonDir;
      uniform float uNight, uSunGlow;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.58));
        col = mix(col, uGround, smoothstep(0.05, -0.12, h));
        // 地平线暖光带
        vec2 dh = normalize(vec2(d.x, d.z) + vec2(1e-5));
        vec2 sh = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-5));
        float az = max(dot(dh, sh), 0.0);
        col += uSunColor * pow(az, 6.0) * 0.10 * uSunGlow * (1.0 - clamp(abs(h), 0.0, 1.0));
        // 太阳
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * pow(s, 1400.0) * 3.2 * uSunGlow;
        col += uSunColor * pow(s, 40.0) * 0.30 * uSunGlow;
        col += uSunColor * pow(s, 6.0) * 0.06 * uSunGlow;
        // 月亮
        float m = max(dot(d, uMoonDir), 0.0);
        float moon = pow(m, 2600.0) * 2.4 + pow(m, 120.0) * 0.10;
        col += vec3(0.78, 0.86, 1.0) * moon * uNight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new T.Mesh(new T.SphereGeometry(900, 48, 32), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // 星空
  const starCount = 2800;
  const starGeo = new T.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random(), v = Math.random() * 0.92 + 0.04;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v);
    const r = 760;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) * 0.98;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3));
  const starMat = new T.PointsMaterial({
    size: 2.5, map: TEX.starTexture(), transparent: true, opacity: 0,
    depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: false,
    color: 0xdfe9ff, fog: false
  });
  const stars = new T.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  /* ============================ 环境贴图 ============================ */
  (function buildEnvironment() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.0, '#7ea6d8');
    g.addColorStop(0.32, '#a9c6e6');
    g.addColorStop(0.48, '#e6dfc9');
    g.addColorStop(0.52, '#5d5344');
    g.addColorStop(0.72, '#2a2824');
    g.addColorStop(1.0, '#141312');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
    // 太阳光斑
    const sg = ctx.createRadialGradient(760, 150, 0, 760, 150, 230);
    sg.addColorStop(0, 'rgba(255,248,225,1)');
    sg.addColorStop(0.12, 'rgba(255,240,206,0.85)');
    sg.addColorStop(0.4, 'rgba(255,226,175,0.25)');
    sg.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, 1024, 512);
    // 地面暗部
    const tg = ctx.createRadialGradient(512, 512, 40, 512, 512, 460);
    tg.addColorStop(0, 'rgba(90,84,70,0.25)');
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg; ctx.fillRect(0, 0, 1024, 512);
    const tex = new T.CanvasTexture(c);
    tex.mapping = T.EquirectangularReflectionMapping;
    tex.colorSpace = T.SRGBColorSpace;
    const pmrem = new T.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(tex);
    scene.environment = rt.texture;
    tex.dispose();
    pmrem.dispose();
  })();

  /* ============================ 展示台 & 地面 ============================ */
  const stageGroup = new T.Group();
  scene.add(stageGroup);
  // 地面
  const floorMat = new T.MeshStandardMaterial({ color: 0x141820, roughness: 0.92, metalness: 0.12 });
  const floor = new T.Mesh(new T.CircleGeometry(700, 100), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.32;
  floor.receiveShadow = true;
  stageGroup.add(floor);
  // 展台
  const stageMat = new T.MeshStandardMaterial({ color: 0x1d222c, roughness: 0.55, metalness: 0.25 });
  const stage = new T.Mesh(new T.CylinderGeometry(27, 27.5, 1.05, 100), stageMat);
  stage.position.y = -2.76;
  stage.receiveShadow = true;
  stage.castShadow = true;
  stageGroup.add(stage);
  const stageTopMat = new T.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.2 });
  const stageTop = new T.Mesh(new T.CircleGeometry(26.98, 100), stageTopMat);
  stageTop.rotation.x = -Math.PI / 2;
  stageTop.position.y = -2.195;
  stageTop.receiveShadow = true;
  stageGroup.add(stageTop);
  // 展台发光环
  const ringMat = new T.MeshBasicMaterial({ color: 0xffc35b, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false });
  const ring = new T.Mesh(new T.TorusGeometry(26.7, 0.05, 8, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -2.2;
  stageGroup.add(ring);
  const ring2Mat = new T.MeshBasicMaterial({ color: 0x63c8ff, transparent: true, opacity: 0.25, blending: T.AdditiveBlending, depthWrite: false });
  const ring2 = new T.Mesh(new T.TorusGeometry(27.1, 0.03, 6, 160), ring2Mat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = -2.42;
  stageGroup.add(ring2);
  // 底座接触阴影
  const aoMat = new T.MeshBasicMaterial({
    map: TEX.radialShadowTexture(), transparent: true, opacity: 0.75,
    depthWrite: false, color: 0x000000
  });
  const ao = new T.Mesh(new T.PlaneGeometry(58, 40), aoMat);
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = -2.18;
  stageGroup.add(ao);

  /* ============================ 灯光 ============================ */
  const hemi = new T.HemisphereLight(0xbcd7ff, 0x6b5b47, 1.1);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff2d6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 380;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  const moon = new T.DirectionalLight(0x9fbcff, 0.0);
  moon.position.set(-60, 90, -80);
  moon.target.position.set(0, 0, 0);
  scene.add(moon);
  scene.add(moon.target);
  // 补光（夜间保持电路板可辨识）
  const fill = new T.DirectionalLight(0xbcd4ff, 0.0);
  fill.position.set(34, 40, 62);
  fill.target.position.set(0, 4, 0);
  scene.add(fill);
  scene.add(fill.target);

  /* ============================ 模型 ============================ */
  const model = DIORAMA.build();
  scene.add(model.root);

  /* ============================ 昼夜参数 ============================ */
  const SKY_STOPS = [
    { a: -30, zen: 0x02040b, hor: 0x060a15, gnd: 0x04060a, sun: 0x6f86b8, sunI: 0.0, hemi: 0.10, night: 1.0, glow: 0.0, env: 0.02 },
    { a: -12, zen: 0x050d22, hor: 0x0c1528, gnd: 0x07080d, sun: 0x7f96c8, sunI: 0.0, hemi: 0.13, night: 1.0, glow: 0.0, env: 0.03 },
    { a: -4, zen: 0x101c40, hor: 0x3a2440, gnd: 0x100c12, sun: 0xff7a3a, sunI: 0.22, hemi: 0.26, night: 0.92, glow: 0.55, env: 0.06 },
    { a: 1, zen: 0x223252, hor: 0xc4592f, gnd: 0x0b0b0f, sun: 0xff7f3c, sunI: 0.75, hemi: 0.42, night: 0.62, glow: 1.0, env: 0.16 },
    { a: 6, zen: 0x2f4a72, hor: 0xe8955c, gnd: 0x101014, sun: 0xffb06a, sunI: 1.7, hemi: 0.72, night: 0.22, glow: 1.0, env: 0.34 },
    { a: 16, zen: 0x38669c, hor: 0xe9c59c, gnd: 0x14151a, sun: 0xffe0b8, sunI: 2.5, hemi: 0.95, night: 0.0, glow: 0.9, env: 0.62 },
    { a: 38, zen: 0x3a76bb, hor: 0xc6d8e6, gnd: 0x181a20, sun: 0xfff2d6, sunI: 2.95, hemi: 1.25, night: 0.0, glow: 0.72, env: 0.85 },
    { a: 78, zen: 0x2f6fbe, hor: 0xd7e6f2, gnd: 0x1b1d22, sun: 0xfffaf0, sunI: 3.2, hemi: 1.4, night: 0.0, glow: 0.62, env: 0.95 }
  ];
  const _c1 = new T.Color(), _c2 = new T.Color();
  function colorLerp(hexA, hexB, t, out) {
    _c1.setHex(hexA); _c2.setHex(hexB);
    out.copy(_c1).lerp(_c2, t);
    return out;
  }
  function skyAt(altDeg) {
    let i = 0;
    while (i < SKY_STOPS.length - 2 && altDeg > SKY_STOPS[i + 1].a) i++;
    const A = SKY_STOPS[i], B = SKY_STOPS[i + 1];
    const t = clamp((altDeg - A.a) / (B.a - A.a), 0, 1);
    const out = {
      zenith: new T.Color().setHex(A.zen).lerp(new T.Color().setHex(B.zen), t),
      horizon: new T.Color().setHex(A.hor).lerp(new T.Color().setHex(B.hor), t),
      ground: new T.Color().setHex(A.gnd).lerp(new T.Color().setHex(B.gnd), t),
      sunColor: new T.Color().setHex(A.sun).lerp(new T.Color().setHex(B.sun), t),
      sunI: lerp(A.sunI, B.sunI, t),
      hemi: lerp(A.hemi, B.hemi, t),
      night: lerp(A.night, B.night, t),
      glow: lerp(A.glow, B.glow, t),
      env: lerp(A.env, B.env, t)
    };
    return out;
  }

  /* ============================ 状态 ============================ */
  const state = {
    time: 16.4,
    playing: false,
    speed: 1.35,            // 小时/秒
    threshold: 80,
    hysteresis: 1.5,
    mode: 'auto',
    manualOn: false,
    lampOn: false,
    lampLevel: 0,
    flickerT: 0,
    lux: 0,
    prevLux: 0,
    altDeg: 0,
    night: 0,
    selected: null,
    labels: false,
    orbit: false,
    sunDir: new V3(0, 1, 0),
    flickerSeed: 0,
    now: 0,
    lastDisplay: 0,
    lastChart: -1,
    lastUI: 0
  };
  const $ = (id) => document.getElementById(id);

  /* ============================ 光照模型 ============================ */
  function altAt(hour) {
    return 72 * Math.sin(Math.PI * (hour - 6) / 12);
  }
  function luxModel(hour) {
    const alt = altAt(hour);
    const sinA = Math.max(0, Math.sin(alt * Math.PI / 180));
    let lux = 110000 * Math.pow(sinA, 1.22);
    lux += 48 * Math.exp(-Math.pow((alt + 1.4) / 7.2, 2));
    lux += 0.45 * clamp(-alt / 22, 0, 1);
    return lux;
  }

  /* ============================ 摄像机控制 ============================ */
  class Orbit {
    constructor(cam, dom) {
      this.cam = cam; this.dom = dom;
      this.target = new V3(2, 16, 2);
      this.goalTarget = this.target.clone();
      this.spherical = { r: 58, theta: 0.785, phi: 0.93 };
      this.goal = { r: 58, theta: 0.785, phi: 0.93 };
      this.minR = 16; this.maxR = 230;
      this.minPhi = 0.1; this.maxPhi = 1.52;
      this.autoRotate = false;
      this.enabled = true;
      this.fov = cam.fov;
      this.goalFov = cam.fov;
      this.dragging = 0;
      this.pointers = new Map();
      this.lastPinch = 0;
      this.bind();
      this.snap();
    }
    syncFromCamera() {
      const off = this.cam.position.clone().sub(this.target);
      const r = off.length();
      this.spherical.r = this.goal.r = r;
      this.spherical.phi = this.goal.phi = Math.acos(clamp(off.y / r, -1, 1));
      this.spherical.theta = this.goal.theta = Math.atan2(off.x, off.z);
    }
    snapFov() {
      this.fov = this.goalFov;
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
    snap() {
      this.spherical.r = this.goal.r;
      this.spherical.theta = this.goal.theta;
      this.spherical.phi = this.goal.phi;
      this.target.copy(this.goalTarget);
      this.apply();
    }
    flyTo(pos, target) {
      this.goalTarget.copy(target);
      const off = pos.clone().sub(target);
      const r = clamp(off.length(), this.minR, this.maxR);
      this.goal.r = r;
      this.goal.phi = clamp(Math.acos(clamp(off.y / off.length(), -1, 1)), this.minPhi, this.maxPhi);
      this.goal.theta = Math.atan2(off.x, off.z);
      // 最短路径
      let d = this.goal.theta - this.spherical.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.goal.theta = this.spherical.theta + d;
    }
    bind() {
      const el = this.dom;
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        el.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.dragging = (e.button === 0) ? 1 : 2;
        if (this.pointers.size === 2) {
          const pts = [...this.pointers.values()];
          this.lastPinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        }
        el.classList.add('grabbing');
      });
      el.addEventListener('pointermove', (e) => {
        if (!this.enabled) return;
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (this.pointers.size === 1) {
          if (this.dragging === 1) {
            this.goal.theta -= dx * 0.005;
            this.goal.phi = clamp(this.goal.phi - dy * 0.0042, this.minPhi, this.maxPhi);
          } else {
            this.pan(dx, dy);
          }
        } else if (this.pointers.size === 2) {
          const pts = [...this.pointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.lastPinch > 0) {
            this.goal.r = clamp(this.goal.r * (this.lastPinch / dist), this.minR, this.maxR);
          }
          this.lastPinch = dist;
        }
      });
      const up = (e) => {
        this.pointers.delete(e.pointerId);
        this.dragging = 0;
        if (this.pointers.size === 0) el.classList.remove('grabbing');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', (e) => { if (e.buttons === 0) up(e); });
      el.addEventListener('wheel', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.goal.r = clamp(this.goal.r * Math.exp(e.deltaY * 0.0011), this.minR, this.maxR);
      }, { passive: false });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    pan(dx, dy) {
      const factor = this.spherical.r * 0.0016;
      const right = new V3().setFromMatrixColumn(this.cam.matrixWorld, 0);
      const up = new V3().setFromMatrixColumn(this.cam.matrixWorld, 1);
      this.goalTarget.addScaledVector(right, -dx * factor);
      this.goalTarget.addScaledVector(up, dy * factor * 0.7);
      this.goalTarget.x = clamp(this.goalTarget.x, -46, 46);
      this.goalTarget.z = clamp(this.goalTarget.z, -34, 34);
      this.goalTarget.y = clamp(this.goalTarget.y, -2, 34);
    }
    update(dt) {
      if (this.autoRotate) this.goal.theta += dt * 0.075;
      const k = 1 - Math.exp(-dt * 7);
      this.spherical.r = lerp(this.spherical.r, this.goal.r, k);
      this.spherical.phi = lerp(this.spherical.phi, this.goal.phi, k);
      let d = this.goal.theta - this.spherical.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.spherical.theta += d * k;
      this.target.lerp(this.goalTarget, k);
      if (Math.abs(this.fov - this.goalFov) > 0.01) {
        this.fov = lerp(this.fov, this.goalFov, k);
        this.cam.fov = this.fov;
        this.cam.updateProjectionMatrix();
      }
      this.apply();
    }
    apply() {
      const s = this.spherical;
      const sinPhi = Math.sin(s.phi);
      this.cam.position.set(
        this.target.x + s.r * sinPhi * Math.sin(s.theta),
        this.target.y + s.r * Math.cos(s.phi),
        this.target.z + s.r * sinPhi * Math.cos(s.theta)
      );
      this.cam.lookAt(this.target);
    }
  }
  const orbit = new Orbit(camera, canvas);
  orbit.to = orbit.goal;
  // 初始视角
  orbit.flyTo(new V3(37, 45, 37), new V3(2, 16, 2));
  orbit.snap();

  /* ============================ 视角预设 ============================ */
  const VIEWS = {
    hero: { pos: [37, 45, 37], target: [2, 16, 2], fov: 38 },
    top: { pos: [0, 200, 24], target: [0, 0, 2], fov: 15 },
    lamp: { pos: [34, 22, 44], target: [4.2, 18, -4], fov: 38 },
    pcb: { pos: [2, 24, 21], target: [-11.5, 3, 2], fov: 38 }
  };
  function setView(name, instant) {
    const v = VIEWS[name];
    if (!v) return;
    orbit.goalFov = v.fov || 38;
    orbit.flyTo(new V3(v.pos[0], v.pos[1], v.pos[2]), new V3(v.target[0], v.target[1], v.target[2]));
    if (instant) { orbit.snapFov(); orbit.snap(); }
    document.querySelectorAll('.views button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  }
  function focusOn(pos) {
    const dir = camera.position.clone().sub(orbit.target).normalize();
    const p = pos.clone().addScaledVector(dir, 25);
    p.y = Math.max(p.y, 9);
    orbit.flyTo(p, pos.clone());
  }

  /* ============================ 部件资料 ============================ */
  const PART_INFO = {
    ldr: {
      title: '光敏电阻 GL5516', tag: '传感层 · 光照采集',
      desc: '利用硫化镉（CdS）光敏电阻的阻值随光照增强而减小的特性，与固定电阻串联分压，将光信号转换为电压信号送入 STM32 的 ADC 通道。',
      specs: [['型号', 'GL5516'], ['接口', 'ADC1 · 12 bit'], ['采样', '200 ms / 次'], ['换算', '多点标定 → lux']],
      role: '系统“眼睛”：实时感知环境光照，是自适应开关灯的输入源。'
    },
    mcu: {
      title: 'STM32F103C8T6 主控', tag: '控制层 · 核心处理',
      desc: 'Cortex-M3 内核，72 MHz 主频。负责 ADC 采样、滑动平均滤波、lux 换算、阈值比较与回差判断，并驱动继电器、刷新 OLED、与 ESP8266 串口通信。',
      specs: [['内核', 'ARM Cortex-M3'], ['主频', '72 MHz'], ['ADC', '12 位 · 多通道'], ['通信', 'USART ×2 · I²C'], ['供电', '3.3 V']],
      role: '系统“大脑”：采集 → 判定 → 执行 → 上报 全部由它调度。'
    },
    relay: {
      title: '继电器驱动模块', tag: '执行层 · 开关控制',
      desc: 'STM32 GPIO 经光耦隔离驱动三极管，控制 5 V 继电器吸合/断开，为 LED 路灯提供大电流通路。带续流二极管与状态指示灯，实现弱电控强电。',
      specs: [['型号', 'SRD-05VDC-SL-C'], ['触点', '10 A / 250 VAC'], ['隔离', '光耦 + 三极管'], ['控制', 'GPIO 高电平吸合']],
      role: '系统“开关”：把控制信号变成路灯的通断动作。'
    },
    esp: {
      title: 'ESP8266 Wi-Fi 模块', tag: '通信层 · 物联网',
      desc: '通过串口与 STM32 交换数据，将光照值、路灯状态、开关日志上报云平台（MQTT / HTTP），同时接收远程控制指令，实现手机端远程监测与控制。',
      specs: [['芯片', 'ESP-12F / ESP8266'], ['无线', '802.11 b/g/n'], ['协议', 'MQTT · HTTP'], ['接口', 'UART 115200']],
      role: '系统“上云通道”：让局域网内的路灯变成可远程管理的物联网节点。'
    },
    oled: {
      title: 'OLED 显示模块', tag: '人机交互 · 本地显示',
      desc: '0.96 寸 I²C OLED 屏，实时显示当前光照强度、开关阈值、路灯状态与工作模式，方便现场调试与演示查看。',
      specs: [['尺寸', '0.96 inch'], ['分辨率', '128 × 64'], ['接口', 'I²C'], ['刷新', '500 ms']],
      role: '系统的“仪表盘”：本地可视化，答辩演示时直观展示数据。'
    },
    sound: {
      title: '声控传感器模块', tag: '扩展层 · 声音采集',
      desc: '驻极体麦克风 + LM393 比较器，检测环境声音强度并输出模拟/数字信号。系统预留该通道，夜间可在光照触发基础上叠加声控/人体感应等增强触发策略。',
      specs: [['传感', '驻极体麦克风'], ['比较器', 'LM393'], ['输出', 'AO / DO'], ['可调', '电位器阈值']],
      role: '系统的“扩展感知”：为后续节能与智能触发提供硬件接口。'
    },
    lamp: {
      title: 'LED 路灯（3D 打印）', tag: '被控对象 · 照明执行',
      desc: '3D 打印白色灯杆 + 灯头，内置 LED 发光面。由继电器控制通断：傍晚光照低于阈值自动点亮，凌晨光照回升后自动熄灭，实现按需照明。',
      specs: [['高度', '约 33 cm（模型）'], ['灯头', 'LED 面光源'], ['控制', '继电器通断'], ['策略', '阈值 + 回差防抖']],
      role: '系统“输出”：用真实的灯光变化呈现自适应控制效果。'
    }
  };

  /* ============================ 热点标注 ============================ */
  const LABEL_OFFSETS = {
    ldr: [16, 22], mcu: [-30, 30], relay: [18, 16], esp: [-16, -30],
    oled: [-46, 34], sound: [-58, 6], lamp: [20, -26]
  };
  const hotspotLayer = $('hotspots');
  const hotspotEls = {};
  for (const hs of model.hotspots) {
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.dataset.id = hs.id;
    el.innerHTML = '<span class="dot"><b>' + hs.num + '</b><i></i></span><span class="lbl">' + hs.name + '</span>';
    const off = LABEL_OFFSETS[hs.id] || [0, 0];
    el.style.setProperty('--lx', off[0] + 'px');
    el.style.setProperty('--ly', off[1] + 'px');
    el.addEventListener('click', (e) => { e.stopPropagation(); selectPart(hs.id, true); });
    hotspotLayer.appendChild(el);
    hotspotEls[hs.id] = el;
  }
  const _proj = new V3();
  function updateHotspots() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const hs of model.hotspots) {
      const el = hotspotEls[hs.id];
      _proj.copy(hs.pos).project(camera);
      const x = (_proj.x * 0.5 + 0.5) * w;
      const y = (-_proj.y * 0.5 + 0.5) * h;
      const visible = _proj.z < 1 && _proj.z > -1;
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      el.classList.toggle('is-hidden', !visible);
    }
  }

  /* ============================ 部件选择 ============================ */
  const legendList = $('legendList');
  for (const hs of model.hotspots) {
    const li = document.createElement('li');
    li.dataset.id = hs.id;
    li.innerHTML = '<span class="num">' + hs.num + '</span><span class="nm">' + hs.name + '</span><span class="sub">' + hs.sub + '</span><span class="go">›</span>';
    li.addEventListener('click', () => selectPart(hs.id, true));
    legendList.appendChild(li);
  }
  const legendView = $('legendView');
  const detailView = $('detailView');
  const selectionSprite = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 124);
    g.addColorStop(0, 'rgba(255,195,91,0)');
    g.addColorStop(0.62, 'rgba(255,195,91,0)');
    g.addColorStop(0.78, 'rgba(255,205,120,0.95)');
    g.addColorStop(0.9, 'rgba(255,195,91,0.2)');
    g.addColorStop(1, 'rgba(255,195,91,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 124, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,170,0.9)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(128, 128, 92, 0, 7); ctx.stroke();
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const mat = new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    const sp = new T.Sprite(mat);
    sp.scale.set(4.4, 4.4, 1);
    scene.add(sp);
    return sp;
  })();

  function selectPart(id, fly) {
    const hs = model.hotspots.find(x => x.id === id);
    if (!hs) return;
    state.selected = id;
    for (const key in hotspotEls) hotspotEls[key].classList.toggle('selected', key === id);
    document.querySelectorAll('#legendList li').forEach(li => li.classList.toggle('active', li.dataset.id === id));
    const info = PART_INFO[id];
    if (info) {
      $('detailNum').textContent = hs.num < 10 ? hs.num : '';
      $('detailTitle').textContent = info.title;
      $('detailTag').textContent = info.tag;
      $('detailDesc').textContent = info.desc;
      $('detailRole').textContent = info.role;
      const sp = $('detailSpecs');
      sp.innerHTML = info.specs.map(s => '<div class="spec"><span>' + s[0] + '</span><b>' + s[1] + '</b></div>').join('');
      legendView.classList.add('gone');
      detailView.classList.add('on');
      selectionSprite.position.copy(hs.pos);
      selectionSprite.material.opacity = 1;
    }
    if (fly) focusOn(hs.pos);
  }
  function clearSelection() {
    state.selected = null;
    for (const key in hotspotEls) hotspotEls[key].classList.remove('selected');
    document.querySelectorAll('#legendList li').forEach(li => li.classList.remove('active'));
    legendView.classList.remove('gone');
    detailView.classList.remove('on');
    selectionSprite.material.opacity = 0;
  }
  $('detailClose').addEventListener('click', clearSelection);
  $('detailBack').addEventListener('click', () => { clearSelection(); setView('hero'); });

  /* ============================ 控制台 UI ============================ */
  const timeSlider = $('timeSlider');
  const thSlider = $('thSlider');
  const playBtn = $('playBtn');
  const luxVal = $('luxVal');
  const luxBar = $('luxBar');
  const timeVal = $('timeVal');
  const thVal = $('thVal');
  const lampBadge = $('lampBadge');
  const modeAuto = $('modeAuto');
  const modeManual = $('modeManual');
  const manualSwitch = $('manualSwitch');
  const trend = $('luxTrend');
  const flowEls = [...document.querySelectorAll('#flow .step')];

  function setPlaying(p) {
    state.playing = p;
    playBtn.classList.toggle('active', p);
    playBtn.innerHTML = p ? '<span class="ic">❚❚</span>暂停演示' : '<span class="ic">▶</span>自动演示';
  }
  playBtn.addEventListener('click', () => {
    if (!state.playing && state.mode === 'manual') setMode('auto');
    setPlaying(!state.playing);
    if (state.playing && (state.time < 6.2 || state.time > 19.4)) state.time = Math.min(state.time, 16.2);
  });
  timeSlider.addEventListener('input', () => {
    state.time = parseFloat(timeSlider.value);
    setPlaying(false);
  });
  document.querySelectorAll('.chips button').forEach(b => {
    b.addEventListener('click', () => {
      state.time = parseFloat(b.dataset.time);
      setPlaying(false);
      updateAll();
    });
  });
  thSlider.addEventListener('input', () => {
    state.threshold = parseFloat(thSlider.value);
    thVal.textContent = state.threshold;
    state.lastChart = -1;
    updateAll();
  });
  function setMode(m) {
    state.mode = m;
    modeAuto.classList.toggle('active', m === 'auto');
    modeManual.classList.toggle('active', m === 'manual');
    manualSwitch.disabled = (m === 'auto');
    manualSwitch.parentElement.classList.toggle('disabled', m === 'auto');
    if (m === 'manual') state.manualOn = state.lampOn;
    updateAll();
  }
  modeAuto.addEventListener('click', () => setMode('auto'));
  modeManual.addEventListener('click', () => setMode('manual'));
  manualSwitch.addEventListener('change', () => {
    state.manualOn = manualSwitch.checked;
    updateAll();
  });
  document.querySelectorAll('.views button').forEach(b => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });
  $('labelsBtn').addEventListener('click', () => {
    state.labels = !state.labels;
    $('labelsBtn').classList.toggle('active', state.labels);
    document.body.classList.toggle('show-labels', state.labels);
  });
  $('orbitBtn').addEventListener('click', () => {
    state.orbit = !state.orbit;
    orbit.autoRotate = state.orbit;
    $('orbitBtn').classList.toggle('active', state.orbit);
  });
  $('shotBtn').addEventListener('click', takeScreenshot);
  $('hideUiBtn') && $('hideUiBtn').addEventListener('click', () => document.body.classList.toggle('ui-hidden'));

  // 键盘
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
    if (e.key === 'r' || e.key === 'R') { clearSelection(); setView('hero'); }
    if (e.key === '1') setView('hero');
    if (e.key === '2') setView('top');
    if (e.key === '3') setView('lamp');
    if (e.key === '4') setView('pcb');
    if (e.key === 's' || e.key === 'S') takeScreenshot();
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    if (e.key === 'ArrowRight') { state.time = (state.time + 0.2) % 24; setPlaying(false); }
    if (e.key === 'ArrowLeft') { state.time = (state.time + 23.8) % 24; setPlaying(false); }
  });

  /* ============================ 截图 ============================ */
  function takeScreenshot() {
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.min(2.4, window.devicePixelRatio > 1 ? 2.4 : 2.4));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.download = '智能路灯3D模型_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png';
    a.href = url;
    a.click();
    const btn = $('shotBtn');
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 500);
  }

  /* ============================ 曲线图 ============================ */
  const chart = $('chart');
  const cctx = chart.getContext('2d');
  function drawChart() {
    const w = chart.clientWidth, h = chart.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (chart.width !== Math.round(w * dpr) || chart.height !== Math.round(h * dpr)) {
      chart.width = Math.round(w * dpr); chart.height = Math.round(h * dpr);
    }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, w, h);
    const padL = 4, padR = 4, padT = 6, padB = 14;
    const W = w - padL - padR, H = h - padT - padB;
    const xOf = (hour) => padL + (hour / 24) * W;
    const maxLog = Math.log10(1 + 110000);
    const yOf = (lux) => padT + H - (Math.log10(1 + Math.max(0, lux)) / maxLog) * H;
    // 背景
    cctx.fillStyle = 'rgba(10,16,26,0.55)';
    cctx.fillRect(0, 0, w, h);
    // 开灯时段底色
    for (let i = 0; i < 96; i++) {
      const h0 = (i / 96) * 24, h1 = ((i + 1) / 96) * 24;
      const l = luxModel((h0 + h1) / 2);
      const on = l < state.threshold;
      if (on) {
        cctx.fillStyle = 'rgba(255,195,91,0.10)';
        cctx.fillRect(xOf(h0), padT, xOf(h1) - xOf(h0) + 0.5, H);
      }
    }
    // 网格
    cctx.strokeStyle = 'rgba(140,170,210,0.10)';
    cctx.lineWidth = 1;
    for (const hh of [0, 6, 12, 18, 24]) {
      cctx.beginPath(); cctx.moveTo(xOf(hh), padT); cctx.lineTo(xOf(hh), padT + H); cctx.stroke();
    }
    // 曲线
    cctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const hh = (i / 240) * 24;
      const x = xOf(hh), y = yOf(luxModel(hh));
      i ? cctx.lineTo(x, y) : cctx.moveTo(x, y);
    }
    const grad = cctx.createLinearGradient(0, padT, 0, padT + H);
    grad.addColorStop(0, 'rgba(90,209,255,0.85)');
    grad.addColorStop(1, 'rgba(90,209,255,0.18)');
    cctx.strokeStyle = grad;
    cctx.lineWidth = 1.7;
    cctx.stroke();
    cctx.lineTo(xOf(24), padT + H); cctx.lineTo(xOf(0), padT + H); cctx.closePath();
    const fill = cctx.createLinearGradient(0, padT, 0, padT + H);
    fill.addColorStop(0, 'rgba(90,209,255,0.16)');
    fill.addColorStop(1, 'rgba(90,209,255,0.01)');
    cctx.fillStyle = fill; cctx.fill();
    // 阈值线
    const yOn = yOf(state.threshold), yOff = yOf(state.threshold * state.hysteresis);
    cctx.setLineDash([4, 3]);
    cctx.strokeStyle = 'rgba(255,195,91,0.55)';
    cctx.beginPath(); cctx.moveTo(padL, yOn); cctx.lineTo(w - padR, yOn); cctx.stroke();
    cctx.strokeStyle = 'rgba(255,195,91,0.22)';
    cctx.beginPath(); cctx.moveTo(padL, yOff); cctx.lineTo(w - padR, yOff); cctx.stroke();
    cctx.setLineDash([]);
    // 当前时间
    const cx = xOf(state.time % 24);
    cctx.strokeStyle = 'rgba(255,255,255,0.55)';
    cctx.lineWidth = 1;
    cctx.beginPath(); cctx.moveTo(cx, padT); cctx.lineTo(cx, padT + H + 4); cctx.stroke();
    const cy = yOf(state.lux);
    cctx.fillStyle = '#ffd27a';
    cctx.beginPath(); cctx.arc(cx, cy, 2.6, 0, 7); cctx.fill();
    cctx.fillStyle = 'rgba(255,210,122,0.25)';
    cctx.beginPath(); cctx.arc(cx, cy, 6, 0, 7); cctx.fill();
    // 时刻标签
    cctx.fillStyle = 'rgba(150,175,200,0.65)';
    cctx.font = '9px "SF Mono", ui-monospace, monospace';
    cctx.textAlign = 'center';
    cctx.fillText('0', xOf(0), h - 3);
    cctx.fillText('6', xOf(6), h - 3);
    cctx.fillText('12', xOf(12), h - 3);
    cctx.fillText('18', xOf(18), h - 3);
    cctx.fillText('24', xOf(24), h - 3);
    cctx.textAlign = 'left';
  }

  /* ============================ 数值更新 ============================ */
  let chartDirty = true;
  function fmtLux(v) {
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    if (v >= 10) return v.toFixed(0);
    return v.toFixed(1);
  }
  function updateConsole() {
    // 时间
    const hh = Math.floor(state.time) % 24, mm = Math.floor((state.time % 1) * 60);
    timeVal.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    if (!state.playing) timeSlider.value = state.time;
    // 光照
    const lux = state.lux;
    luxVal.textContent = fmtLux(lux);
    const pct = clamp(Math.log10(1 + lux) / Math.log10(1 + 110000), 0, 1);
    luxBar.style.width = (pct * 100).toFixed(1) + '%';
    if (lux > state.prevLux * 1.006) { trend.textContent = '↑ 上升'; trend.className = 'trend up'; }
    else if (lux < state.prevLux * 0.994) { trend.textContent = '↓ 下降'; trend.className = 'trend down'; }
    else { trend.textContent = '→ 平稳'; trend.className = 'trend'; }
    state.prevLux = lux;
    // 路灯
    const on = state.lampOn;
    lampBadge.className = 'badge ' + (on ? 'on' : 'off');
    lampBadge.querySelector('span').textContent = on ? '路灯已点亮' : '路灯已熄灭';
    manualSwitch.checked = on;
    document.body.classList.toggle('lamp-on', on);
    // 数据流
    flowEls.forEach((el, i) => {
      el.classList.remove('active', 'pulse', 'dim');
      if (i === 0) { el.classList.add('active', 'pulse'); }
      if (i === 1) { el.classList.add('active'); }
      if (i === 2) { el.classList.add(state.mode === 'auto' ? 'active' : 'dim'); if (state.mode === 'auto') el.classList.add('pulse'); }
      if (i === 3) { el.classList.add(on ? 'active' : 'dim'); }
      if (i === 4) { el.classList.add('active', 'pulse'); }
    });
    // 曲线
    if (chartDirty) { drawChart(); chartDirty = false; }
  }

  /* ============================ 主循环 ============================ */
  const clock = new T.Clock();
  let firstFrame = true;
  function updateEnvironment(dt) {
    const altDeg = altAt(state.time);
    const altRad = altDeg * Math.PI / 180;
    const az = Math.PI / 4 + ((state.time - 6) / 12) * (Math.PI / 2);
    state.altDeg = altDeg;
    const dir = state.sunDir.set(
      Math.cos(altRad) * Math.cos(az),
      Math.sin(altRad),
      Math.cos(altRad) * Math.sin(az)
    ).normalize();
    const sky = skyAt(altDeg);
    state.night = sky.night;
    // 光照
    sun.position.copy(dir).multiplyScalar(150);
    sun.color.copy(sky.sunColor);
    sun.intensity = sky.sunI * 1.12;
    sun.castShadow = sky.sunI > 0.05;
    hemi.color.copy(sky.zenith);
    hemi.groundColor.copy(sky.ground);
    hemi.intensity = sky.hemi * 1.05 + sky.night * 0.06;
    const moonDir = dir.clone().negate();
    moon.position.copy(moonDir).multiplyScalar(150);
    moon.intensity = 0.5 * sky.night;
    fill.intensity = 0.5 * (1 - state.night) + 0.22 * state.night;
    // 环境
    skyUniforms.uZenith.value.copy(sky.zenith);
    skyUniforms.uHorizon.value.copy(sky.horizon);
    skyUniforms.uGround.value.copy(sky.ground);
    skyUniforms.uSunColor.value.copy(sky.sunColor);
    skyUniforms.uSunDir.value.copy(dir);
    skyUniforms.uMoonDir.value.copy(moonDir);
    skyUniforms.uNight.value = sky.night;
    skyUniforms.uSunGlow.value = sky.glow * smoothstep(-8, 2, altDeg);
    starMat.opacity = clamp((sky.night - 0.35) * 1.9, 0, 1) * 0.95;
    // 雾 & 舞台
    scene.fog.color.copy(sky.horizon).multiplyScalar(0.72);
    ringMat.opacity = 0.2 + sky.night * 0.55;
    ring2Mat.opacity = 0.12 + sky.night * 0.22;
    DIORAMA.setEnvIntensity(sky.env);
    ringMat.color.setHSL(0.09, 0.9, 0.58);
    // 屏幕 / 车辆 / 指示灯
    if (model.screens.oledMat) model.screens.oledMat.emissiveIntensity = 0.55 + sky.night * 0.75;
    for (const sp of (model.carGlows || [])) {
      sp.material.opacity = sky.night * 0.85;
    }
    model.materials.headlight.emissiveIntensity = 0.25 + sky.night * 1.3;
    model.materials.taillight.emissiveIntensity = 0.25 + sky.night * 1.1;
    renderer.toneMappingExposure = 1.06 + 0.05 * (1 - sky.night);
  }

  function updateLampLogic(dt) {
    // 光照（带轻微波动）
    const base = luxModel(state.time);
    const flick = 1 + 0.02 * Math.sin(state.now * 0.83) + 0.012 * Math.sin(state.now * 2.31 + 1.7);
    state.lux = base * flick;
    // 判定
    if (state.mode === 'auto') {
      if (!state.lampOn && state.lux < state.threshold) {
        state.lampOn = true; state.flickerT = 0.55; chartDirty = true;
      } else if (state.lampOn && state.lux > state.threshold * state.hysteresis) {
        state.lampOn = false; chartDirty = true;
      }
    } else {
      state.lampOn = state.manualOn;
    }
    // 亮度平滑 + 点亮闪烁
    let target = state.lampOn ? 1 : 0;
    if (state.flickerT > 0) {
      state.flickerT -= dt;
      const k = clamp(state.flickerT / 0.55, 0, 1);
      const f = 0.45 + 0.55 * Math.abs(Math.sin(state.now * 46.0)) * (1 - k * 0.35);
      target *= f;
    }
    const speed = state.lampOn ? 11 : 16;
    state.lampLevel += (target - state.lampLevel) * (1 - Math.exp(-dt * speed));
    const lv = clamp(state.lampLevel, 0, 1.1);
    const L = model.lamp;
    if (L.ledMat) L.ledMat.emissiveIntensity = lv * 4.2;
    if (L.glowMat) L.glowMat.opacity = lv * 0.95;
    if (L.glow2Mat) L.glow2Mat.opacity = lv * 0.35;
    if (L.coneMat) L.coneMat.opacity = lv * 0.085;
    if (L.spot) L.spot.intensity = lv * 330;
    if (L.point) L.point.intensity = lv * 42;
  }

  function updateScreens(dt) {
    if (state.now - state.lastDisplay < 0.18) return;
    state.lastDisplay = state.now;
    const scr = model.screens.oled;
    if (!scr) return;
    TEX.drawDisplay(scr.dc, {
      lux: state.lux, threshold: state.threshold, lampOn: state.lampOn,
      mode: state.mode, isNight: state.night > 0.5
    });
    scr.tex.needsUpdate = true;
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    state.now += dt;
    if (state.playing) {
      state.time = (state.time + dt * state.speed) % 24;
      chartDirty = true;
    }
    updateEnvironment(dt);
    updateLampLogic(dt);
    updateScreens(dt);
    orbit.update(dt);
    // 雾随观察距离自适应（保证俯视远景不发灰）
    const camDist = camera.position.distanceTo(orbit.target);
    scene.fog.near = clamp(camDist * 0.92, 45, 260);
    scene.fog.far = clamp(camDist * 3.3 + 110, 240, 1200);
    updateHotspots();
    // 选中提示
    if (state.selected) {
      const hs = model.hotspots.find(h => h.id === state.selected);
      if (hs) {
        const s = 4.4 + Math.sin(state.now * 3.4) * 0.6;
        selectionSprite.scale.set(s, s, 1);
        selectionSprite.material.opacity = 0.42 + 0.3 * Math.sin(state.now * 3.4);
      }
    }
    if (state.now - state.lastUI > 0.1) {
      state.lastUI = state.now;
      updateConsole();
    }
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      document.body.classList.add('ready');
      window.__ready = true;
      setTimeout(() => { const l = document.getElementById('loading'); l && l.classList.add('done'); }, 120);
    }
  }

  /* ============================ URL 参数 ============================ */
  function applyParams() {
    if (params.has('t')) state.time = clamp(parseFloat(params.get('t')), 0, 23.99);
    if (params.has('th')) { state.threshold = clamp(parseFloat(params.get('th')), 10, 400); thSlider.value = state.threshold; }
    if (params.get('mode') === 'manual') state.mode = 'manual';
    if (params.get('lamp') === 'on') { state.mode = 'manual'; state.manualOn = true; }
    if (params.get('lamp') === 'off') { state.mode = 'manual'; state.manualOn = false; }
    if (params.get('play') === '1') state.playing = true;
    if (params.get('ui') === '0') document.body.classList.add('ui-hidden');
    if (params.get('labels') === '1') { state.labels = true; $('labelsBtn').classList.add('active'); document.body.classList.add('show-labels'); }
    if (params.get('orbit') === '1') { state.orbit = true; orbit.autoRotate = true; $('orbitBtn').classList.add('active'); }
    if (params.has('view')) { setView(params.get('view'), true); }
    if (params.has('fov')) { const fv = clamp(parseFloat(params.get('fov')), 12, 80); camera.fov = fv; orbit.fov = fv; orbit.goalFov = fv; camera.updateProjectionMatrix(); }
    if (params.has('cam')) {
      const p = params.get('cam').split(',').map(Number);
      const tg = params.has('tgt') ? params.get('tgt').split(',').map(Number) : [0, 10, 0];
      if (p.length === 3) orbit.flyTo(new V3(p[0], p[1], p[2]), new V3(tg[0], tg[1], tg[2]));
    }
    if (params.has('sel')) { selectPart(params.get('sel'), false); }
    if (params.has('ui') && params.get('ui') === '0') document.body.classList.add('ui-hidden');
    // 同步 UI
    timeSlider.value = state.time;
    thVal.textContent = state.threshold;
    setPlaying(state.playing);
    setMode(state.mode === 'manual' ? 'manual' : 'auto');
    if (state.mode === 'manual') { manualSwitch.checked = state.manualOn; }
    updateAll();
  }

  function updateAll() {
    updateEnvironment(0);
    updateLampLogic(0);
    updateConsole();
    drawChart();
  }

  /* ============================ 尺寸变化 ============================ */
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    chartDirty = true;
  });

  /* ============================ 启动 ============================ */
  applyParams();
  // 首帧使用瞬时状态
  updateEnvironment(0);
  updateLampLogic(0.016);
  updateConsole();
  drawChart();
  orbit.update(0.016);
  window.__demo = {
    state, model, camera, orbit, setView, selectPart, clearSelection, setMode,
    setTime: (t) => { state.time = t; setPlaying(false); updateAll(); },
    setPlaying: (p) => setPlaying(p),
    takeScreenshot
  };
  requestAnimationFrame(animate);
})();
