// relations.mjs — o diferencial do schema-constellation.
//
// Num data mart as relações vivem no modelo semântico (Power BI, dbt), não no banco.
// Este módulo lê um relations.yml, anexa as relações ao DDL para que o motor as desenhe,
// e guarda quais delas são APENAS declaradas — para que os checks de constraint não
// mintam sobre uma FK que não existe.

import fs from 'node:fs';
import path from 'node:path';

/** Lê o YAML sem dependência: aceita o subconjunto que o arquivo usa. */
export function parseRelationsYaml(text) {
  const out = { domains: [], relations: [], conventions: [], accepted: [] };
  let bloco = null;      // 'domains' | 'relations' | 'conventions'
  let item = null;
  let sub = null;

  for (const bruta of text.split(/\r?\n/)) {   // CRLF de editor Windows nao pode quebrar o parse
    const linha = bruta.replace(/\t/g, '  ');
    const semComentario = linha.replace(/#.*$/, '');
    if (!semComentario.trim()) continue;

    const topo = semComentario.match(/^([a-z_]+):\s*$/);
    if (topo) { bloco = topo[1]; item = null; sub = null; continue; }

    if (bloco === 'conventions' && /^\s*-\s+/.test(semComentario)) {
      out.conventions.push(semComentario.replace(/^\s*-\s+/, '').trim());
      continue;
    }

    if (bloco === 'domains' || bloco === 'relations' || bloco === 'accepted') {
      const inicio = semComentario.match(/^\s*-\s+(\w+):\s*(.*)$/);
      if (inicio) {
        item = { [inicio[1]]: limpa(inicio[2]) };
        out[bloco].push(item);
        sub = null;
        continue;
      }
      if (!item) continue;
      const lista = semComentario.match(/^\s+(\w+):\s*$/);
      if (lista) { sub = lista[1]; item[sub] = []; continue; }
      const par = semComentario.match(/^\s+(\w+):\s*(.*)$/);
      if (par) { item[par[1]] = limpa(par[2]); sub = null; continue; }
      const cont = semComentario.match(/^\s*-\s+(.*)$/);
      if (cont && sub) { item[sub].push(limpa(cont[1])); continue; }
      if (sub === 'tables' && semComentario.trim()) item.tables.push(limpa(semComentario));
    }
  }
  return out;
}

function limpa(v) {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => limpa(x)).filter(Boolean);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

/** Mapa nome da tabela -> schema, lido do DDL. */
export function schemasOf(sql) {
  const map = new Map();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
  let m;
  while ((m = re.exec(sql))) map.set(m[2], m[1] || 'public');
  return map;
}

/** Normaliza `tabela.coluna` em `{ tabela, coluna }`. */
function split(ref) {
  const [tabela, coluna] = String(ref).split('.');
  return { tabela, coluna };
}

/**
 * Anexa as relações ao DDL. Toda relação vira uma constraint para o motor conseguir
 * desenhar o arco — inclusive as não impostas. É a lista `naoImpostas` que impede os
 * checks de constraint de rodarem sobre elas.
 */
export function mergeRelations(sql, cfg) {
  const schemas = schemasOf(sql);
  const doSchema = (t) => schemas.get(t) || 'public';
  const linhas = [sql.trimEnd(), '', '-- Relações declaradas (podem não existir no banco)', ''];
  const naoImpostas = [];

  for (const r of cfg.relations) {
    if (!r.from || !r.to) continue;
    const a = split(r.from);
    const b = split(r.to);
    if (!schemas.has(a.tabela) || !schemas.has(b.tabela)) continue;

    // O prefixo decl_ avisa o motor: esta FK e declarada, nao imposta.
    // Sem isso os checks de constraint reclamariam de um banco que nao tem FK.
    const prefixo = r.enforced === false ? 'decl_' : '';
    const nome = `${prefixo}fk_${a.tabela}_${a.coluna}`;
    linhas.push(
      `ALTER TABLE ONLY ${doSchema(a.tabela)}.${a.tabela}\n` +
      `    ADD CONSTRAINT ${nome} FOREIGN KEY (${a.coluna}) ` +
      `REFERENCES ${doSchema(b.tabela)}.${b.tabela}(${b.coluna});\n`,
    );
    if (r.enforced === false) naoImpostas.push({ tabela: a.tabela, coluna: a.coluna, nome });
  }
  return { sql: linhas.join('\n'), naoImpostas };
}

/** Monta o narratives.json que o motor consome. */
export function buildNarratives(cfg, meta = {}) {
  const dominios = (cfg.domains || []).map((d) => ({
    key: d.key,
    title: d.title || d.key,
    blurb: d.blurb || '',
    tenant_scoped: d.tenant_scoped === true,
    tables: Array.isArray(d.tables) ? d.tables : [],
  }));

  return {
    database: {
      title: meta.title || 'Modelo de dados',
      blurb: meta.blurb || '',
    },
    conventions: cfg.conventions || [],
    domains: dominios,
    assertions: {
      require_relationship_notes: Boolean(meta.requireWhy),
      // aceitar um achado exige motivo; a ferramenta recusa dispensa sem why
      accepted: (cfg.accepted || [])
        .filter((a) => a.check && a.table && a.why)
        .map((a) => ({ check: a.check, table: a.table, columns: [], why: a.why })),
      cardinality: (cfg.relations || [])
        .filter((r) => r.why)
        .map((r) => {
          const a = split(r.from);
          const b = split(r.to);
          return {
            parent: b.tabela,
            child: a.tabela,
            columns: [a.coluna],
            expect: r.cardinality || '1:N',
            why: r.why,
          };
        }),
    },
  };
}

export function readRelations(file) {
  return parseRelationsYaml(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
