// 本地问答匹配：关键词 + 字符二元组相似度。不联网，不走模型。
const PUNCT = /[\s，。！？、,.!?~～…—\-_:：;；"'“”‘’()（）\[\]【】《》<>\/\\|]+/g;

export const norm = (s) => (s || '').toLowerCase().replace(PUNCT, '');

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const k = s.slice(i, i + 2);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function dice(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let ta = 0;
  let tb = 0;
  A.forEach((v) => (ta += v));
  B.forEach((v) => (tb += v));
  A.forEach((v, k) => {
    if (B.has(k)) inter += Math.min(v, B.get(k));
  });
  return ta + tb ? (2 * inter) / (ta + tb) : 0;
}

export function buildIndex(entries) {
  return entries
    .filter((e) => e && e.a)
    .map((e) => ({
      ...e,
      _keys: (e.keys || []).map(norm).filter((k) => k.length >= 1),
      _tags: (e.tags || []).map(norm).filter((k) => k.length >= 1),
      _q: norm(e.q || ''),
    }));
}

export function match(index, raw) {
  const t = norm(raw);
  if (!t) return null;

  let best = null;
  let bestScore = 0;

  for (const e of index) {
    let sc = 0;
    for (const k of e._keys) {
      if (t.includes(k)) {
        sc += 1.5 + Math.min(k.length, 8) * 0.22;
      } else if (k.includes(t) && t.length >= 2) {
        sc += 0.55;
      }
    }
    for (const tag of e._tags) {
      if (t.length >= 2 && t.includes(tag)) sc += 0.4;
    }
    sc += dice(t, e._q) * 1.1;
    if (sc > bestScore) {
      bestScore = sc;
      best = e;
    }
  }

  const threshold = t.length <= 3 ? 1.15 : 0.95;
  if (!best || bestScore < threshold) return null;
  return { entry: best, score: bestScore };
}

export function pick(index, n, exclude) {
  const pool = index.filter((e) => !exclude || !exclude.has(e.id));
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
