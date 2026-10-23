// schema-3d-layout.js — posicoes por FORCA em 3D (constelacao).
//
// Substitui o anel plano original por um solver de forca:
//   - repulsao entre todas as tabelas
//   - mola nas ligacoes (quem tem FK fica perto)
//   - coesao por dominio (clusteriza)
//   - gravidade fraca para nao voar
// Tudo deterministico: a semente vem do nome da tabela.

export const CARD = { w: 1.8, d: 1.1, h: 0.16, stepX: 3.6, stepZ: 2.4, pad: 1.6 };
export const ISLAND_GAP = 2.6;

/** Longest parent chain above each table; a cycle is cut where it closes. */
export function depths(model) {
  const parentsOf = new Map(model.tables.map((t) => [t.name, []]));
  for (const fk of model.fks) {
    if (parentsOf.has(fk.child) && parentsOf.has(fk.parent) && fk.child !== fk.parent) parentsOf.get(fk.child).push(fk.parent);
  }
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (n) => {
    if (depth.has(n)) return depth.get(n);
    if (visiting.has(n)) return 0;
    visiting.add(n);
    const d = parentsOf.get(n).reduce((m, p) => Math.max(m, depthOf(p) + 1), 0);
    visiting.delete(n);
    depth.set(n, d);
    return d;
  };
  for (const t of model.tables) depthOf(t.name);
  return depth;
}

/** Hash estavel -> [0,1). Mesma entrada, mesmas posicoes em toda execucao. */
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Constelacao: cada tabela e um no solto no espaco, posicionado por forca.
 *   repulsao   todas contra todas (Coulomb)
 *   mola       cada FK puxa os dois lados para ~4.4 unidades
 *   dominio    cada tabela e puxada para o centroide do seu dominio
 *   gravidade  puxao fraca para a origem, para o conjunto nao se dispersar
 */
export function layout(model) {
  const names = model.tables.map((t) => t.name);
  const idx = new Map(names.map((n, i) => [n, i]));
  const N = names.length;
  const domOf = new Map(model.tables.map((t) => [t.name, t.domain]));
  const keys = model.domains.map((d) => d.key);
  const kOf = (n) => Math.max(0, keys.indexOf(domOf.get(n)));

  // ---- posicoes iniciais: esfera, cada dominio numa fatia
  const P = names.map((n) => {
    const a = ((kOf(n) + seedOf(n) * 0.8) / Math.max(1, keys.length)) * Math.PI * 2;
    const r = 7 + seedOf(`${n}r`) * 5;
    const el = (seedOf(`${n}y`) - 0.5) * 2.2;
    return { x: Math.cos(a) * r, y: el * r * 0.55, z: Math.sin(a) * r };
  });

  const E = model.fks
    .filter((f) => idx.has(f.child) && idx.has(f.parent) && f.child !== f.parent)
    .map((f) => [idx.get(f.child), idx.get(f.parent)]);

  const REP = 16;       // repulsao
  const SPRING = 0.12;  // rigidez da mola
  const LEN = 4.5;      // comprimento de repouso
  const DOM = 0.45;     // coesao de dominio
  const GRAV = 0.010;   // gravidade

  for (let it = 0; it < 900; it += 1) {
    const F = P.map(() => ({ x: 0, y: 0, z: 0 }));

    for (let i = 0; i < N; i += 1) {
      for (let j = i + 1; j < N; j += 1) {
        let dx = P[i].x - P[j].x;
        let dy = P[i].y - P[j].y;
        let dz = P[i].z - P[j].z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.04) {
          dx = seedOf(`${names[i]}${j}`) - 0.49;
          dy = seedOf(`${names[j]}${i}`) - 0.49;
          dz = seedOf(`${names[i]}${names[j]}`) - 0.49;
          d2 = dx * dx + dy * dy + dz * dz || 0.01;
        }
        const d = Math.sqrt(d2);
        const f = REP / d2;
        F[i].x += (dx / d) * f; F[i].y += (dy / d) * f; F[i].z += (dz / d) * f;
        F[j].x -= (dx / d) * f; F[j].y -= (dy / d) * f; F[j].z -= (dz / d) * f;
      }
    }

    for (const [a, b] of E) {
      const dx = P[b].x - P[a].x;
      const dy = P[b].y - P[a].y;
      const dz = P[b].z - P[a].z;
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const f = SPRING * (d - LEN);
      F[a].x += (dx / d) * f; F[a].y += (dy / d) * f; F[a].z += (dz / d) * f;
      F[b].x -= (dx / d) * f; F[b].y -= (dy / d) * f; F[b].z -= (dz / d) * f;
    }

    const cen = new Map(keys.map((k) => [k, { x: 0, y: 0, z: 0, n: 0 }]));
    for (let i = 0; i < N; i += 1) {
      const c = cen.get(domOf.get(names[i]));
      c.x += P[i].x; c.y += P[i].y; c.z += P[i].z; c.n += 1;
    }
    for (const c of cen.values()) if (c.n) { c.x /= c.n; c.y /= c.n; c.z /= c.n; }

    for (let i = 0; i < N; i += 1) {
      const c = cen.get(domOf.get(names[i]));
      F[i].x += (c.x - P[i].x) * DOM;
      F[i].y += (c.y - P[i].y) * DOM;
      F[i].z += (c.z - P[i].z) * DOM;
      F[i].x -= P[i].x * GRAV;
      F[i].y -= P[i].y * GRAV;
      F[i].z -= P[i].z * GRAV;
    }

    const damp = 0.55;
    for (let i = 0; i < N; i += 1) {
      P[i].x += F[i].x * damp;
      P[i].y += F[i].y * damp;
      P[i].z += F[i].z * damp;
    }
  }

  // ---- normaliza a escala da cena pelo percentil 90 das distancias.
  // Pelo maximo, um no isolado encolheria o resto do conjunto.
  const dists = P.map((p) => Math.hypot(p.x, p.y, p.z)).sort((a, b) => a - b);
  const p90 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] || 1;
  const k = 12 / Math.max(p90, 1);
  for (const p of P) { p.x *= k; p.y *= k; p.z *= k; }
  // centraliza no centroide para a camera enquadrar
  const cg = P.reduce((a, p) => ({ x: a.x + p.x / P.length, y: a.y + p.y / P.length, z: a.z + p.z / P.length }), { x: 0, y: 0, z: 0 });
  for (const p of P) { p.x -= cg.x; p.y -= cg.y; p.z -= cg.z; }

  const pos = {};
  names.forEach((n, i) => { pos[n] = { x: P[i].x, y: P[i].y, z: P[i].z }; });

  // ---- ilhas = centroide do dominio (so para titulo e legenda)
  const islands = model.domains.map((d) => {
    const ts = model.tables.filter((t) => t.domain === d.key).map((t) => t.name);
    if (!ts.length) return null;
    const cx = ts.reduce((s, n) => s + pos[n].x, 0) / ts.length;
    const cy = ts.reduce((s, n) => s + pos[n].y, 0) / ts.length;
    const cz = ts.reduce((s, n) => s + pos[n].z, 0) / ts.length;
    return { key: d.key, title: d.title, color: d.color, tables: ts,
      cols: 1, rows: 1, w: 0, d: 0, cx, cy, cz };
  }).filter(Boolean);

  const arcs = [];
  model.fks.forEach((fk, i) => {
    if (!pos[fk.child] || !pos[fk.parent]) return;
    if (fk.child === fk.parent) { arcs.push({ i, kind: 'self', lift: 2.2 }); return; }
    const inner = domOf.get(fk.child) === domOf.get(fk.parent);
    const dist = Math.hypot(pos[fk.child].x - pos[fk.parent].x,
      pos[fk.child].y - pos[fk.parent].y, pos[fk.child].z - pos[fk.parent].z);
    arcs.push({ i, kind: inner ? 'inner' : 'cross', lift: Math.min(1.6, 0.3 * dist) });
  });

  const radius = Math.max(...P.map((p) => Math.hypot(p.x, p.y, p.z)), 1);
  return { islands, pos, arcs, radius };
}
