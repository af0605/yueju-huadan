import { buildIndex, match, pick } from './chat.js';
import { IP, ipEntries } from './kb-ip.js';
import { createHero2D } from './hero2d.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const el = {
  stage: $('#stage-wrap'),
  hero: $('#hero'),
  heroWrap: $('#heroWrap'),
  boot: $('#boot'),
  bootText: $('#bootText'),
  log: $('#log'),
  chips: $('#chips'),
  form: $('#askForm'),
  input: $('#askInput'),
  btn: $('#askBtn'),
  name: $('#ipName'),
  sub: $('#ipSub'),
  tip: $('#stageTip'),
  halo: $('.halo'),
  turn: $('#turn'),
};

let index = [];
let busy = false;
let reactCool = 0;
let hero2d = null;

/* 三视图：正面 → 侧面 → 背面 */
const VIEWS = [
  { key: 'front', file: 'hero_front', label: '正面' },
  { key: 'side', file: 'hero_side', label: '侧面' },
  { key: 'back', file: 'hero_back', label: '背面' },
];
let viewIdx = 0;

/* 手机不一定支持 webp，能支持就用小得多的那份 */
const SUPPORT_WEBP = (() => {
  try {
    return document.createElement('canvas').toDataURL('image/webp').indexOf('webp') > 0;
  } catch (e) {
    return false;
  }
})();

const heroUrl = (file) => `assets/${file}.${SUPPORT_WEBP ? 'webp' : 'png'}`;

async function json(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

function setBoot(text, pct) {
  if (text) el.bootText.textContent = text;
  const bar = el.boot.querySelector('.bar-inner');
  if (bar && typeof pct === 'number') bar.style.width = Math.round(pct * 100) + '%';
}

/* ---------------- 小动作 ---------------- */

const ACTS = ['act-hop', 'act-wiggle', 'act-tilt', 'act-jump2', 'act-squash', 'act-wave'];
const TAP_ACTS = ACTS.slice();
const REPLY_ACTS = ['act-hop', 'act-squash'];
let lastAct = -1;

function playAct(list) {
  let i = Math.floor(Math.random() * list.length);
  if (list === TAP_ACTS && i === lastAct) i = (i + 1) % list.length;
  if (list === TAP_ACTS) lastAct = i;
  el.hero.classList.remove(...ACTS);
  void el.hero.offsetWidth;
  el.hero.classList.add(list[i]);
}

/* 回答问题时轻轻点一下头 */
function hop() {
  playAct(REPLY_ACTS);
}

/* 点她时溅起几点光 */
function sparkles() {
  const hb = el.heroWrap.getBoundingClientRect();
  const sb = el.stage.getBoundingClientRect();
  if (!hb.width) return;
  const colors = ['#f992a2', '#efe0b8', '#ffffff', '#e46a80'];
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.style.left = hb.left - sb.left + hb.width * (0.12 + Math.random() * 0.76) + 'px';
    s.style.top = hb.top - sb.top + hb.height * (0.1 + Math.random() * 0.55) + 'px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', (Math.random() * 70 - 35).toFixed(0) + 'px');
    s.style.setProperty('--dy', (-55 - Math.random() * 75).toFixed(0) + 'px');
    s.style.setProperty('--rot', (Math.random() * 360 - 180).toFixed(0) + 'deg');
    s.style.animationDelay = (Math.random() * 140).toFixed(0) + 'ms';
    el.stage.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}

/* 换一面：正 → 侧 → 背 */
async function turn() {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  const v = VIEWS[viewIdx];
  el.turn.title = v.label;
  el.hero.classList.add('swap');
  await sleep(200);
  if (hero2d) await hero2d.setSrc(heroUrl(v.file));
  await sleep(70);
  el.hero.classList.remove('swap');
}

/* 点她时说的话：洗一副牌，轮完再洗，绝不连着重复 */
let reactDeck = [];
let lastReact = '';

function nextReactLine() {
  const all = IP.react && IP.react.length ? IP.react : ['怎么啦？'];
  if (!reactDeck.length) {
    reactDeck = all.filter((s) => s !== lastReact);
    if (!reactDeck.length) reactDeck = all.slice();
    for (let i = reactDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [reactDeck[i], reactDeck[j]] = [reactDeck[j], reactDeck[i]];
    }
  }
  const line = reactDeck.pop();
  lastReact = line;
  return line;
}

/* 点她：俏皮动作 + 溅光点 + 反问你「要干嘛」 */
function poke() {
  el.tip.classList.add('hide');
  playAct(TAP_ACTS);
  sparkles();
  const now = Date.now();
  if (now - reactCool < 1500 || busy) return;
  reactCool = now;
  const wrap = typing();
  const bubble = wrap.querySelector('.bubble');
  setTimeout(async () => {
    bubble.textContent = '';
    await typeInto(bubble, nextReactLine(), 34);
  }, 280);
}

/* -------------------- 消息渲染 -------------------- */

function bubbleEl(role) {
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (role === 'me' ? ' me' : '');
  if (role !== 'me') {
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = (IP.name || '花')[0];
    wrap.appendChild(who);
  }
  const b = document.createElement('div');
  b.className = 'bubble';
  wrap.appendChild(b);
  return { wrap, bubble: b };
}

function scrollLog() {
  el.log.scrollTop = el.log.scrollHeight + 400;
}

function addMine(text) {
  const { wrap, bubble } = bubbleEl('me');
  bubble.textContent = text;
  el.log.appendChild(wrap);
  scrollLog();
}

function typing() {
  const { wrap, bubble } = bubbleEl('ip');
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  el.log.appendChild(wrap);
  scrollLog();
  return wrap;
}

function swatches(rows) {
  const box = document.createElement('div');
  box.className = 'swatches';
  const max = Math.max(...rows.map((r) => r.ratio)) || 1;
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'sw';
    row.innerHTML = `
      <span class="dot" style="background:${r.hex}"></span>
      <span class="nm">${r.name}<span class="track"><span class="fill" data-w="${Math.round(
        (r.ratio / 100) * 100 * 1
      )}%"></span></span></span>
      <span class="pct">${r.ratio}%</span>`;
    box.appendChild(row);
  });
  requestAnimationFrame(() => {
    box.querySelectorAll('.fill').forEach((f) => {
      f.style.width = f.dataset.w;
    });
  });
  return box;
}

async function typeInto(node, text, speed = 26) {
  let i = 0;
  node.textContent = '';
  while (i < text.length) {
    const step = text[i] === '\n' ? 1 : 1;
    node.textContent = text.slice(0, i + step);
    i += step;
    if (text[i - 1] === '\n' || /[。！？，]/.test(text[i - 1] || '')) {
      await sleep(speed * 3.2);
    } else {
      await sleep(speed);
    }
    scrollLog();
  }
  node.textContent = text;
  scrollLog();
}

async function reply(entry) {
  hop();
  const wrap = typing();
  const bubble = wrap.querySelector('.bubble');
  await sleep(380 + Math.min(700, (entry.a || '').length * 6));
  bubble.textContent = '';
  await typeInto(bubble, entry.a || '');
  if (entry.swatches) {
    bubble.appendChild(document.createTextNode('\n'));
    bubble.appendChild(swatches(entry.swatches));
    scrollLog();
  }
}

/* -------------------- 问答 -------------------- */

const FALLBACKS = [
  '这个我还没学会，别考我。\n要不你换个说法？或者问问我身上这顶冠。',
  '嗯……这个真答不上来。\n我只懂粤剧那点事，还有我自己这身行头。',
  '你问得有点偏，我接不住。\n粤剧的来历、唱腔、头面、剧目，这些我能聊。',
];

function fallbackEntry() {
  const a = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  return { id: '__fallback', a, keys: [] };
}

async function ask(text) {
  const q = (text || '').trim();
  if (!q || busy) return;
  busy = true;
  el.btn.disabled = true;

  addMine(q);
  el.input.value = '';
  el.input.blur();

  const hit = match(index, q);
  await reply(hit ? hit.entry : fallbackEntry());

  if (!hit) {
    const s = pick(index, 3, new Set(['ip_hello', 'ip_bye']));
    if (s.length) {
      await sleep(160);
      const tip = document.createElement('div');
      tip.className = 'msg';
      tip.innerHTML = `<div class="who">${(IP.name || '花')[0]}</div><div class="bubble">要不你问这些试试：<br>${s
        .map((e) => '· ' + e.q)
        .join('<br>')}</div>`;
      el.log.appendChild(tip);
      scrollLog();
    }
  }

  busy = false;
  el.btn.disabled = false;
}

/* -------------------- 快捷问题 -------------------- */

function renderChips(list) {
  el.chips.innerHTML = '';
  list.forEach((q) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = q;
    b.addEventListener('click', () => ask(q));
    el.chips.appendChild(b);
  });
}

/* -------------------- 启动 -------------------- */

async function boot() {
  el.name.textContent = IP.name;
  el.sub.textContent = IP.sub;
  document.title = IP.name + ' · ' + IP.sub;

  setBoot('正在上妆…', 0.06);

  let palette = null;
  let kb = null;
  try {
    palette = await json('assets/palette.json');
  } catch (e) {
    console.warn('palette 没读到', e);
  }
  try {
    kb = await json('assets/kb_cantonese.json');
  } catch (e) {
    console.warn('粤剧知识库没读到', e);
  }

  const entries = [...ipEntries];

  // 用真实统计出来的配比，生成"发冠颜色"这一条
  if (palette && Array.isArray(palette.crown_grouped) && palette.crown_grouped.length) {
    const rows = palette.crown_grouped.filter((r) => r.ratio >= 0.1);
    const top = rows
      .slice(0, 3)
      .map((r) => `${r.name} ${r.ratio}%`)
      .join('、');
    entries.push({
      id: 'crown_palette',
      tags: ['配色', '颜色', '发冠'],
      keys: [
        '颜色配比', '颜色比例', '配色', '几个颜色', '都有什么颜色', '什么颜色',
        '为什么粉', '发冠颜色', '冠的颜色', '颜色怎么配', '主色', '色卡', '潘通',
        '颜色搭配', '色调',
      ],
      q: '发冠的颜色配比是怎样的？',
      a: `我按画稿面积数过一遍：${top}，剩下的都是点睛用的小色块。\n主色是水粉，红只落在宝石和纹样上，蓝和米金少得可怜——正因为少，才看得见。`,
      swatches: rows,
    });
  }

  if (kb && Array.isArray(kb.entries)) {
    entries.push(...kb.entries);
  }

  index = buildIndex(entries);
  setBoot('正在搭台…', 0.42);

  hero2d = createHero2D({ canvas: el.hero, src: heroUrl('hero_front') });
  await hero2d.ready;
  hero2d.start();
  el.turn.title = VIEWS[0].label;

  setBoot('开锣', 1);
  await sleep(220);
  el.boot.classList.add('gone');

  const { wrap, bubble } = bubbleEl('ip');
  el.log.appendChild(wrap);
  scrollLog();
  await typeInto(bubble, IP.greeting, 22);

  renderChips(IP.chips || []);
  setTimeout(() => el.tip.classList.add('hide'), 3600);

  // 空闲时把侧面/背面悄悄下好，点「转身」不卡
  setTimeout(() => {
    VIEWS.slice(1).forEach((v) => {
      const im = new Image();
      im.src = heroUrl(v.file);
    });
  }, 1500);
}

/* -------------------- 事件 -------------------- */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  ask(el.input.value);
});

el.input.addEventListener('focus', () => {
  setTimeout(scrollLog, 260);
});

el.turn.addEventListener('click', () => {
  el.tip.classList.add('hide');
  turn();
});

el.hero.addEventListener('pointerdown', poke, { passive: true });
el.hero.addEventListener('animationend', () => el.hero.classList.remove(...ACTS));

// 手指滑动 / 滚轮也算上手了，把提示收掉
el.stage.addEventListener('pointermove', () => el.tip.classList.add('hide'), { passive: true, once: true });
el.stage.addEventListener('wheel', () => el.tip.classList.add('hide'), { passive: true, once: true });

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) el.tip.classList.add('hide');
});

boot();
