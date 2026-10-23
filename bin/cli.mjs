#!/usr/bin/env node
// schema-constellation — CLI
//
//   schema-constellation render schema.sql --relations relations.yml --out docs/
//   schema-constellation dump --url postgres://... --schema marts --out schema.sql
//   schema-constellation open docs/modelo-3d.html

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRelations, mergeRelations, buildNarratives, writeJson } from '../src/relations.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(AQUI, '..', 'src', 'engine', 'archlens.ts');

function ajuda() {
  console.log(`
schema-constellation

  render <schema.sql> [opções]     gera a constelação e a documentação
  dump   --url <conn> [opções]     pega o schema do banco com pg_dump
  open   <schema-3d.html>          abre o resultado no navegador

render
  --relations <file>     relations.yml com domínios e relações (enforced: true|false)
  --narratives <file>    narratives.json pronto (alternativa ao relations.yml)
  --out <dir>            onde escrever (padrão: docs/)
  --fail-on <sev>        error | warn | info | never  (padrão: error)

dump
  --url <conn>           string de conexão do PostgreSQL
  --schema <nome>        um ou mais schemas, separados por vírgula
  --out <file>           arquivo de saída (padrão: schema.sql)
`);
}

function opcoes(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const chave = a.slice(2);
      const proximo = argv[i + 1];
      if (proximo && !proximo.startsWith('--')) { o[chave] = proximo; i += 1; }
      else o[chave] = true;
    } else if (!o._) o._ = a;
  }
  return o;
}

// ---------- render
function render(argv) {
  const o = opcoes(argv);
  const schema = o._;
  if (!schema) { console.error('falta o schema.sql'); process.exit(2); }
  if (!fs.existsSync(schema)) { console.error(`nao encontrei ${schema}`); process.exit(2); }

  const out = o.out || 'docs';
  let sql = fs.readFileSync(schema, 'utf8');
  let narratives = null;
  const temporarios = [];

  if (o.relations) {
    const cfg = readRelations(o.relations);
    const mesclado = mergeRelations(sql, cfg);
    sql = mesclado.sql;
    narratives = buildNarratives(cfg, { title: o.title || 'Modelo de dados', blurb: o.blurb || '' });
    console.error(`  ${cfg.domains.length} domínios · ${cfg.relations.length} relações `
      + `(${mesclado.naoImpostas.length} declaradas, ${cfg.relations.length - mesclado.naoImpostas.length} impostas)`);
  }

  // O DDL mesclado vai para <out>/schema.sql: e o que gerou o diagrama, e permite
  // reproduzir sem refazer o merge. O rodape do HTML mostra esse caminho.
  fs.mkdirSync(out, { recursive: true });
  const ddl = path.join(out, 'schema.sql');
  fs.writeFileSync(ddl, sql);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-'));

  let nar = o.narratives;
  if (!nar && narratives) {
    nar = path.join(tmp, 'narratives.json');
    writeJson(nar, narratives);
    temporarios.push(nar);
  }

  const args = [ENGINE, ddl, '--out', out, '--fail-on', o['fail-on'] || 'error'];
  if (nar) args.push('--narratives', nar);

  let codigo = 0;
  try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  } catch (e) {
    codigo = typeof e.status === 'number' ? e.status : 1;
  } finally {
    for (const f of temporarios) { try { fs.rmSync(f, { force: true }); } catch { /* noop */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  }

  const html = path.join(out, 'schema-3d.html');
  if (fs.existsSync(html)) console.error(`\n  constelação: ${html}`);
  process.exit(codigo);
}

// ---------- dump
function dump(argv) {
  const o = opcoes(argv);
  if (!o.url) { console.error('falta --url'); process.exit(2); }
  const saida = o.out || 'schema.sql';
  const arg = ['--schema-only', '--no-owner', '--no-privileges', '--format=plain'];
  if (o.schema) for (const s of String(o.schema).split(',')) arg.push(`--schema=${s.trim()}`);
  arg.push(`--file=${saida}`, o.url);
  try {
    execFileSync('pg_dump', arg, { stdio: 'inherit' });
    const tamanho = (fs.statSync(saida).size / 1024).toFixed(1);
    console.error(`  ${saida} (${tamanho} KB)`);
  } catch {
    console.error('pg_dump falhou — ele precisa estar no PATH');
    process.exit(1);
  }
}

// ---------- open
function abrir(argv) {
  const alvo = argv[0] || path.join('docs', 'schema-3d.html');
  if (!fs.existsSync(alvo)) { console.error(`nao encontrei ${alvo}`); process.exit(2); }
  const url = `file:///${path.resolve(alvo).replace(/\\/g, '/')}`;
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { execFileSync(cmd, [url], { stdio: 'ignore' }); } catch { /* explorer sai com 1 sempre */ }
  console.error(`  ${url}`);
}

const [comando, ...resto] = process.argv.slice(2);
if (!comando || comando === '-h' || comando === '--help') { ajuda(); process.exit(0); }
if (comando === 'render') render(resto);
else if (comando === 'dump') dump(resto);
else if (comando === 'open') abrir(resto);
else { console.error(`comando desconhecido: ${comando}`); ajuda(); process.exit(2); }
