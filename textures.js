/* =========================================================================
   textures.js —— 程序化贴图库
   为「基于STM32的智能路灯控制系统」3D 展示模型生成全部材质贴图
   （路面标线、人行道砖、PCB 丝印、模块板卡、OLED 屏幕、灯罩光晕等）
   坐标约定：PCB 局部 +x 向右（朝路灯一侧），+z 向后（远离观众一侧）
   贴图映射：px = (x/w + 0.5) * W ,  py = (z/h + 0.5) * H
   ========================================================================= */
window.TEX = (function () {
  'use strict';

  /* ----------------------------- 布局参数 ----------------------------- */
  const LAYOUT = {
    pcb: { w: 19.2, h: 11.6 },
    esp:   { x: -6.35, z: -2.75, w: 3.45, d: 2.65, rotY: 0.16, lift: 1.35 },
    relay: { x:  6.55, z: -2.95, w: 3.10, d: 2.45, rotY: 0.02 },
    pill:  { x:  2.10, z: -0.05, w: 5.30, d: 2.30, rotY: 0.03 },
    sound: { x: -6.40, z:  2.65, w: 4.60, d: 2.60, rotY: -0.03, lift: 0.42 },
    oled:  { x: -1.60, z:  3.60, w: 4.50, d: 3.30, rotY: 0.005, lift: 0.34 },
    driver:{ x:  2.40, z:  4.55, w: 2.80, d: 2.30, rotY: -0.02, lift: 0.30 },
    ldr:   { x:  7.45, z:  2.95 },
    buttons: [ -0.55, 1.35, 3.25, 5.15, 7.05 ],
    buttonZ: -4.90,
    screws: [[-8.55, 4.75], [8.55, 4.75], [-8.55, -4.75], [8.55, -4.75]],
    standoffs: [[-7.7, 3.9], [7.7, 3.9], [-7.7, -3.9], [7.7, -3.9]]
  };

  /* ----------------------------- 工具函数 ----------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let R = mulberry32(20240521);

  function cv(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  }
  function canvasTex(c, opt) {
    opt = opt || {};
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = opt.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = opt.aniso || 8;
    if (opt.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opt.repeat[0], opt.repeat[1]);
    }
    t.needsUpdate = true;
    return t;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function mottle(ctx, W, H, color, count, alpha, minS, maxS, rnd) {
    rnd = rnd || R;
    for (let i = 0; i < count; i++) {
      const x = rnd() * W, y = rnd() * H;
      const rx = minS + rnd() * (maxS - minS), ry = rx * (0.4 + rnd() * 0.9);
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      const a = alpha * (0.35 + rnd() * 0.65);
      g.addColorStop(0, color.replace('%A', a.toFixed(3)));
      g.addColorStop(1, color.replace('%A', '0'));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rnd() * Math.PI); ctx.scale(1, ry / rx);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function speckle(ctx, W, H, count, colorFn, rnd) {
    rnd = rnd || R;
    for (let i = 0; i < count; i++) {
      const s = 0.6 + rnd() * 2.4;
      ctx.fillStyle = colorFn(rnd());
      ctx.fillRect(rnd() * W, rnd() * H, s, s);
    }
  }
  function silk(ctx, text, x, y, size, opt) {
    opt = opt || {};
    ctx.save();
    ctx.translate(x, y);
    if (opt.rot) ctx.rotate(opt.rot);
    ctx.font = (opt.weight || '600') + ' ' + size + 'px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = opt.baseline || 'middle';
    ctx.fillStyle = opt.color || 'rgba(248,252,248,0.98)';
    if (opt.letterSpacing && ctx.letterSpacing !== undefined) ctx.letterSpacing = opt.letterSpacing;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function pads(ctx, x, y, cols, rows, pitch, pw, ph, color, hole) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const cx = x + i * pitch, cy = y + j * pitch;
      ctx.fillStyle = color || '#d8b45c';
      ctx.fillRect(cx, cy, pw, ph);
      if (hole !== false) {
        ctx.fillStyle = 'rgba(20,30,24,0.9)';
        ctx.beginPath(); ctx.arc(cx + pw / 2, cy + ph / 2, Math.min(pw, ph) * 0.26, 0, 7); ctx.fill();
      }
    }
  }

  /* ============================ 木板底座 ============================ */
  function woodTexture() {
    const W = 1024, H = 1024;
    const [c, ctx] = cv(W, H);
    ctx.fillStyle = '#241a13'; ctx.fillRect(0, 0, W, H);
    // 木纹
    for (let i = 0; i < 220; i++) {
      const y = R() * H;
      ctx.strokeStyle = 'rgba(' + (40 + R() * 44) + ',' + (28 + R() * 30) + ',' + (18 + R() * 22) + ',' + (0.10 + R() * 0.25) + ')';
      ctx.lineWidth = 0.6 + R() * 2.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const yy = y + Math.sin(x * 0.006 + i) * 5 + Math.sin(x * 0.021 + i * 3) * 1.6;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    mottle(ctx, W, H, 'rgba(92,64,38,%A)', 40, 0.30, 60, 220, R);
    mottle(ctx, W, H, 'rgba(10,7,5,%A)', 30, 0.35, 80, 260, R);
    // 表面轻微划痕
    speckle(ctx, W, H, 1600, () => 'rgba(255,235,200,' + (0.015 + R() * 0.05) + ')', R);
    const t = canvasTex(c, { repeat: [3, 2] });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ============================ 路面 & 路面标线 ============================ */
  // 路区：x0..x1, z0..z1（相对世界坐标，单位 cm）
  function roadTexture(opts) {
    const W = 4096, H = 2048;
    const [c, ctx] = cv(W, H);
    const x0 = opts.x0, x1 = opts.x1, z0 = opts.z0, z1 = opts.z1;
    const sx = W / (x1 - x0), sz = H / (z1 - z0);   // px per cm
    const X = (x) => (x - x0) * sx, Z = (z) => (z - z0) * sz;

    // 沥青底
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3a3d42'); g.addColorStop(0.5, '#33363b'); g.addColorStop(1, '#383b40');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 沥青颗粒
    for (let i = 0; i < 26000; i++) {
      const v = 30 + R() * 70;
      ctx.fillStyle = 'rgba(' + v + ',' + (v + 2) + ',' + (v + 4) + ',' + (0.10 + R() * 0.4) + ')';
      const s = 1 + R() * 3.4;
      ctx.fillRect(R() * W, R() * H, s, s * (0.5 + R()));
    }
    // 大块深浅补丁 / 压实痕迹
    for (let i = 0; i < 26; i++) {
      const px = R() * W, py = R() * H, rr = 60 + R() * 260;
      const rg = ctx.createRadialGradient(px, py, 0, px, py, rr);
      const dark = R() > 0.45;
      rg.addColorStop(0, dark ? 'rgba(12,14,16,0.30)' : 'rgba(120,124,130,0.16)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
    }
    // 轮胎压痕（沿路方向淡淡两道）
    for (const zc of [(z0 + z1) / 2 - 3.2, (z0 + z1) / 2 + 3.2]) {
      const grad = ctx.createLinearGradient(0, Z(zc - 1.2), 0, Z(zc + 1.2));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(10,12,14,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, Z(zc - 1.2), W, Z(zc + 1.2) - Z(zc - 1.2));
    }

    const white = '#e9e7e0', yellow = '#e2b53c';
    const cw = opts.crosswalk; // {x0,x1,bars,bar,gap}
    // 白色边线
    ctx.fillStyle = white;
    for (const zc of [z0 + 0.85, z1 - 0.85]) {
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, Z(zc - 0.11), W, Z(zc + 0.11) - Z(zc - 0.11));
    }
    // 斑马线
    ctx.globalAlpha = 0.95;
    const total = cw.bars * cw.bar + (cw.bars - 1) * cw.gap;
    let bx = (cw.x0 + cw.x1) / 2 - total / 2;
    for (let i = 0; i < cw.bars; i++) {
      ctx.fillStyle = white;
      ctx.fillRect(X(bx), Z(z0 + 0.55), cw.bar * sx, Z(z1 - 0.55) - Z(z0 + 0.55));
      // 磨损
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 22; k++) {
        ctx.globalAlpha = 0.05 + R() * 0.16;
        ctx.beginPath();
        ctx.ellipse(X(bx) + R() * cw.bar * sx, Z(z0) + R() * H, 2 + R() * 9, 2 + R() * 7, R() * 3, 0, 7);
        ctx.fill();
      }
      ctx.restore();
      bx += cw.bar + cw.gap;
    }
    // 黄色中心虚线
    ctx.globalAlpha = 0.92;
    const mid = (z0 + z1) / 2;
    for (let x = cw.x1 + 1.6; x < x1 - 1.2; x += 6.2) {
      ctx.fillStyle = yellow;
      const xx = X(x), yy = Z(mid - 0.28);
      ctx.fillRect(xx, yy, 3.6 * sx, Z(mid + 0.28) - yy);
    }
    // 停止线（斑马线右端）
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = white;
    ctx.fillRect(X(cw.x1 + 0.45), Z(mid + 0.35), 0.45 * sx, Z(z1 - 0.6) - Z(mid + 0.35));
    // 路面污渍 / 落叶
    ctx.globalAlpha = 1;
    for (let i = 0; i < 24; i++) {
      const px = R() * W, py = R() * H, rr = 8 + R() * 42;
      const rg = ctx.createRadialGradient(px, py, 0, px, py, rr);
      rg.addColorStop(0, 'rgba(15,17,18,0.22)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
    }
    return { tex: canvasTex(c, { aniso: 16 }), canvas: c, ctx: ctx };
  }

  /* ============================ 人行道砖 ============================ */
  function sidewalkTexture(wCm, dCm) {
    const W = 2048, H = Math.max(256, Math.round(2048 * dCm / wCm));
    const [c, ctx] = cv(W, H);
    const sx = W / wCm, sz = H / dCm;
    const base = ['#d8c795', '#e0d1a3', '#cdba85', '#d3c290', '#c9b67f'];
    // 底缝
    ctx.fillStyle = '#8d8064'; ctx.fillRect(0, 0, W, H);
    const bw = 1.15, bh = 1.15; // 砖尺寸 cm
    const gap = 0.11;
    for (let row = 0, z = 0; z < dCm; row++, z += bh) {
      const off = (row % 2) * bw * 0.5;
      for (let x = -bw; x < wCm + bw; x += bw) {
        const px = (x + off) * sx, py = z * sz;
        const col = base[Math.floor(R() * base.length)];
        ctx.fillStyle = col;
        ctx.fillRect(px + gap * sx * 0.5, py + gap * sz * 0.5, (bw - gap) * sx, (bh - gap) * sz);
        // 单砖明暗
        const g2 = ctx.createLinearGradient(px, py, px + bw * sx, py + bh * sz);
        g2.addColorStop(0, 'rgba(255,255,255,0.10)');
        g2.addColorStop(1, 'rgba(60,45,20,0.14)');
        ctx.fillStyle = g2;
        ctx.fillRect(px + gap * sx * 0.5, py + gap * sz * 0.5, (bw - gap) * sx, (bh - gap) * sz);
        // 砖面颗粒
        for (let k = 0; k < 18; k++) {
          ctx.fillStyle = 'rgba(' + (120 + R() * 90) + ',' + (105 + R() * 80) + ',' + (60 + R() * 60) + ',0.12)';
          ctx.fillRect(px + R() * bw * sx, py + R() * bh * sz, 1 + R() * 2, 1 + R() * 2);
        }
      }
    }
    // 整体脏迹
    mottle(ctx, W, H, 'rgba(60,48,26,%A)', 60, 0.16, 24, 120, R);
    const t = canvasTex(c, { aniso: 16 });
    return t;
  }

  /* ============================ 金属网格（透明） ============================ */
  function meshTexture(cellsX, cellsY) {
    const W = 1024, H = Math.max(64, Math.round(1024 * cellsY / cellsX * 0.9));
    const [c, ctx] = cv(W, H);
    ctx.clearRect(0, 0, W, H);
    const w = W / cellsX, h = H / cellsY;
    ctx.strokeStyle = '#4a4a44';
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.16);
    for (let i = 0; i <= cellsX; i++) {
      ctx.beginPath(); ctx.moveTo(i * w, 0); ctx.lineTo(i * w, H); ctx.stroke();
    }
    for (let j = 0; j <= cellsY; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * h); ctx.lineTo(W, j * h); ctx.stroke();
    }
    // 高光
    ctx.strokeStyle = 'rgba(210,210,200,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= cellsX; i++) {
      ctx.beginPath(); ctx.moveTo(i * w - 1, 0); ctx.lineTo(i * w - 1, H); ctx.stroke();
    }
    const t = canvasTex(c, { repeat: [1, 1] });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ============================ 围栏铁网（透明） ============================ */
  function fenceTexture() {
    const W = 512, H = 256;
    const [c, ctx] = cv(W, H);
    ctx.clearRect(0, 0, W, H);
    const cells = 8;
    const w = W / cells;
    ctx.strokeStyle = '#3b3733';
    ctx.lineWidth = 26;
    for (let i = 0; i <= cells; i++) { ctx.beginPath(); ctx.moveTo(i * w, 0); ctx.lineTo(i * w, H); ctx.stroke(); }
    ctx.lineWidth = 14;
    for (let j = 0; j <= 4; j++) { ctx.beginPath(); ctx.moveTo(0, j * H / 4); ctx.lineTo(W, j * H / 4); ctx.stroke(); }
    // 金属高光
    ctx.strokeStyle = 'rgba(150,140,125,0.25)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= cells; i++) { ctx.beginPath(); ctx.moveTo(i * w - 7, 0); ctx.lineTo(i * w - 7, H); ctx.stroke(); }
    // 锈迹
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = 'rgba(' + (110 + R() * 70) + ',' + (68 + R() * 40) + ',' + (38 + R() * 25) + ',' + (0.15 + R() * 0.45) + ')';
      ctx.fillRect(R() * W, R() * H, 2 + R() * 10, 2 + R() * 6);
    }
    const t = canvasTex(c, { repeat: [1, 1] });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ============================ 光敏电阻（硫化镉盘） ============================ */
  function ldrTexture() {
    const S = 256;
    const [c, ctx] = cv(S, S);
    ctx.fillStyle = '#e6dcc4'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(S * 0.42, S * 0.36, 6, S / 2, S / 2, S * 0.52);
    g.addColorStop(0, '#d9cda9'); g.addColorStop(1, '#a8957a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.47, 0, 7); ctx.fill();
    // 梳状电极
    ctx.strokeStyle = '#5a4a34'; ctx.lineWidth = 7;
    for (let i = 0; i < 7; i++) {
      const x = S * 0.22 + i * S * 0.09;
      ctx.beginPath();
      ctx.moveTo(x, S * 0.2);
      ctx.lineTo(x, S * (i % 2 ? 0.52 : 0.8));
      ctx.stroke();
    }
    ctx.strokeStyle = '#4c3e2c'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(S * 0.2, S * 0.2); ctx.lineTo(S * 0.2, S * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(S * 0.8, S * 0.2); ctx.lineTo(S * 0.8, S * 0.8); ctx.stroke();
    return canvasTex(c, { aniso: 4 });
  }

  /* ============================ PCB 主板 ============================ */
  function pcbTexture() {
    const PPC = 108; // px per cm
    const W = Math.round(LAYOUT.pcb.w * PPC), H = Math.round(LAYOUT.pcb.h * PPC);
    const [c, ctx] = cv(W, H);
    const X = (x) => (x + LAYOUT.pcb.w / 2) * PPC;
    const Z = (z) => (z + LAYOUT.pcb.h / 2) * PPC;

    // 基板
    ctx.fillStyle = '#0c7f3e'; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, 'rgba(9,88,44,%A)', 90, 0.5, 30, 150, R);
    mottle(ctx, W, H, 'rgba(30,140,74,%A)', 60, 0.35, 20, 90, R);
    // 铜箔走线
    const trace = (pts, w, alpha) => {
      ctx.strokeStyle = 'rgba(70,190,120,' + (alpha || 0.35) + ')';
      ctx.lineWidth = w || 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1])));
      ctx.stroke();
    };
    // 走线网络（手工布置，避免被模块遮挡区域）
    const nets = [
      [[-8.9, 4.9], [-8.9, 3.6], [-7.6, 2.3], [-5.4, 2.3], [-4.6, 1.5]],
      [[-8.9, -4.9], [-8.9, -3.4], [-7.4, -2.0], [-6.0, -2.0]],
      [[-4.0, 4.9], [-3.2, 4.1], [-3.2, 2.4], [-1.6, 2.4], [-1.6, 1.2]],
      [[0.0, 4.9], [0.0, 4.2], [1.1, 4.2], [1.1, 2.9]],
      [[3.0, 4.9], [3.0, 4.1], [4.0, 4.1], [4.0, 2.9]],
      [[5.9, 4.9], [5.9, 4.0], [5.3, 3.4], [5.3, 2.9]],
      [[8.9, 4.0], [8.9, 2.7], [8.0, 1.9], [8.0, 0.6]],
      [[8.9, -3.0], [8.9, -4.4], [7.8, -4.9]],
      [[-3.0, -4.9], [-2.6, -4.2], [-1.1, -4.2], [-0.3, -3.4]],
      [[-5.9, -4.9], [-5.6, -4.4], [-4.4, -4.4], [-3.8, -3.9]],
      [[3.4, -4.9], [3.4, -3.9], [2.6, -3.4], [2.6, -2.4]],
      [[-9.2, 1.2], [-7.9, 1.2], [-7.2, 0.6], [-5.6, 0.6]],
      [[-9.2, -1.0], [-8.4, -1.0], [-8.0, -0.4], [-6.9, -0.4], [-6.4, -1.0]],
      [[4.4, 1.9], [4.4, 0.9], [3.4, 0.9]],
      [[-2.4, 2.2], [-2.4, 1.2], [-1.4, 1.2]],
      [[1.8, -2.1], [1.8, -1.4], [2.4, -1.4]],
      [[0.2, -4.9], [0.2, -3.4], [0.8, -2.9]]
    ];
    nets.forEach(n => { trace(n, 3.4, 0.16); trace(n, 1.8, 0.4); });

    // 过孔
    for (let i = 0; i < 220; i++) {
      const px = 12 + R() * (W - 24), py = 12 + R() * (H - 24);
      ctx.fillStyle = '#caa64e';
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(8,40,22,0.95)';
      ctx.beginPath(); ctx.arc(px, py, 1.0, 0, 7); ctx.fill();
    }

    // 模块焊盘区（排针孔）
    function headerPads(cx, cz, cols, rows, pitch, horiz) {
      const pw = X(cx), pz = Z(cz);
      const s = pitch * PPC, pr = 0.05 * PPC;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const px = pw + (horiz ? i : j) * s - (horiz ? (cols - 1) * s / 2 : (rows - 1) * s / 2);
        const py = pz + (horiz ? j : i) * s - (horiz ? (rows - 1) * s / 2 : (cols - 1) * s / 2);
        ctx.fillStyle = '#d3ae57';
        ctx.beginPath(); ctx.arc(px, py, pr * 1.55, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(12,44,26,0.95)';
        ctx.beginPath(); ctx.arc(px, py, pr * 0.8, 0, 7); ctx.fill();
      }
    }
    // ESP 底座排针
    headerPads(LAYOUT.esp.x, LAYOUT.esp.z + 1.15, 8, 1, 0.25, true);
    headerPads(LAYOUT.esp.x, LAYOUT.esp.z - 1.15, 8, 1, 0.25, true);
    // 蓝板（STM32）两侧排针
    headerPads(LAYOUT.pill.x, LAYOUT.pill.z + 1.02, 20, 1, 0.25, true);
    headerPads(LAYOUT.pill.x, LAYOUT.pill.z - 1.02, 20, 1, 0.25, true);
    // 声音模块、OLED、驱动板排针
    headerPads(LAYOUT.sound.x, LAYOUT.sound.z, 1, 4, 0.25, false);
    headerPads(LAYOUT.oled.x, LAYOUT.oled.z - 1.35, 4, 1, 0.25, true);
    headerPads(LAYOUT.driver.x, LAYOUT.driver.z, 2, 1, 0.5, true);
    // 继电器模块排针
    headerPads(LAYOUT.relay.x - 1.35, LAYOUT.relay.z, 1, 3, 0.25, false);
    // 光敏电阻与电阻
    ctx.fillStyle = '#d3ae57';
    ctx.beginPath(); ctx.arc(X(LAYOUT.ldr.x - 0.55), Z(LAYOUT.ldr.z - 0.6), 0.09 * PPC, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(X(LAYOUT.ldr.x + 0.55), Z(LAYOUT.ldr.z - 0.6), 0.09 * PPC, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(12,44,26,0.95)';
    ctx.beginPath(); ctx.arc(X(LAYOUT.ldr.x - 0.55), Z(LAYOUT.ldr.z - 0.6), 0.04 * PPC, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(X(LAYOUT.ldr.x + 0.55), Z(LAYOUT.ldr.z - 0.6), 0.04 * PPC, 0, 7); ctx.fill();

    // 丝印：标题（板边竖排）
    silk(ctx, '基于STM32智能路灯控制系统设计与实现', X(-8.85), Z(-3.5), 21, { rot: Math.PI / 2, color: 'rgba(238,246,240,0.95)' });
    silk(ctx, '智能光控 · 物联网 · 自适应调光', X(-8.42), Z(-3.3), 13, { rot: Math.PI / 2, color: 'rgba(238,246,240,0.72)' });
    silk(ctx, 'SMART STREET LIGHT CTRL BOARD', X(-7.98), Z(-3.2), 11, { rot: Math.PI / 2, color: 'rgba(238,246,240,0.55)', weight: '500' });

    // 丝印：模块标注
    silk(ctx, 'ESP8266', X(-8.3), Z(-1.3), 15);
    silk(ctx, '无线通信', X(-8.3), Z(-1.75), 12, { color: 'rgba(238,246,240,0.7)' });
    silk(ctx, 'STM32F103C8T6', X(1.2), Z(1.55), 14);
    silk(ctx, '主控 MCU', X(1.2), Z(1.95), 12, { color: 'rgba(238,246,240,0.7)' });
    silk(ctx, '继电器输出', X(5.30), Z(-1.5), 12.5);
    silk(ctx, 'OLED 显示', X(-6.1), Z(5.2), 12.5);
    silk(ctx, '声控采集', X(-8.35), Z(0.7), 12.5);
    silk(ctx, '路灯驱动', X(0.3), Z(5.55), 12.5);
    silk(ctx, 'KEY1     KEY2     KEY3     KEY4', X(-1.3), Z(-3.6), 11, { color: 'rgba(238,246,240,0.68)' });
    silk(ctx, '光照检测', X(8.2), Z(1.35), 14, { rot: Math.PI / 2, color: 'rgba(238,246,240,0.95)' });
    silk(ctx, 'ADC1', X(8.2), Z(-0.55), 10, { rot: Math.PI / 2, color: 'rgba(238,246,240,0.6)' });

    // 丝印箭头指向光敏电阻
    ctx.strokeStyle = 'rgba(240,248,242,0.8)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(X(8.2), Z(2.2)); ctx.lineTo(X(8.2), Z(2.8)); ctx.lineTo(X(8.0), Z(2.66)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(8.2), Z(2.8)); ctx.lineTo(X(8.4), Z(2.66)); ctx.stroke();

    // 元件外框
    ctx.strokeStyle = 'rgba(240,248,242,0.65)'; ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    // 继电器区
    ctx.strokeRect(X(5.0), Z(-4.5), 3.3 * PPC, 2.5 * PPC);
    ctx.setLineDash([]);

    // 电源区标注
    silk(ctx, '5V', X(-9.0), Z(-0.2), 12);
    silk(ctx, '3.3V', X(-9.0), Z(0.3), 12);
    silk(ctx, 'GND', X(-9.0), Z(0.8), 12);

    // 四角安装孔 + 螺丝
    for (const [sx, sz] of LAYOUT.screws) {
      const px = X(sx), py = Z(sz);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(px, py, 0.36 * PPC, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(235,242,236,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 0.28 * PPC, 0, 7); ctx.stroke();
    }
    // 板名标签
    silk(ctx, 'REV 1.0   2024', X(6.2), Z(-5.3), 10, { color: 'rgba(238,246,240,0.5)' });
    // 元件位号 & 引脚标注
    silk(ctx, 'R1', X(-7.2), Z(-0.2), 9, { color: 'rgba(240,248,242,0.55)' });
    silk(ctx, 'R2', X(-6.6), Z(-0.2), 9, { color: 'rgba(240,248,242,0.55)' });
    silk(ctx, 'C1', X(-5.4), Z(0.9), 9, { color: 'rgba(240,248,242,0.55)' });
    silk(ctx, 'C2', X(-4.9), Z(0.7), 9, { color: 'rgba(240,248,242,0.55)' });
    silk(ctx, 'U3', X(4.4), Z(-1.4), 9, { color: 'rgba(240,248,242,0.55)' });
    silk(ctx, 'SW1', X(-1.0), Z(-4.2), 8, { color: 'rgba(240,248,242,0.5)' });
    silk(ctx, 'SW2', X(0.9), Z(-4.2), 8, { color: 'rgba(240,248,242,0.5)' });
    silk(ctx, 'SW3', X(2.8), Z(-4.2), 8, { color: 'rgba(240,248,242,0.5)' });
    silk(ctx, 'SW4', X(4.7), Z(-4.2), 8, { color: 'rgba(240,248,242,0.5)' });
    // 引脚标注（蓝板两侧排针）
    for (let i = 0; i < 8; i++) {
      silk(ctx, 'P' + (i + 1), X(-6.8 + i * 1.2), Z(2.35), 7, { color: 'rgba(240,248,242,0.4)', align: 'center' });
    }
    // 板边定位刻度
    ctx.strokeStyle = 'rgba(240,248,242,0.35)'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(X(-9.05), Z(-4.6 + i * 1.2));
      ctx.lineTo(X(-9.3), Z(-4.6 + i * 1.2));
      ctx.stroke();
    }

    const t = canvasTex(c, { aniso: 16 });
    return t;
  }

  /* ============================ 模块板卡 ============================ */
  function boardBase(ctx, W, H, base, traceColor) {
    // 渐变底
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, base); g.addColorStop(1, shade(base, -14));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, 'rgba(0,0,0,%A)', 18, 0.16, 30, 120, R);
    // 走线（横竖 45° 直角）
    ctx.strokeStyle = traceColor || 'rgba(150,205,255,0.26)';
    for (let i = 0; i < 22; i++) {
      const horizontal = R() > 0.4;
      ctx.lineWidth = 1.4 + R() * 2.2;
      const x0 = 10 + R() * W * 0.35, y0 = 12 + R() * H * 0.7;
      const len = 40 + R() * W * 0.4;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + len, y0);
        if (R() > 0.5) { ctx.lineTo(x0 + len + 12, y0 + 12); ctx.lineTo(Math.min(W - 8, x0 + len + 12 + R() * 100), y0 + 12); }
      } else {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y0 + len);
        if (R() > 0.5) { ctx.lineTo(x0 + 12, y0 + len + 12); ctx.lineTo(x0 + 12, Math.min(H - 8, y0 + len + 12 + R() * 60)); }
      }
      ctx.stroke();
    }
    // 焊盘 / 过孔
    for (let i = 0; i < 90; i++) {
      const px = 8 + R() * (W - 16), py = 8 + R() * (H - 16);
      const viasmall = R() > 0.35;
      if (viasmall) {
        ctx.fillStyle = 'rgba(214,182,98,0.95)';
        ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(6,14,30,0.92)';
        ctx.beginPath(); ctx.arc(px, py, 1.0, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = '#d8b45c';
        ctx.fillRect(px, py, 9, 6);
        ctx.fillStyle = 'rgba(6,14,30,0.85)';
        ctx.fillRect(px + 2, py + 2, 5, 2);
      }
    }
    // 板边丝印白框
    ctx.strokeStyle = 'rgba(238,244,255,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(9, 9, W - 18, H - 18);
    // 四角定位孔
    for (const [cx, cy] of [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18]]) {
      ctx.strokeStyle = 'rgba(235,242,250,0.6)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(4,8,18,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
    }
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, gg = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); gg = Math.max(0, Math.min(255, gg)); b = Math.max(0, Math.min(255, b));
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  // ESP8266 转接板（蓝色）
  function espBoardTexture() {
    const W = 512, H = 400;
    const [c, ctx] = cv(W, H);
    boardBase(ctx, W, H, '#164a9c', 'rgba(150,210,255,0.22)');
    silk(ctx, 'ESP8266', 26, 40, 34, { color: '#eef4ff' });
    silk(ctx, 'WiFi', 26, 84, 24, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, '3.3V', 26, H - 54, 22, { color: 'rgba(230,240,255,0.8)' });
    silk(ctx, 'TXD', 26, H - 24, 20, { color: 'rgba(230,240,255,0.65)' });
    // 排针焊盘
    pads(ctx, 300, 30, 1, 4, 44, 26, 26, '#d8b45c');
    pads(ctx, 300, H - 130, 1, 3, 44, 26, 26, '#d8b45c');
    return canvasTex(c);
  }

  function shieldTexture() {
    const W = 1024, H = 700;
    const [c, ctx] = cv(W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#d7d9d4'); g.addColorStop(0.45, '#b9bcb6'); g.addColorStop(1, '#9da09b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 金属拉丝
    for (let i = 0; i < 500; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.02 + R() * 0.06) + ')';
      ctx.lineWidth = 0.7;
      const y = R() * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // 蚀刻字
    ctx.strokeStyle = 'rgba(70,74,70,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    silk(ctx, 'ESP-12F', W / 2, H * 0.30, 64, { align: 'center', color: 'rgba(80,84,78,0.85)', weight: '700' });
    silk(ctx, 'AI-Thinker', W / 2, H * 0.52, 34, { align: 'center', color: 'rgba(90,94,88,0.7)', weight: '500' });
    silk(ctx, 'FCC ID: 2AHMR-ESP12F', W / 2, H * 0.66, 22, { align: 'center', color: 'rgba(90,94,88,0.5)', weight: '400' });
    // 屏蔽罩焊点
    ctx.fillStyle = 'rgba(150,152,146,0.9)';
    for (let i = 0; i < 6; i++) { ctx.fillRect(20 + i * (W - 40) / 5 - 6, H - 16, 12, 12); }
    return canvasTex(c);
  }

  // STM32 最小系统板（蓝板）
  function pillTexture() {
    const W = 1024, H = 444;
    const [c, ctx] = cv(W, H);
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#1b3f96'); base.addColorStop(1, '#15327c');
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, 'rgba(0,0,0,%A)', 26, 0.25, 16, 90, R);
    // 走线
    ctx.strokeStyle = 'rgba(120,180,255,0.20)'; ctx.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const y = 60 + R() * (H - 120);
      ctx.beginPath(); ctx.moveTo(60 + R() * 200, y); ctx.lineTo(300 + R() * 200, y + (R() - 0.5) * 30); ctx.stroke();
    }
    // 引脚焊盘
    const pitch = W / 23.2;
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = '#d8b45c';
      ctx.fillRect(38 + i * pitch, 26, pitch * 0.55, 22);
      ctx.fillRect(38 + i * pitch, H - 48, pitch * 0.55, 22);
      ctx.fillStyle = 'rgba(10,20,50,0.85)';
      ctx.fillRect(38 + i * pitch + pitch * 0.16, 32, pitch * 0.22, 10);
      ctx.fillRect(38 + i * pitch + pitch * 0.16, H - 42, pitch * 0.22, 10);
    }
    // 丝印
    silk(ctx, 'STM32F103C8T6', 200, 96, 30, { color: '#eef4ff' });
    silk(ctx, 'BOOT0', 92, 150, 17, { color: 'rgba(230,240,255,0.85)' });
    silk(ctx, 'BOOT1', 92, 180, 15, { color: 'rgba(230,240,255,0.6)' });
    silk(ctx, 'RESET', 250, 210, 17, { color: 'rgba(230,240,255,0.85)' });
    silk(ctx, 'U1', 470, 128, 13, { color: 'rgba(230,240,255,0.55)' });
    silk(ctx, 'Y1', 640, 128, 13, { color: 'rgba(230,240,255,0.55)' });
    silk(ctx, 'U2', 790, 128, 13, { color: 'rgba(230,240,255,0.55)' });
    silk(ctx, '3V3', 880, 200, 15, { color: 'rgba(230,240,255,0.8)' });
    silk(ctx, 'GND', 920, 200, 15, { color: 'rgba(230,240,255,0.8)' });
    silk(ctx, 'C8T6', 200, H - 84, 16, { color: 'rgba(230,240,255,0.5)' });
    // 4pin 排针焊盘
    pads(ctx, 880, 150, 1, 4, 26, 18, 18, '#d8b45c');
    // 芯片外框
    ctx.strokeStyle = 'rgba(235,245,255,0.55)'; ctx.lineWidth = 2;
    ctx.strokeRect(430, 150, 150, 150);
    ctx.strokeRect(660, 150, 120, 120);
    return canvasTex(c);
  }

  // OLED 模块（蓝板 + 屏幕由单独动态贴图负责）
  function oledBoardTexture() {
    const W = 512, H = 376;
    const [c, ctx] = cv(W, H);
    boardBase(ctx, W, H, '#174a9e', 'rgba(150,210,255,0.2)');
    silk(ctx, 'OLED', 22, 34, 28, { color: '#eef4ff' });
    silk(ctx, '0.96" I2C', 22, 66, 19, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, 'GND VCC SCL SDA', 22, H - 28, 17, { color: 'rgba(230,240,255,0.65)' });
    pads(ctx, 60, 130, 1, 4, 46, 26, 26, '#d8b45c');
    return canvasTex(c);
  }

  // 声音传感器板（蓝色）
  function soundBoardTexture() {
    const W = 512, H = 300;
    const [c, ctx] = cv(W, H);
    boardBase(ctx, W, H, '#153f8d', 'rgba(150,210,255,0.2)');
    silk(ctx, 'MIC', 300, 40, 30, { color: '#eef4ff' });
    silk(ctx, 'AO', 300, 90, 18, { color: 'rgba(230,240,255,0.8)' });
    silk(ctx, 'DO', 300, 118, 18, { color: 'rgba(230,240,255,0.8)' });
    silk(ctx, 'V1', 380, 40, 22, { color: 'rgba(230,240,255,0.55)' });
    silk(ctx, 'LM393', 60, 230, 20, { color: 'rgba(230,240,255,0.7)' });
    return canvasTex(c);
  }

  // 继电器模块板
  function relayBoardTexture() {
    const W = 512, H = 410;
    const [c, ctx] = cv(W, H);
    boardBase(ctx, W, H, '#123c86', 'rgba(150,210,255,0.2)');
    silk(ctx, '继电器', 22, 34, 26, { color: '#eef4ff' });
    silk(ctx, '5V', 22, 70, 18, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, 'IN', 80, 70, 18, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, 'GND', 140, 70, 18, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, 'COM NO NC', 260, H - 26, 18, { color: 'rgba(230,240,255,0.7)' });
    pads(ctx, 40, 130, 1, 3, 46, 26, 26, '#d8b45c');
    return canvasTex(c);
  }

  // 路灯驱动输出板
  function driverBoardTexture() {
    const W = 512, H = 420;
    const [c, ctx] = cv(W, H);
    boardBase(ctx, W, H, '#143f8c', 'rgba(150,210,255,0.2)');
    silk(ctx, '路灯驱动', 20, 34, 26, { color: '#eef4ff' });
    silk(ctx, 'OUT', 20, 70, 20, { color: 'rgba(230,240,255,0.75)' });
    silk(ctx, 'R100', 300, 120, 18, { color: 'rgba(230,240,255,0.6)' });
    silk(ctx, 'MOS', 300, 210, 20, { color: 'rgba(230,240,255,0.6)' });
    silk(ctx, 'GND  OUT+  VIN', 30, H - 26, 17, { color: 'rgba(230,240,255,0.65)' });
    return canvasTex(c);
  }

  /* ============================ OLED 显示内容 ============================ */
  function displayCanvas() {
    const W = 512, H = 256;
    const [c, ctx] = cv(W, H);
    return { canvas: c, ctx: ctx };
  }
  function drawDisplay(dc, data) {
    const { ctx } = dc, W = dc.canvas.width, H = dc.canvas.height;
    ctx.fillStyle = '#04070c'; ctx.fillRect(0, 0, W, H);
    // 像素网格感
    ctx.fillStyle = 'rgba(80,180,255,0.05)';
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
    const cyan = '#7fd8ff', white = '#e8f7ff', dim = 'rgba(160,220,255,0.55)';
    ctx.strokeStyle = 'rgba(120,210,255,0.8)'; ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    const font = (s) => s + 'px "PingFang SC","Microsoft YaHei",monospace';
    ctx.textBaseline = 'middle';
    // 标题
    ctx.fillStyle = white;
    ctx.font = '600 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('智能路灯控制系统', 22, 34);
    ctx.fillStyle = 'rgba(127,216,255,0.5)';
    ctx.fillRect(22, 54, W - 44, 2);
    // 光照值
    ctx.fillStyle = dim;
    ctx.font = '500 21px "PingFang SC",sans-serif';
    ctx.fillText('光照强度', 22, 92);
    ctx.fillStyle = cyan;
    ctx.font = '700 52px "PingFang SC","Helvetica Neue",sans-serif';
    const luxTxt = data.lux >= 1000 ? (data.lux / 1000).toFixed(1) + 'k' : Math.round(data.lux);
    ctx.fillText(luxTxt + ' lx', 130, 95);
    // 阈值
    ctx.fillStyle = dim; ctx.font = '500 20px "PingFang SC",sans-serif';
    ctx.fillText('阈值 ' + Math.round(data.threshold) + ' lx', 22, 148);
    // 状态
    const on = data.lampOn;
    ctx.fillStyle = on ? '#ffd27a' : 'rgba(150,170,190,0.7)';
    ctx.font = '700 40px "PingFang SC",sans-serif';
    ctx.fillText(on ? '路灯 已开启' : '路灯 已关闭', 22, 200);
    // 模式
    ctx.fillStyle = dim; ctx.font = '500 20px "PingFang SC",sans-serif';
    ctx.fillText(data.mode === 'auto' ? '模式: 自动' : '模式: 手动', 22, 234);
    // 右侧状态灯 / 迷你柱状
    ctx.fillStyle = on ? 'rgba(255,200,90,0.95)' : 'rgba(70,90,110,0.8)';
    ctx.beginPath(); ctx.arc(W - 44, 92, 17, 0, 7); ctx.fill();
    if (on) {
      const g = ctx.createRadialGradient(W - 44, 92, 2, W - 44, 92, 40);
      g.addColorStop(0, 'rgba(255,205,110,0.55)'); g.addColorStop(1, 'rgba(255,205,110,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W - 44, 92, 40, 0, 7); ctx.fill();
    }
    // 右上角图标：太阳/月亮
    ctx.font = '500 26px sans-serif';
    ctx.fillStyle = 'rgba(200,235,255,0.65)';
    ctx.textAlign = 'right';
    ctx.fillText(data.isNight ? '☾' : '☀', W - 26, 34);
    ctx.textAlign = 'left';
  }

  /* ============================ 光晕 & 星空贴图 ============================ */
  function glowTexture(inner, outer, power) {
    const S = 256;
    const [c, ctx] = cv(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = Math.pow(1 - t, power === undefined ? 2.4 : power);
      g.addColorStop(t, 'rgba(' + inner + ',' + a.toFixed(3) + ')');
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const t = canvasTex(c);
    return t;
  }
  function sunTexture() {
    const S = 512;
    const [c, ctx] = cv(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,250,1)');
    g.addColorStop(0.18, 'rgba(255,244,214,0.98)');
    g.addColorStop(0.32, 'rgba(255,214,150,0.5)');
    g.addColorStop(0.6, 'rgba(255,180,90,0.14)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return canvasTex(c);
  }
  function moonTexture() {
    const S = 512;
    const [c, ctx] = cv(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.02, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(240,246,255,1)');
    g.addColorStop(0.2, 'rgba(214,228,247,0.95)');
    g.addColorStop(0.26, 'rgba(170,195,230,0.35)');
    g.addColorStop(0.55, 'rgba(120,150,200,0.1)');
    g.addColorStop(1, 'rgba(90,120,180,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 16; i++) {
      const a = R() * 7, r = S * 0.06 + R() * S * 0.09;
      const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      ctx.fillStyle = 'rgba(150,170,200,0.5)';
      ctx.beginPath(); ctx.arc(x, y, S * 0.012 + R() * S * 0.03, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return canvasTex(c);
  }
  function starTexture() {
    const S = 64;
    const [c, ctx] = cv(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(210,230,255,0.7)');
    g.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return canvasTex(c);
  }
  function lightConeTexture() {
    const W = 128, H = 512;
    const [c, ctx] = cv(W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,220,160,0.55)');
    g.addColorStop(0.35, 'rgba(255,210,140,0.22)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(W * 0.5, 0);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    return canvasTex(c);
  }
  function radialShadowTexture() {
    const S = 256;
    const [c, ctx] = cv(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return canvasTex(c);
  }

  /* ============================ 导出 ============================ */
  return {
    LAYOUT,
    woodTexture, roadTexture, sidewalkTexture, meshTexture, fenceTexture,
    ldrTexture, pcbTexture, espBoardTexture, shieldTexture, pillTexture,
    oledBoardTexture, soundBoardTexture, relayBoardTexture, driverBoardTexture,
    displayCanvas, drawDisplay,
    glowTexture, sunTexture, moonTexture, starTexture, lightConeTexture, radialShadowTexture
  };
})();
