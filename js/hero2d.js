// 把一张静态立绘画成「会动的 2D 人物」。
// 做法：把图画到 canvas 上，但每帧按一个位移场重画一次网格——
// 上半身（头面那块）左右轻摆、胸口呼吸起伏、裙摆跟着飘。
// 因为位移场是连续的，图像会被平滑拉伸，不会像分层剪纸那样出现接缝或鬼影。

const COLS = 12;
const ROWS = 18;

export function createHero2D({ canvas, src }) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const img = new Image();
  img.decoding = 'async';

  let W = 0;          // canvas 设备像素宽
  let H = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let ready = false;
  let stopped = false;
  let t0 = performance.now();

  const geom = { dx: 0, dy: 0, dw: 0, dh: 0 };

  function layout() {
    const box = canvas.parentElement.getBoundingClientRect();
    const bw = Math.max(1, box.width);
    const bh = Math.max(1, box.height);
    // 画布比舞台大一圈，给点击动作（旋转/拉伸）留余量，避免裁角
    const pad = 1.1;
    const cw = Math.round(bw * pad);
    const ch = Math.round(bh * pad);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.round(cw * dpr);
    H = Math.round(ch * dpr);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';

    // 注意：要按「舞台」的尺寸来缩放人物，而不是按放大后的画布
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    // FIT<1：给顶部标题留一点空隙，别让头冠顶到文字上
    const FIT = 0.95;
    const s = Math.min((bw * dpr) / iw, (bh * dpr) / ih) * FIT;
    geom.dw = iw * s;
    geom.dh = ih * s;
    geom.dx = (W - geom.dw) / 2;
    const wrapBottom = ((ch + bh) / 2) * dpr;   // 舞台底边在画布里的坐标
    geom.dy = wrapBottom - geom.dh;             // 脚底贴舞台底
  }

  // 头部权重：越靠上越大；颈部以下迅速衰减
  function headW(v) {
    const k = Math.max(0, Math.min(1, (0.66 - v) / 0.66));
    return k * k;
  }

  // 裙摆权重：越靠下越大
  function skirtW(v) {
    const k = Math.max(0, Math.min(1, (v - 0.72) / 0.28));
    return k * k;
  }

  function draw(now) {
    if (!ready || stopped) return;
    const t = (now - t0) / 1000;

    const sway = Math.sin(t * 1.15) * 0.0075;          // 头面左右摆（相对图宽）
    const breathe = Math.sin(t * 1.55) * 0.0045;       // 呼吸起伏（相对图高）
    const hem = Math.sin(t * 1.9 + 1.2) * 0.0032;      // 裙摆

    const cw = geom.dw / COLS;
    const ch = geom.dh / ROWS;
    const padSrcX = (img.naturalWidth / COLS) * 0.06;
    const padSrcY = (img.naturalHeight / ROWS) * 0.06;
    const sw = img.naturalWidth / COLS;
    const sh = img.naturalHeight / ROWS;

    ctx.clearRect(0, 0, W, H);

    for (let j = 0; j < ROWS; j++) {
      const v0 = j / ROWS;
      const v1 = (j + 1) / ROWS;
      for (let i = 0; i < COLS; i++) {
        const u0 = i / COLS;
        const u1 = (i + 1) / COLS;

        const vMid = (v0 + v1) / 2;
        const uMid = (u0 + u1) / 2;
        const hw = headW(vMid);
        const sw2 = skirtW(vMid);

        const dxp =
          geom.dw * (sway * hw + sway * 0.22 * (1 - hw) + hem * sw2 * Math.sin(uMid * 3.1 + t * 0.8));
        const dyp = -geom.dh * breathe * Math.sin(Math.PI * Math.min(1, vMid * 1.35));

        ctx.drawImage(
          img,
          i * sw - padSrcX, j * sh - padSrcY, sw + padSrcX * 2, sh + padSrcY * 2,
          geom.dx + u0 * geom.dw + dxp - 0.5, geom.dy + v0 * geom.dh + dyp - 0.5,
          cw + 1, ch + 1
        );
      }
    }

    requestAnimationFrame(draw);
  }

  const api = {
    ready: null,
    setSrc(url) {
      ready = false;
      return new Promise((res) => {
        img.onload = () => {
          ready = true;
          layout();
          res();
        };
        img.onerror = () => res();
        img.src = url;
      });
    },
    relayout() {
      if (ready) layout();
    },
    start() {
      stopped = false;
      t0 = performance.now();
      requestAnimationFrame(draw);
    },
    stop() {
      stopped = true;
    },
  };

  api.ready = api.setSrc(src);
  if (typeof ResizeObserver === 'function') {
    // 舞台高度会变（气泡打字变高、软键盘、旋转屏幕），一变就重新算一次
    let pend = false;
    const relayoutSoon = () => {
      if (pend) return;
      pend = true;
      requestAnimationFrame(() => {
        pend = false;
        api.relayout();
      });
    };
    const ro = new ResizeObserver(relayoutSoon);
    ro.observe(canvas.parentElement);
    api._ro = ro;
  }
  window.addEventListener('resize', () => api.relayout());
  window.addEventListener('orientationchange', () => setTimeout(api.relayout, 120));

  return api;
}
