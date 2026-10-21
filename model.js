/* =========================================================================
   model.js —— 3D 场景建模
   场景：木质底座 + 控制板平台 + 街道缩微场景 + 3D 打印路灯
   世界坐标：y 向上，底座上表面 y = 0，单位 = 1cm
   ========================================================================= */
window.DIORAMA = (function () {
  'use strict';
  const L = TEX.LAYOUT;
  const M = {};                 // 材质缓存
  const pbrMats = [];           // 需要随昼夜调整环境光强度的材质
  const info = { hotspots: [], lamp: {}, screens: {}, flags: {} };

  /* ------------------------------ 基础工具 ------------------------------ */
  function pbr(params) {
    const m = new THREE.MeshStandardMaterial(params);
    pbrMats.push(m);
    return m;
  }
  function phys(params) {
    const m = new THREE.MeshPhysicalMaterial(params);
    pbrMats.push(m);
    return m;
  }
  function mesh(geo, mat, cast, receive) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast !== false;
    m.receiveShadow = receive !== false;
    return m;
  }
  function group(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }
  function boxGeo(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function cylGeo(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg || 20); }
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2 - 0.01, h / 2 - 0.01);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // 水平圆角板：footprint w(X) × d(Z)，厚 h，圆角 r，带倒角，中心在原点
  function slabGeo(w, d, h, r, bevel) {
    bevel = bevel === undefined ? Math.min(0.08, h * 0.3) : bevel;
    const shape = roundedRectShape(w, d, r || 0.2);
    const depth = Math.max(0.02, h - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel,
      bevelSize: bevel, bevelSegments: 2, curveSegments: 10
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -(depth) / 2, 0);
    g.computeVertexNormals();
    return g;
  }
  function mergeGeoms(list) {
    const attrs = {};
    const push = (name, array, itemSize) => {
      if (!attrs[name]) attrs[name] = { arr: [], itemSize: itemSize };
      attrs[name].arr.push(array);
    };
    for (let g of list) {
      if (g.index) g = g.toNonIndexed();
      for (const name of ['position', 'normal', 'uv']) {
        const a = g.attributes[name];
        if (a) {
          const size = a.itemSize;
          const src = a.array;
          push(name, src, size);
        }
      }
      if (!g.attributes.uv) {
        // 补齐 uv 以保持属性一致
        const n = g.attributes.position.count;
        const uv = new Float32Array(n * 2);
        push('uv', uv, 2);
      }
    }
    const out = new THREE.BufferGeometry();
    for (const name in attrs) {
      const { arr, itemSize } = attrs[name];
      let total = 0; arr.forEach(a => total += a.length);
      const f = new Float32Array(total);
      let off = 0;
      for (const a of arr) { f.set(a, off); off += a.length; }
      out.setAttribute(name, new THREE.BufferAttribute(f, itemSize));
    }
    return out;
  }
  function wire(points, radius, color, opts) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, opts && opts.seg || 48, radius, opts && opts.rad || 8, false);
    const mat = pbr({
      color: color, roughness: 0.55, metalness: 0.05,
      emissive: new THREE.Color(color).multiplyScalar(0.05)
    });
    return mesh(g, mat, true, true);
  }
  function texMat(tex, extra) {
    const p = Object.assign({ map: tex, roughness: 0.62, metalness: 0.08 }, extra || {});
    return pbr(p);
  }

  /* ------------------------------ 材质库 ------------------------------ */
  function initMaterials() {
    M.wood = pbr({ map: TEX.woodTexture(), color: 0xffffff, roughness: 0.72, metalness: 0.05 });
    M.woodDark = pbr({ map: TEX.woodTexture(), color: 0xc9b09a, roughness: 0.62, metalness: 0.05 });
    M.darkInset = pbr({ color: 0x3b342a, roughness: 0.8, metalness: 0.1 });
    M.road = pbr({ map: null, roughness: 0.92, metalness: 0.02 }); // 贴图稍后赋值
    M.sidewalk = pbr({ map: null, roughness: 0.9, metalness: 0.02 });
    M.curb = pbr({ color: 0xb9b4a6, roughness: 0.8, metalness: 0.03 });
    M.gold = pbr({ color: 0xd8b45c, roughness: 0.28, metalness: 0.95 });
    M.brass = pbr({ color: 0xb98f4e, roughness: 0.32, metalness: 0.9 });
    M.silver = pbr({ color: 0xc8ccce, roughness: 0.25, metalness: 0.92 });
    M.chrome = pbr({ color: 0xe8ecef, roughness: 0.12, metalness: 0.95 });
    M.blackPlastic = pbr({ color: 0x181a1c, roughness: 0.55, metalness: 0.1 });
    M.blackMatte = pbr({ color: 0x0e0f11, roughness: 0.85, metalness: 0.02 });
    M.bluePlastic = pbr({ color: 0x1c5fb0, roughness: 0.4, metalness: 0.05 });
    M.darkBlue = pbr({ color: 0x143f7e, roughness: 0.45, metalness: 0.1 });
    M.whitePLA = pbr({ color: 0xf1efe6, roughness: 0.55, metalness: 0.02 });
    M.offWhite = pbr({ color: 0xe8e4d8, roughness: 0.6, metalness: 0.02 });
    M.pcbSide = pbr({ color: 0x0a6b36, roughness: 0.5, metalness: 0.15 });
    M.moduleSide = pbr({ color: 0x123a73, roughness: 0.45, metalness: 0.15 });
    M.chipBlack = pbr({ color: 0x131417, roughness: 0.62, metalness: 0.15 });
    M.treeBark = pbr({ color: 0x3f2d1e, roughness: 0.9, metalness: 0.0 });
    M.dirt = pbr({ color: 0x2a2016, roughness: 0.95 });
    M.fence = pbr({ color: 0x3a3733, roughness: 0.7, metalness: 0.55 });
    M.meshMetal = pbr({ color: 0x24241f, roughness: 0.6, metalness: 0.7 });
    M.glass = phys({
      color: 0x0a1018, roughness: 0.1, metalness: 0.2, clearcoat: 1,
      clearcoatRoughness: 0.08, envMapIntensity: 0.8
    });
    M.windowGlass = phys({
      color: 0x0a1018, roughness: 0.08, metalness: 0.25, clearcoat: 1,
      clearcoatRoughness: 0.05, envMapIntensity: 1.1
    });
    M.tire = pbr({ color: 0x141416, roughness: 0.85, metalness: 0.02 });
    M.rim = pbr({ color: 0xb9bdc0, roughness: 0.3, metalness: 0.9 });
    M.ledWarm = pbr({
      color: 0xfff4d9, emissive: new THREE.Color(0xffe6b0), emissiveIntensity: 0.0,
      roughness: 0.35, metalness: 0.0
    });
    M.screen = pbr({
      map: null, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.7,
      roughness: 0.22, metalness: 0.05
    });
    M.whiteGlow = pbr({ color: 0xfff6e4, emissive: new THREE.Color(0xffe9c0), emissiveIntensity: 0.0, roughness: 0.3 });
    M.headlight = pbr({ color: 0xfff8e8, emissive: new THREE.Color(0xffeec8), emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.2 });
    M.taillight = pbr({ color: 0xd8281c, emissive: new THREE.Color(0xff3b20), emissiveIntensity: 0.25, roughness: 0.25, metalness: 0.1 });
    M.carPaintWhite = phys({
      color: 0xf2f1ee, roughness: 0.26, metalness: 0.25, clearcoat: 1,
      clearcoatRoughness: 0.05, envMapIntensity: 1.0
    });
    M.carPaintRed = phys({
      color: 0xc01c16, roughness: 0.24, metalness: 0.22, clearcoat: 1,
      clearcoatRoughness: 0.05, envMapIntensity: 1.0
    });
    M.tempGlow = null;
  }

  /* ------------------------------ 底座 ------------------------------ */
  function buildBase(root) {
    const g = group(root, 0, 0, 0);
    // 主板：上表面 y = 0
    const base = mesh(boxGeo(44, 2.2, 28), M.wood);
    base.position.set(0, -1.1, 0);
    g.add(base);
    // 顶部边框
    const rimH = 0.14, rimW = 0.7;
    const rimMat = M.woodDark;
    const mkRim = (w, d, x, z) => {
      const m = mesh(boxGeo(w, rimH, d), rimMat);
      m.position.set(x, rimH / 2 - 0.01, z);
      g.add(m);
    };
    mkRim(44, rimW, 0, 13.65);
    mkRim(44, rimW, 0, -13.65);
    mkRim(rimW, 26.6, 21.65, 0);
    mkRim(rimW, 26.6, -21.65, 0);
    // 展示铭牌（底座正面）
    const plaqueTex = (function () {
      const [c, ctx] = [document.createElement('canvas'), null];
      c.width = 1024; c.height = 96;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 96);
      g.addColorStop(0, '#c9b58f'); g.addColorStop(0.45, '#a68d64'); g.addColorStop(0.55, '#8d744f'); g.addColorStop(1, '#6b5738');
      x.fillStyle = g; x.fillRect(0, 0, 1024, 96);
      for (let i = 0; i < 260; i++) {
        x.strokeStyle = 'rgba(255,245,220,' + (0.02 + Math.random() * 0.05) + ')';
        x.lineWidth = 0.6;
        const y = Math.random() * 96;
        x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke();
      }
      x.strokeStyle = 'rgba(60,45,25,0.55)'; x.lineWidth = 3;
      x.strokeRect(6, 6, 1012, 84);
      x.fillStyle = 'rgba(46,34,18,0.9)';
      x.font = '600 40px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('基于 STM32 的智能路灯控制系统 · 数字孪生缩微模型', 512, 52);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    })();
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.4),
      pbr({ map: plaqueTex, roughness: 0.35, metalness: 0.75 }));
    plaque.position.set(0, -1.1, 14.03);
    g.add(plaque);
    // 底座侧边装饰线（层板效果）
    const lineMat = pbr({ color: 0x120d09, roughness: 0.8 });
    const line = mesh(boxGeo(44.06, 0.12, 28.06), lineMat);
    line.position.set(0, -1.62, 0);
    g.add(line);
    return g;
  }

  /* ------------------------------ 控制板平台 ------------------------------ */
  function buildPlatform(root) {
    const g = group(root, 0, 0, 0);
    // 深色内嵌平台
    const inset = mesh(boxGeo(19.3, 0.06, 26.4), M.darkInset);
    inset.position.set(-11.65, 0.03, 0);
    inset.castShadow = false;
    g.add(inset);
    // 金属网格
    const meshTex = TEX.meshTexture(26, 36);
    meshTex.repeat.set(1, 1);
    const mMat = new THREE.MeshStandardMaterial({
      map: meshTex, transparent: true, alphaTest: 0.35, roughness: 0.42,
      metalness: 0.65, color: 0xf0e8d6, side: THREE.DoubleSide
    });
    pbrMats.push(mMat);
    const mGeo = new THREE.PlaneGeometry(19.0, 26.2);
    const m = new THREE.Mesh(mGeo, mMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(-11.65, 0.075, 0);
    m.receiveShadow = true;
    g.add(m);
    // 平台边框
    const frameMat = pbr({ color: 0x2a2621, roughness: 0.5, metalness: 0.5 });
    const f1 = mesh(boxGeo(19.3, 0.12, 0.16), frameMat);
    f1.position.set(-11.65, 0.06, 13.18);
    g.add(f1);
    const f2 = f1.clone(); f2.position.z = -13.18; g.add(f2);
    const f3 = mesh(boxGeo(0.16, 0.12, 26.5), frameMat);
    f3.position.set(-21.32, 0.06, 0);
    g.add(f3);
    // 若干固定螺丝
    for (const p of [[-21.0, 12.9], [-2.3, 12.9], [-21.0, -12.9]]) {
      const s = mesh(cylGeo(0.18, 0.18, 0.1, 12), M.silver);
      s.position.set(p[0], 0.12, p[1]);
      g.add(s);
    }
    return g;
  }

  /* ------------------------------ 路面场景 ------------------------------ */
  function buildStreet(root) {
    const g = group(root, 0, 0, 0);
    const ROAD = { x0: -2.0, x1: 21.3, z0: -6.6, z1: 6.6 };
    // 路面
    const rt = TEX.roadTexture({
      x0: ROAD.x0, x1: ROAD.x1, z0: ROAD.z0, z1: ROAD.z1,
      crosswalk: { x0: -1.75, x1: 3.35, bars: 13, bar: 0.26, gap: 0.175 }
    }).tex;
    const roadMat = pbr({ map: rt, roughness: 0.9, metalness: 0.03 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.x1 - ROAD.x0, ROAD.z1 - ROAD.z0), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set((ROAD.x0 + ROAD.x1) / 2, 0.012, (ROAD.z0 + ROAD.z1) / 2);
    road.receiveShadow = true;
    g.add(road);

    // 人行道
    const walkW = 6.7;
    const walkH = 0.36;
    const swTex = TEX.sidewalkTexture(23.3, walkW);
    const swMat = pbr({ map: swTex, roughness: 0.85, metalness: 0.02 });
    for (const side of [1, -1]) {
      const zc = side * (ROAD.z1 + walkW / 2);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(23.3, walkW), swMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set(9.65, walkH, zc);
      top.receiveShadow = true;
      g.add(top);
      // 侧壁（路缘石）
      const wallMat = pbr({ color: 0xb3ada0, roughness: 0.8, metalness: 0.02 });
      const wall = mesh(boxGeo(23.3, walkH, 0.16), wallMat);
      wall.position.set(9.65, walkH / 2, side * ROAD.z1 + side * 0.08);
      g.add(wall);
      // 靠外一侧的边
      const outer = mesh(boxGeo(23.3, walkH, 0.2), wallMat);
      outer.position.set(9.65, walkH / 2, side * 13.2);
      g.add(outer);
      // 人行道砖下的基座
      const slab = mesh(boxGeo(23.3, walkH - 0.05, walkW), pbr({ color: 0x5e5647, roughness: 0.9 }));
      slab.position.set(9.65, (walkH - 0.05) / 2, zc);
      slab.castShadow = false;
      g.add(slab);
    }
    // 围栏（后侧人行道外沿）
    buildFence(g, -1.7, 21.0, -12.95);
    return g;
  }

  function buildFence(parent, x0, x1, z) {
    const g = group(parent, 0, 0, 0);
    const len = x1 - x0;
    const baseY = 0.36;
    const h = 2.9;
    const postMat = M.fence;
    const n = Math.max(2, Math.round(len / 5.4));
    const posts = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (len * i) / n;
      const p = mesh(cylGeo(0.09, 0.1, h, 10), postMat);
      p.position.set(x, baseY + h / 2, z);
      g.add(p);
      const cap = mesh(new THREE.SphereGeometry(0.13, 10, 8), postMat);
      cap.position.set(x, baseY + h, z);
      g.add(cap);
      posts.push(x);
    }
    // 横杆
    for (const y of [baseY + 0.25, baseY + h - 0.22]) {
      const rail = mesh(boxGeo(len, 0.1, 0.1), postMat);
      rail.position.set(x0 + len / 2, y, z);
      g.add(rail);
    }
    // 铁网
    const ft = TEX.fenceTexture();
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    ft.repeat.set(Math.max(1, Math.round(len / 8)), 1);
    const fMat = new THREE.MeshStandardMaterial({
      map: ft, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 0.65, metalness: 0.35, color: 0x8f8b84
    });
    pbrMats.push(fMat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 0.55), fMat);
    plane.position.set(x0 + len / 2, baseY + 0.28 + (h - 0.55) / 2, z);
    plane.receiveShadow = false;
    g.add(plane);
    return g;
  }

  /* ------------------------------ 主控板 ------------------------------ */
  function buildPCB(root) {
    const g = group(root, -11.65, 1.55, 1.0);
    info.pcbGroup = g;

    // 板本体
    const tex = TEX.pcbTexture();
    const topMat = pbr({ map: tex, roughness: 0.55, metalness: 0.18 });
    const sideMat = M.pcbSide;
    const board = mesh(boxGeo(L.pcb.w, 0.16, L.pcb.h), sideMat);
    g.add(board);
    const topFace = new THREE.Mesh(new THREE.PlaneGeometry(L.pcb.w, L.pcb.h), topMat);
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.y = 0.081;
    topFace.receiveShadow = true;
    g.add(topFace);

    // 铜柱（板下）
    for (const [sx, sz] of L.standoffs) {
      const st = mesh(cylGeo(0.2, 0.2, 1.48, 12), M.brass);
      st.position.set(sx, -0.82, sz);
      g.add(st);
      const nut = mesh(cylGeo(0.27, 0.27, 0.09, 6), M.brass);
      nut.position.set(sx, -0.14, sz);
      g.add(nut);
    }
    // 板上螺丝
    for (const [sx, sz] of L.screws) {
      const screw = mesh(cylGeo(0.21, 0.21, 0.07, 14), M.silver);
      screw.position.set(sx, 0.11, sz);
      g.add(screw);
      const slot = mesh(boxGeo(0.28, 0.02, 0.05), M.blackMatte);
      slot.position.set(sx, 0.15, sz);
      g.add(slot);
    }

    const boardTop = 0.08;   // 板面高度
    // —— 各模块 ——
    buildESP(g, boardTop);
    buildPill(g, boardTop);
    buildRelay(g, boardTop);
    buildSound(g, boardTop);
    buildOLED(g, boardTop);
    buildDriver(g, boardTop);
    buildLDR(g, boardTop);
    buildSmallParts(g, boardTop);
    buildWires(g, boardTop);
    return g;
  }

  function moduleBoard(g, def, tex, y, opt) {
    opt = opt || {};
    const grp = group(g, def.x, y + (def.lift || 0), def.z);
    grp.rotation.y = def.rotY || 0;
    const slab = mesh(boxGeo(def.w, 0.13, def.d), M.moduleSide);
    grp.add(slab);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d), texMat(tex, { roughness: 0.45 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.066;
    face.receiveShadow = true;
    grp.add(face);
    // 支撑排针/铜柱
    if (def.lift) {
      const n = opt.standoffs || 2;
      for (let i = 0; i < n; i++) {
        const sx = (i % 2 ? 1 : -1) * (def.w / 2 - 0.3);
        const st = mesh(cylGeo(0.16, 0.16, def.lift, 8), M.blackPlastic);
        st.position.set(sx, -def.lift / 2 + 0.02, opt.standoffZ || 0);
        grp.add(st);
      }
    }
    grp.userData.board = def;
    return grp;
  }

  function buildESP(g, y) {
    const def = L.esp;
    const grp = moduleBoard(g, def, TEX.espBoardTexture(), y, { standoffs: 2 });
    // 金属屏蔽罩
    const shieldTex = TEX.shieldTexture();
    const shield = mesh(boxGeo(2.25, 0.24, 1.95), M.silver);
    shield.position.set(0.1, 0.18, 0.02);
    grp.add(shield);
    const shieldFace = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.9),
      texMat(shieldTex, { metalness: 0.8, roughness: 0.38 }));
    shieldFace.rotation.x = -Math.PI / 2;
    shieldFace.position.set(0.1, 0.305, 0.02);
    grp.add(shieldFace);
    // 屏蔽罩焊脚
    const lip = mesh(boxGeo(2.32, 0.06, 2.02), M.silver);
    lip.position.set(0.1, 0.05, 0.02);
    grp.add(lip);
    // 板载天线区
    const ant = mesh(boxGeo(0.55, 0.08, 1.5), M.blackMatte);
    ant.position.set(1.35, 0.09, 0);
    grp.add(ant);
    // 排针
    const pinGeo = new THREE.BoxGeometry(0.06, 0.42, 0.06).translate(0, 0.21, 0);
    for (const zz of [-1.12, 1.12]) {
      const pins = [];
      for (let i = 0; i < 8; i++) pins.push(pinGeo.clone().translate(-1.2 + i * 0.32, 0.07, zz));
      gadd(grp, new THREE.Group(), pins);
      const hdr = mesh(boxGeo(2.5, 0.16, 0.24), M.blackPlastic);
      hdr.position.set(-0.2, 0.1, zz);
      grp.add(hdr);
    }
    info.esp = grp;
    return grp;
  }
  // 合并添加
  function gadd(parent, _holder, geos) {
    const merged = mergeGeoms(geos);
    const m = mesh(merged, M.gold);
    parent.add(m);
    return m;
  }

  function buildPill(g, y) {
    const def = L.pill;
    const grp = moduleBoard(g, def, TEX.pillTexture(), y, { standoffs: 0 });
    // 排针
    const pinGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06).translate(0, 0.25, 0);
    for (const zz of [-1.02, 1.02]) {
      const hdr = mesh(boxGeo(5.0, 0.24, 0.26), M.blackPlastic);
      hdr.position.set(0.05, 0.16, zz);
      grp.add(hdr);
      const geos = [];
      for (let i = 0; i < 20; i++) geos.push(pinGeo.clone().translate(-2.35 + i * 0.246, 0.24, zz));
      gadd(grp, null, geos);
    }
    // MCU 芯片
    const chip = mesh(boxGeo(0.78, 0.16, 0.78), M.chipBlack);
    chip.position.set(0.85, 0.14, -0.05);
    grp.add(chip);
    const dot = mesh(new THREE.SphereGeometry(0.05, 8, 6), pbr({ color: 0x5a5f66, roughness: 0.6 }));
    dot.position.set(0.58, 0.22, -0.28);
    grp.add(dot);
    // 8MHz 晶振
    const xtal = mesh(cylGeo(0.26, 0.26, 0.36, 16), M.silver);
    xtal.rotation.z = Math.PI / 2;
    xtal.scale.set(1, 1, 0.62);
    xtal.position.set(-0.05, 0.2, 0);
    grp.add(xtal);
    // 32.768k 晶振
    const xtal2 = mesh(boxGeo(0.32, 0.18, 0.16), M.silver);
    xtal2.position.set(-0.72, 0.16, 0.42);
    grp.add(xtal2);
    // micro USB
    const usb = mesh(boxGeo(0.82, 0.34, 0.46), M.silver);
    usb.position.set(-2.42, 0.2, 0.02);
    grp.add(usb);
    const usbHole = mesh(boxGeo(0.5, 0.16, 0.3), M.blackMatte);
    usbHole.position.set(-2.78, 0.2, 0.02);
    grp.add(usbHole);
    // 复位按钮
    const btn = mesh(cylGeo(0.17, 0.17, 0.13, 12), M.silver);
    btn.position.set(-1.72, 0.14, 0.45);
    grp.add(btn);
    const btnTop = mesh(cylGeo(0.11, 0.11, 0.08, 12), pbr({ color: 0xc23a2c, roughness: 0.4 }));
    btnTop.position.set(-1.72, 0.2, 0.45);
    grp.add(btnTop);
    // BOOT 跳线帽（黄）
    const jp = mesh(boxGeo(0.62, 0.42, 0.5), pbr({ color: 0xf0c400, roughness: 0.45 }));
    jp.position.set(-1.45, 0.3, -0.52);
    jp.rotation.y = 0.06;
    grp.add(jp);
    for (const xx of [-0.15, 0.15]) {
      const pin = mesh(cylGeo(0.035, 0.035, 0.3, 6), M.gold);
      pin.position.set(-1.45 + xx, 0.16, -0.52);
      grp.add(pin);
    }
    // 稳压器
    const reg = mesh(boxGeo(0.42, 0.2, 0.32), M.chipBlack);
    reg.position.set(1.95, 0.14, 0.35);
    grp.add(reg);
    // 4pin 排针
    const hdr4 = mesh(boxGeo(0.26, 0.24, 1.0), M.blackPlastic);
    hdr4.position.set(2.38, 0.16, 0.42);
    grp.add(hdr4);
    info.pill = grp;
    return grp;
  }

  function buildRelay(g, y) {
    const def = L.relay;
    const grp = moduleBoard(g, def, TEX.relayBoardTexture(), y, { standoffs: 0 });
    // 继电器本体
    const relayTex = (function () {
      const [c, ctx] = [document.createElement('canvas'), null];
      c.width = 512; c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#20242a'; x.fillRect(0, 0, 512, 256);
      x.strokeStyle = 'rgba(230,235,240,0.35)'; x.lineWidth = 3;
      x.strokeRect(8, 8, 496, 240);
      x.fillStyle = 'rgba(225,232,238,0.85)';
      x.font = '600 42px "Helvetica Neue",sans-serif';
      x.fillText('SRD-05VDC-SL-C', 26, 86);
      x.font = '500 28px "Helvetica Neue",sans-serif';
      x.fillText('10A 250VAC', 26, 140);
      x.fillText('5V DC', 26, 186);
      x.fillStyle = 'rgba(225,232,238,0.5)';
      x.font = '500 22px sans-serif';
      x.fillText('SONGLE', 330, 214);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const relay = mesh(boxGeo(1.95, 1.5, 1.55), M.blackPlastic);
    relay.position.set(-0.35, 0.83, 0.1);
    grp.add(relay);
    const relayLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.46),
      texMat(relayTex, { roughness: 0.5 }));
    relayLabel.rotation.x = -Math.PI / 2;
    relayLabel.position.set(-0.35, 1.585, 0.1);
    grp.add(relayLabel);
    // 光耦
    const opto = mesh(boxGeo(0.72, 0.28, 0.42), M.chipBlack);
    opto.position.set(-1.12, 0.22, -0.72);
    grp.add(opto);
    // 三极管
    const tri = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 8), M.chipBlack);
    tri.position.set(0.35, 0.25, -0.9);
    grp.add(tri);
    // 二极管
    const diode = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8), M.blackMatte);
    diode.rotation.z = Math.PI / 2;
    diode.position.set(0.05, 0.18, -0.6);
    grp.add(diode);
    // 蓝色接线端子
    const term = mesh(boxGeo(0.95, 0.78, 0.62), M.bluePlastic);
    term.position.set(1.06, 0.45, 0.58);
    grp.add(term);
    for (const zz of [-0.16, 0.16]) {
      const hole = mesh(boxGeo(0.3, 0.3, 0.16), M.blackMatte);
      hole.position.set(1.25, 0.5, 0.58 + zz);
      grp.add(hole);
      const sc = mesh(cylGeo(0.1, 0.1, 0.06, 8), M.silver);
      sc.rotation.z = Math.PI / 2;
      sc.position.set(0.72, 0.5, 0.58 + zz);
      grp.add(sc);
    }
    info.relay = grp;
    return grp;
  }

  function buildSound(g, y) {
    const def = L.sound;
    const grp = moduleBoard(g, def, TEX.soundBoardTexture(), y, { standoffs: 2, standoffZ: 0 });
    // 麦克风
    const mic = mesh(cylGeo(0.55, 0.55, 0.85, 20), M.silver);
    mic.position.set(-1.55, 0.48, 0);
    grp.add(mic);
    const micTop = mesh(cylGeo(0.44, 0.44, 0.06, 20), M.blackMatte);
    micTop.position.set(-1.55, 0.92, 0);
    grp.add(micTop);
    // LM393
    const chip = mesh(boxGeo(0.72, 0.28, 0.42), M.chipBlack);
    chip.position.set(-0.55, 0.22, 0);
    grp.add(chip);
    // 可调电阻
    const pot = mesh(boxGeo(0.62, 0.5, 0.55), M.bluePlastic);
    pot.position.set(0.65, 0.32, 0.42);
    grp.add(pot);
    const potScrew = mesh(cylGeo(0.2, 0.2, 0.08, 12), M.silver);
    potScrew.position.set(0.65, 0.59, 0.42);
    grp.add(potScrew);
    // 白色接线座
    const conn = mesh(boxGeo(0.72, 0.4, 0.3), M.offWhite);
    conn.position.set(-1.2, 0.28, 0.92);
    grp.add(conn);
    // LED
    const led1 = mesh(new THREE.SphereGeometry(0.1, 8, 6), pbr({ color: 0x8fe0a0, emissive: new THREE.Color(0x35c255), emissiveIntensity: 0.9, roughness: 0.3 }));
    led1.position.set(-0.05, 0.16, -0.6);
    grp.add(led1);
    info.sound = grp;
    return grp;
  }

  function buildOLED(g, y) {
    const def = L.oled;
    const grp = moduleBoard(g, def, TEX.oledBoardTexture(), y, { standoffs: 2 });
    // 黑色显示屏
    const dc = TEX.displayCanvas();
    const dispTex = new THREE.CanvasTexture(dc.canvas);
    dispTex.colorSpace = THREE.SRGBColorSpace;
    info.screens.oled = { dc, tex: dispTex, draw: TEX.drawDisplay };
    TEX.drawDisplay(dc, { lux: 45000, threshold: 100, lampOn: false, mode: 'auto', isNight: false });
    dispTex.needsUpdate = true;
    const screenMat = pbr({
      map: dispTex, emissive: new THREE.Color(0xffffff), emissiveMap: dispTex,
      emissiveIntensity: 1.0, roughness: 0.18, metalness: 0.05
    });
    info.screens.oledMat = screenMat;
    const glass = mesh(boxGeo(3.5, 0.1, 2.6), M.blackMatte);
    glass.position.set(0.1, 0.16, -0.12);
    grp.add(glass);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), screenMat);
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(0.1, 0.215, -0.12);
    grp.add(screen);
    // 保护膜反光
    const film = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.7),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.10, roughness: 0.05,
        metalness: 0.3, side: THREE.DoubleSide, depthWrite: false
      }));
    film.rotation.x = -Math.PI / 2;
    film.position.set(0.1, 0.265, -0.12);
    grp.add(film);
    // 电解电容
    const cap = mesh(cylGeo(0.26, 0.26, 0.55, 14), M.blackPlastic);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, 0.2, 1.25);
    grp.add(cap);
    // 排针
    const hdr = mesh(boxGeo(1.15, 0.28, 0.28), M.blackPlastic);
    hdr.position.set(0, 0.2, -1.32);
    grp.add(hdr);
    info.oled = grp;
    return grp;
  }

  function buildDriver(g, y) {
    const def = L.driver;
    const grp = moduleBoard(g, def, TEX.driverBoardTexture(), y, { standoffs: 1 });
    // 接线端子（朝前）
    const term = mesh(boxGeo(1.05, 0.85, 0.7), M.bluePlastic);
    term.position.set(0, 0.48, 0.78);
    grp.add(term);
    for (const xx of [-0.24, 0.24]) {
      const hole = mesh(boxGeo(0.18, 0.3, 0.3), M.blackMatte);
      hole.position.set(xx, 0.55, 1.02);
      grp.add(hole);
      const sc = mesh(cylGeo(0.1, 0.1, 0.06, 8), M.silver);
      sc.rotation.x = Math.PI / 2;
      sc.position.set(xx, 0.52, 0.62);
      grp.add(sc);
    }
    // R100 采样电阻
    const res = mesh(boxGeo(0.6, 0.22, 0.3), M.offWhite);
    res.position.set(0.45, 0.22, 0.15);
    grp.add(res);
    // MOS 管
    const mos = mesh(boxGeo(0.5, 0.2, 0.36), M.chipBlack);
    mos.position.set(-0.5, 0.2, 0.35);
    grp.add(mos);
    info.driver = grp;
    return grp;
  }

  function buildLDR(g, y) {
    const def = L.ldr;
    const grp = group(g, def.x, y, def.z);
    grp.rotation.y = 0.25;
    // 两条腿
    for (const xx of [-0.22, 0.22]) {
      const leg = mesh(cylGeo(0.035, 0.035, 0.52, 6), M.silver);
      leg.position.set(xx, 0.26, 0.06);
      leg.rotation.x = -0.2;
      grp.add(leg);
    }
    // 光敏盘
    const disc = mesh(cylGeo(0.56, 0.56, 0.09, 26), [
      M.offWhite,
      texMat(TEX.ldrTexture(), { roughness: 0.75, metalness: 0.05 }),
      M.offWhite
    ]);
    disc.position.set(0, 0.58, 0.16);
    disc.rotation.x = -0.24;
    grp.add(disc);
    // 旁边电阻
    const res = mesh(boxGeo(0.62, 0.2, 0.24), pbr({ color: 0xc9b48e, roughness: 0.7 }));
    res.position.set(-0.95, 0.17, 0.28);
    res.rotation.y = Math.PI / 2;
    grp.add(res);
    for (const off of [-0.12, 0.02, 0.16]) {
      const band = mesh(boxGeo(0.07, 0.21, 0.25), pbr({ color: off < 0 ? 0x7a3b1f : 0x27356b, roughness: 0.6 }));
      band.position.set(-0.95 + off, 0.17, 0.28);
      band.rotation.y = Math.PI / 2;
      grp.add(band);
    }
    info.ldr = grp;
    return grp;
  }

  function buildSmallParts(g, y) {
    // 按键
    for (let i = 0; i < L.buttons.length; i++) {
      const x = L.buttons[i];
      const base = mesh(boxGeo(0.62, 0.2, 0.62), M.blackPlastic);
      base.position.set(x, 0.1 + y, L.buttonZ);
      g.add(base);
      const cap = mesh(cylGeo(0.16, 0.16, 0.12, 12), M.silver);
      cap.position.set(x, 0.24 + y, L.buttonZ);
      g.add(cap);
    }
    // 可调电阻
    for (const [xx, zz] of [[4.35, 2.45], [3.35, 2.45]]) {
      const pot = mesh(boxGeo(0.62, 0.5, 0.55), M.bluePlastic);
      pot.position.set(xx, 0.32 + y, zz);
      g.add(pot);
      const sc = mesh(cylGeo(0.18, 0.18, 0.07, 12), M.silver);
      sc.position.set(xx, 0.59 + y, zz);
      g.add(sc);
    }
    // 蓝色 1/4W 电阻若干
    const resPos = [
      [5.35, 1.35, 0.0], [6.05, 1.35, 0.0], [8.55, 3.75, 0.35], [0.75, 3.95, 0.2],
      [-3.1, 0.85, 0.9], [-4.2, 0.85, 0.9]
    ];
    for (const [xx, zz, rot] of resPos) {
      const body = mesh(boxGeo(0.66, 0.2, 0.22), pbr({ color: 0x2f4f9e, roughness: 0.5, metalness: 0.1 }));
      body.position.set(xx, 0.17 + y, zz);
      body.rotation.y = rot;
      g.add(body);
      for (const c of ['#b8802f', '#e6e2d8']) {
        const band = mesh(boxGeo(0.05, 0.21, 0.23), pbr({ color: c, roughness: 0.55 }));
        band.position.set(xx - 0.12, 0.17 + y, zz);
        band.rotation.y = rot;
        g.add(band);
      }
    }
    // 电解电容
    for (const [xx, zz, h, r] of [[-5.2, 0.55, 0.7, 0.3], [-4.75, 0.3, 0.55, 0.26], [4.3, 1.62, 0.5, 0.24]]) {
      const cap = mesh(cylGeo(r, r, h, 14), M.blackPlastic);
      cap.position.set(xx, h / 2 + 0.02 + y, zz);
      g.add(cap);
      const top = mesh(cylGeo(r * 0.92, r * 0.92, 0.03, 14), M.silver);
      top.position.set(xx, h + 0.03 + y, zz);
      g.add(top);
    }
    // 绿色 LED（电源指示）
    const led = mesh(new THREE.SphereGeometry(0.12, 10, 8), pbr({
      color: 0x7fe08a, emissive: new THREE.Color(0x3ddc63), emissiveIntensity: 2.2, roughness: 0.3
    }));
    led.position.set(4.55, 0.2 + y, 3.85);
    g.add(led);
    info.greenLed = led;
    // 红色 LED
    const led2 = mesh(new THREE.SphereGeometry(0.1, 10, 8), pbr({
      color: 0xff8a7a, emissive: new THREE.Color(0xff3b22), emissiveIntensity: 1.6, roughness: 0.3
    }));
    led2.position.set(3.55, 0.19 + y, 3.85);
    g.add(led2);
    // 30pin 排母（ESP 附近）
    const hdr = mesh(boxGeo(0.3, 0.35, 1.6), M.blackPlastic);
    hdr.position.set(-8.55, 0.24 + y, -2.55);
    g.add(hdr);
    // 电源输入蓝色端子
    const pin = mesh(boxGeo(0.95, 0.78, 0.62), M.bluePlastic);
    pin.position.set(-8.55, 0.5 + y, 1.05);
    g.add(pin);
    for (const zz of [-0.16, 0.16]) {
      const hole = mesh(boxGeo(0.3, 0.3, 0.16), M.blackMatte);
      hole.position.set(-8.9, 0.55 + y, 1.05 + zz);
      g.add(hole);
    }
    // 更多贴片阻容
    for (const [xx, zz, rot, col] of [
      [-3.9, 1.55, 0.4, 0xd8cfb6], [-3.3, 1.9, 1.2, 0xd8cfb6],
      [-2.7, 1.55, 0.2, 0x2f4f9e], [-7.4, -0.4, 0.0, 0x6b4a1f],
      [4.9, 1.5, 1.4, 0xd8cfb6], [5.45, -1.2, 0.3, 0x2f4f9e],
      [6.2, 1.75, -0.5, 0x2f4f9e], [8.7, 0.5, 1.2, 0xd8cfb6]
    ]) {
      const comp = mesh(boxGeo(0.34, 0.16, 0.18), pbr({ color: col, roughness: 0.55, metalness: 0.1 }));
      comp.position.set(xx, 0.14 + y, zz);
      comp.rotation.y = rot;
      g.add(comp);
    }
    // 晶振与功率电感
    const ind = mesh(boxGeo(0.55, 0.3, 0.45), M.chipBlack);
    ind.position.set(-5.3, 0.2 + y, 0.5);
    g.add(ind);
    // 备用排针
    const spare = mesh(boxGeo(0.26, 0.3, 1.2), M.gold);
    spare.position.set(4.3, 0.2 + y, -1.75);
    g.add(spare);
  }

  function buildWires(g, y) {
    // 继电器 → 路灯（红黑双线，从端子绕到平台下方）
    g.add(wire([
      [7.62, 0.55 + y, -2.4], [8.7, 0.42 + y, -2.95], [9.35, 0.1 + y, -2.8],
      [9.55, -0.5, -2.4], [9.45, -1.42, -2.1]
    ], 0.055, 0xc0392b));
    g.add(wire([
      [7.62, 0.48 + y, -2.15], [8.6, 0.35 + y, -2.65], [9.25, 0.05 + y, -2.5],
      [9.45, -0.55, -2.15], [9.35, -1.42, -1.95]
    ], 0.055, 0x1b1b1b));
    // 路灯驱动板输出线（垂到平台下）
    g.add(wire([
      [2.18, 0.55 + y - 0.1, 6.05], [2.5, 0.3, 6.35], [2.35, 0.05, 6.55], [2.15, -0.02, 6.7]
    ], 0.065, 0x1f8a5b));
    g.add(wire([
      [2.62, 0.55 + y - 0.1, 6.05], [2.85, 0.28, 6.4], [2.7, 0.04, 6.62], [2.5, -0.02, 6.78]
    ], 0.065, 0x2b57b8));
    // ESP 与主板连接线（黑色细线）
    g.add(wire([
      [-8.1, 1.45 + y, -2.4], [-8.6, 1.5 + y, -1.55], [-8.95, 0.9 + y, -0.85], [-9.05, 0.15 + y, -0.2]
    ], 0.032, 0x1a1a1a));
    g.add(wire([
      [-8.35, 1.4 + y, -2.6], [-8.85, 1.42 + y, -1.7], [-9.2, 0.8 + y, -1.0], [-9.3, 0.15 + y, -0.35]
    ], 0.028, 0x222222));
    // 主控 USB 供电线：从蓝板 USB 口延伸到板外
    g.add(wire([
      [-3.2, 0.4 + y, -0.1], [-4.6, 0.3 + y, 0.15], [-6.4, -0.2 + y, 0.5],
      [-8.4, -0.9, 0.8], [-9.7, -1.5, 1.0]
    ], 0.045, 0x151515));
    // 光敏电阻引出线
    g.add(wire([
      [7.2, 0.35 + y, 2.4], [6.6, 0.28 + y, 1.7], [7.0, 0.1 + y, 1.2]
    ], 0.028, 0xcfd3d6));
  }

  /* ------------------------------ 路灯 ------------------------------ */
  function buildLamp(root) {
    const g = group(root, 4.35, 0.36, -7.55);
    g.rotation.y = Math.PI;
    info.lamp.group = g;
    // 底座
    const plate = mesh(cylGeo(1.05, 1.18, 0.22, 28), M.whitePLA);
    plate.position.set(0, 0.11, 0);
    g.add(plate);
    const flange = mesh(cylGeo(0.62, 0.72, 0.16, 24), M.whitePLA);
    flange.position.set(0, 0.3, 0);
    g.add(flange);
    // 灯杆
    const poleH = 29.5;
    const pole = mesh(cylGeo(0.3, 0.42, poleH, 24), M.whitePLA);
    pole.position.set(0, 0.36 + poleH / 2, 0);
    g.add(pole);
    for (const yy of [1.4, 15.2, 28.4]) {
      const ring = mesh(cylGeo(0.36, 0.36, 0.16, 20), M.offWhite);
      ring.position.set(0, yy, 0);
      g.add(ring);
    }
    // 弯臂
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 29.5, 0),
      new THREE.Vector3(0, 30.6, -0.08),
      new THREE.Vector3(0, 31.3, -0.7),
      new THREE.Vector3(0, 31.55, -1.7),
      new THREE.Vector3(0, 31.5, -2.9),
      new THREE.Vector3(0, 31.32, -3.9)
    ]);
    const arm = mesh(new THREE.TubeGeometry(curve, 60, 0.31, 12, false), M.whitePLA);
    g.add(arm);
    // 弯头加粗套
    const collar = mesh(new THREE.SphereGeometry(0.46, 16, 12), M.whitePLA);
    collar.scale.set(1, 1.25, 1.05);
    collar.position.set(0, 30.95, -0.35);
    g.add(collar);
    // 灯头支架
    const bracket = mesh(boxGeo(0.62, 0.3, 1.15), M.whitePLA);
    bracket.position.set(0, 31.12, -4.1);
    bracket.rotation.x = -0.1;
    g.add(bracket);
    const bracket2 = mesh(cylGeo(0.2, 0.2, 0.8, 12), M.whitePLA);
    bracket2.rotation.x = Math.PI / 2;
    bracket2.position.set(0, 31.2, -3.85);
    g.add(bracket2);
    // 灯头
    const headGrp = group(g, 0, 31.02, -4.95);
    headGrp.rotation.x = 0.055;
    info.lamp.headGroup = headGrp;
    const head = mesh(slabGeo(1.92, 4.6, 0.78, 0.34, 0.07), M.whitePLA);
    head.position.set(0, 0.06, 0);
    headGrp.add(head);
    // 灯头底部外框
    const rim = mesh(slabGeo(1.82, 4.5, 0.16, 0.3, 0.03), M.offWhite);
    rim.position.set(0, -0.4, 0);
    headGrp.add(rim);
    // 灯头顶部装饰槽
    const groove = mesh(boxGeo(1.2, 0.04, 3.2), M.offWhite);
    groove.position.set(0, 0.46, -0.1);
    headGrp.add(groove);
    // LED 发光面（朝下）
    const ledMat = pbr({
      color: 0xfff8e8, emissive: new THREE.Color(0xffe7b8), emissiveIntensity: 0.0,
      roughness: 0.3, metalness: 0.0
    });
    info.lamp.ledMat = ledMat;
    const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.9), ledMat);
    diffuser.rotation.x = Math.PI / 2;
    diffuser.position.set(0, -0.485, 0);
    headGrp.add(diffuser);
    const diffFrame = mesh(boxGeo(1.62, 0.06, 4.02), M.offWhite);
    diffFrame.position.set(0, -0.455, 0);
    headGrp.add(diffFrame);
    // 灯珠格栅
    for (let i = 0; i < 7; i++) {
      const bar = mesh(boxGeo(1.42, 0.03, 0.05), M.offWhite);
      bar.position.set(0, -0.5, -1.62 + i * 0.54);
      headGrp.add(bar);
    }
    // 光晕精灵
    const glowTex = TEX.glowTexture('255,228,170', '', 2.2);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xffdfa8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    info.lamp.glowMat = glowMat;
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(10, 10, 1);
    glow.position.set(0, -0.62, 0);
    headGrp.add(glow);
    const glow2Mat = new THREE.SpriteMaterial({
      map: TEX.glowTexture('255,210,140', '', 1.6), color: 0xffcf8a,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    info.lamp.glow2Mat = glow2Mat;
    const glow2 = new THREE.Sprite(glow2Mat);
    glow2.scale.set(24, 24, 1);
    glow2.position.set(0, -0.7, 0);
    headGrp.add(glow2);
    // 体积光锥
    const coneMat = new THREE.MeshBasicMaterial({
      map: TEX.lightConeTexture(), color: 0xffa64d, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    info.lamp.coneMat = coneMat;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(8.6, 30.2, 44, 1, true), coneMat);
    cone.position.set(0, -0.55 - 15.1, 0);
    cone.renderOrder = 3;
    headGrp.add(cone);
    // 点光源 + 聚光灯
    const lampLight = new THREE.PointLight(0xffd9a0, 0, 24, 2);
    lampLight.position.set(0, -0.75, 0);
    headGrp.add(lampLight);
    info.lamp.point = lampLight;
    const spot = new THREE.SpotLight(0xffd9a0, 0, 55, 0.72, 0.6, 1.15);
    spot.position.set(0, -0.55, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0008;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 50;
    headGrp.add(spot);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, -31, -4.9);
    headGrp.add(spotTarget);
    spot.target = spotTarget;
    info.lamp.spot = spot;
    // 灯头下照射
    return g;
  }

  /* ------------------------------ 树木 ------------------------------ */
  function buildTree(root, x, z, scale, seed, yBase) {
    const g = group(root, x, yBase || 0.36, z);
    g.scale.setScalar(scale || 1);
    // 树池
    const pit = mesh(cylGeo(0.85, 0.9, 0.06, 18), M.dirt);
    pit.position.y = 0.02;
    g.add(pit);
    // 树干
    const trunk = mesh(cylGeo(0.13, 0.26, 2.9, 10), M.treeBark);
    trunk.position.y = 1.45;
    g.add(trunk);
    // 枝干
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const br = mesh(cylGeo(0.06, 0.13, 1.4, 7), M.treeBark);
      br.position.set(Math.cos(a) * 0.35, 2.6 + i * 0.16, Math.sin(a) * 0.35);
      br.rotation.z = Math.cos(a) * 0.55;
      br.rotation.x = Math.sin(a) * 0.55;
      g.add(br);
    }
    // 树冠：多个带噪声的球体合并
    const rnd = (function (a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(seed || 7);
    const geos = [];
    const blobs = [
      [0, 3.9, 0, 1.75],
      [-1.1, 3.5, 0.5, 1.25],
      [1.15, 3.45, -0.35, 1.2],
      [0.2, 4.7, 0.5, 1.25],
      [-0.5, 4.35, -0.95, 1.1],
      [0.6, 3.3, 0.95, 1.0],
      [-0.75, 4.9, 0.7, 0.95],
      [0.95, 4.55, 0.6, 0.85]
    ];
    for (const b of blobs) {
      const geo = new THREE.IcosahedronGeometry(b[3], 2);
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = 1 + 0.22 * Math.sin(v.x * 3.1 + rnd() * 0.5) * Math.cos(v.y * 2.7) + 0.12 * (rnd() - 0.5);
        v.multiplyScalar(n);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      geo.translate(b[0], b[1], b[2]);
      geos.push(geo);
    }
    const foliage = mergeGeoms(geos);
    // 顶点色：底部暗、顶部亮
    const pos = foliage.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x142f14);
    const cHigh = new THREE.Color(0x356028);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i);
      const t = THREE.MathUtils.clamp((yy - 2.3) / 3.4, 0, 1);
      c.copy(cLow).lerp(cHigh, t * 0.85 + rnd() * 0.25);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    foliage.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const folMat = pbr({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
    const fol = mesh(foliage, folMat);
    g.add(fol);
    return g;
  }

  /* ------------------------------ 汽车 ------------------------------ */
  function buildCar(root, x, z, color, rotY) {
    const g = group(root, x, 0.02, z);
    g.rotation.y = rotY;
    const paint = color === 'red' ? M.carPaintRed : M.carPaintWhite;
    // 车身（侧面轮廓拉伸）
    const bodyShape = new THREE.Shape();
    const pts = [
      [-4.0, 0.62], [-4.02, 1.02], [-3.72, 1.16], [-2.9, 1.24],
      [-1.4, 1.27], [0.6, 1.27], [1.9, 1.23], [2.8, 1.14],
      [3.6, 1.0], [3.96, 0.94], [4.0, 0.78], [4.0, 0.62]
    ];
    bodyShape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) bodyShape.lineTo(pts[i][0], pts[i][1]);
    bodyShape.lineTo(4.0, 0.42);
    bodyShape.quadraticCurveTo(0, 0.32, -4.0, 0.44);
    bodyShape.lineTo(-4.0, 0.62);
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: 3.05, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14,
      bevelSegments: 3, curveSegments: 8
    });
    bodyGeo.translate(0, 0, -1.525);
    const body = mesh(bodyGeo, paint);
    g.add(body);
    // 车顶舱（漆面 + 独立玻璃）
    const cabShape = new THREE.Shape();
    cabShape.moveTo(-2.62, 1.26);
    cabShape.lineTo(-2.0, 1.78);
    cabShape.quadraticCurveTo(-1.6, 2.16, -0.9, 2.22);
    cabShape.lineTo(0.95, 2.22);
    cabShape.quadraticCurveTo(1.6, 2.2, 1.95, 1.82);
    cabShape.lineTo(2.42, 1.26);
    cabShape.lineTo(-2.62, 1.26);
    const cabGeo = new THREE.ExtrudeGeometry(cabShape, {
      depth: 2.66, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08,
      bevelSegments: 2, curveSegments: 10
    });
    cabGeo.translate(0, 0, -1.33);
    const cab = mesh(cabGeo, paint);
    g.add(cab);
    // 侧窗玻璃（前后两片）
    function glassPanel(pts, zPos, flip) {
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false, curveSegments: 6 });
      if (flip) { geo.scale(1, 1, 1); geo.translate(0, 0, zPos - 0.025); }
      else geo.translate(0, 0, zPos);
      return mesh(geo, M.windowGlass, false, false);
    }
    const frontWin = [[-0.05, 2.1], [0.86, 2.1], [1.72, 1.46], [0.16, 1.46]];
    const rearWin = [[-2.22, 1.46], [-1.82, 1.8], [-1.04, 2.1], [-0.42, 2.1], [-0.42, 1.46]];
    for (const [zPos, flip] of [[1.41, false], [-1.41, true]]) {
      g.add(glassPanel(frontWin, zPos, flip));
      g.add(glassPanel(rearWin, zPos, flip));
    }
    // 前后风挡（四边形薄片）
    function quadGlass(corners) {
      const geo = new THREE.BufferGeometry();
      const v = new Float32Array([
        ...corners[0], ...corners[1], ...corners[2],
        ...corners[0], ...corners[2], ...corners[3]
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.computeVertexNormals();
      return mesh(geo, M.windowGlass, false, false);
    }
    // 前风挡
    g.add(quadGlass([
      [1.02, 2.19, -1.16], [1.02, 2.19, 1.16],
      [2.2, 1.4, 1.22], [2.2, 1.4, -1.22]
    ]));
    // 后风挡
    g.add(quadGlass([
      [-1.02, 2.19, 1.14], [-1.02, 2.19, -1.14],
      [-2.32, 1.42, -1.2], [-2.32, 1.42, 1.2]
    ]));
    // 车顶饰条
    const roofTrim = mesh(boxGeo(3.3, 0.04, 0.1), M.chrome);
    roofTrim.position.set(-0.2, 2.3, 0);
    g.add(roofTrim);
    // 腰线
    const belt = mesh(boxGeo(7.3, 0.05, 3.36), M.chrome);
    belt.position.set(0.0, 1.28, 0);
    g.add(belt);
    // 车轮
    const wheels = [[-2.55, -1.55], [-2.55, 1.55], [2.55, -1.55], [2.55, 1.55]];
    for (const [wx, wz] of wheels) {
      const tire = mesh(cylGeo(0.62, 0.62, 0.42, 18), M.tire);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(wx, 0.62, wz);
      g.add(tire);
      const rim = mesh(cylGeo(0.37, 0.37, 0.44, 16), M.rim);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(wx, 0.62, wz);
      g.add(rim);
      const hub = mesh(cylGeo(0.13, 0.13, 0.47, 10), M.chipBlack);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, 0.62, wz);
      g.add(hub);
    }
    // 前后保险杠
    const bumperF = mesh(boxGeo(0.24, 0.34, 3.1), M.blackPlastic);
    bumperF.position.set(4.02, 0.72, 0);
    g.add(bumperF);
    const bumperR = mesh(boxGeo(0.24, 0.34, 3.1), M.blackPlastic);
    bumperR.position.set(-4.04, 0.74, 0);
    g.add(bumperR);
    // 前脸格栅
    const grille = mesh(boxGeo(0.12, 0.26, 1.7), M.blackMatte);
    grille.position.set(4.06, 0.98, 0);
    g.add(grille);
    // 大灯
    for (const zz of [-1.08, 1.08]) {
      const hl = mesh(boxGeo(0.16, 0.2, 0.5), M.headlight);
      hl.position.set(4.02, 1.02, zz);
      g.add(hl);
    }
    // 尾灯
    for (const zz of [-1.12, 1.12]) {
      const tl = mesh(boxGeo(0.14, 0.18, 0.42), M.taillight);
      tl.position.set(-4.02, 1.0, zz);
      g.add(tl);
    }
    // 后视镜
    for (const zz of [-1.58, 1.58]) {
      const mir = mesh(boxGeo(0.34, 0.16, 0.18), paint);
      mir.position.set(0.75, 1.5, zz);
      g.add(mir);
      const mirArm = mesh(boxGeo(0.16, 0.06, 0.16), M.blackPlastic);
      mirArm.position.set(0.82, 1.44, zz * 0.94);
      g.add(mirArm);
    }
    // 车牌
    const plateF = mesh(boxGeo(0.04, 0.16, 0.55), pbr({ color: 0xf0efe8, roughness: 0.5 }));
    plateF.position.set(4.1, 0.72, 0);
    g.add(plateF);
    const plateR = mesh(boxGeo(0.04, 0.15, 0.5), pbr({ color: 0x2a6fc4, roughness: 0.5 }));
    plateR.position.set(-4.12, 0.8, 0);
    g.add(plateR);
    // 车顶天线
    const ant = mesh(cylGeo(0.03, 0.05, 0.22, 6), M.blackPlastic);
    ant.position.set(-1.35, 2.3, 0);
    g.add(ant);
    // 双出排气
    for (const zz of [-0.8, 0.8]) {
      const ex = mesh(cylGeo(0.07, 0.07, 0.2, 8), M.silver);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(-4.1, 0.5, zz);
      g.add(ex);
    }
    // 灯光精灵（夜间亮）
    const glowTex = TEX.glowTexture('255,245,220', '', 2.4);
    const hMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff0cc, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (const zz of [-1.08, 1.08]) {
      const sp = new THREE.Sprite(hMat.clone());
      sp.scale.set(1.6, 1.6, 1);
      sp.position.set(4.15, 1.02, zz);
      g.add(sp);
      (info.carGlows = info.carGlows || []).push(sp);
    }
    const tMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture('255,90,50', '', 2.2), color: 0xff5a32,
      transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (const zz of [-1.12, 1.12]) {
      const sp = new THREE.Sprite(tMat.clone());
      sp.scale.set(1.2, 1.2, 1);
      sp.position.set(-4.1, 1.0, zz);
      g.add(sp);
      (info.carGlows = info.carGlows || []).push(sp);
    }
    g.userData.car = true;
    return g;
  }

  /* ------------------------------ 场景树 ------------------------------ */
  function build() {
    initMaterials();
    const root = new THREE.Group();
    root.name = 'diorama';
    buildBase(root);
    buildPlatform(root);
    buildStreet(root);
    const pcb = buildPCB(root);
    // 树
    buildTree(root, -1.5, -10.2, 1.02, 11);
    buildTree(root, 10.9, -10.5, 1.12, 23);
    buildTree(root, 3.1, 10.2, 0.95, 37);
    // 车
    buildCar(root, 9.4, 3.15, 'white', Math.PI - 0.02);
    buildCar(root, 14.7, -3.1, 'red', Math.PI + 0.025);
    // 路灯
    buildLamp(root);

    // 热点锚点
    root.updateMatrixWorld(true);
    const anchors = [
      { id: 'ldr', name: '光敏电阻', sub: 'GL5516 光照采集', group: info.ldr, local: [0, 1.1, 0.2], num: 1 },
      { id: 'mcu', name: 'STM32 主控', sub: 'STM32F103C8T6', group: info.pill, local: [0.4, 1.4, 0], num: 2 },
      { id: 'relay', name: '继电器模块', sub: '弱电控强电输出', group: info.relay, local: [-0.3, 2.2, 0.1], num: 3 },
      { id: 'esp', name: 'ESP8266', sub: 'Wi-Fi 无线通信', group: info.esp, local: [0, 1.15, 0], num: 4 },
      { id: 'oled', name: 'OLED 显示屏', sub: '本地数据可视化', group: info.oled, local: [0.1, 1.0, -0.1], num: 5 },
      { id: 'sound', name: '声控采集模块', sub: '声音传感扩展', group: info.sound, local: [-1.5, 1.6, 0], num: 6 },
      { id: 'lamp', name: 'LED 路灯', sub: '被控对象 · 照明执行', group: info.lamp.headGroup, local: [0, 1.6, 0], num: 7 }
    ];
    const v = new THREE.Vector3();
    for (const a of anchors) {
      const anchor = new THREE.Object3D();
      anchor.position.set(a.local[0], a.local[1], a.local[2]);
      a.group.add(anchor);
      root.updateMatrixWorld(true);
      anchor.getWorldPosition(v);
      info.hotspots.push({ id: a.id, name: a.name, sub: a.sub, num: a.num, pos: v.clone(), obj: a.group });
      a.group.userData.hotspot = a.id;
    }
    info.root = root;
    info.pcb = pcb;
    info.materials = M;
    return info;
  }

  function setEnvIntensity(v) {
    for (const m of pbrMats) {
      if ('envMapIntensity' in m) m.envMapIntensity = v;
    }
  }

  return {
    build,
    setEnvIntensity,
    info,
    materials: M
  };
})();
