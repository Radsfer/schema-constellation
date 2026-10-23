// Testes do parser e do merge. O objetivo é pegar o tipo de bug que não aparece
// no uso normal: CRLF de editor Windows, comentário no meio, tabela que não existe.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRelationsYaml,
  schemasOf,
  mergeRelations,
  buildNarratives,
} from '../src/relations.mjs';

const YAML = `# comentário de topo
domains:
  - key: tempo
    title: "Tempo"
    tables: [dim_calendario]

  - key: fatos
    title: "Fatos"
    blurb: Os fatos do modelo.
    tables:
      - fato_venda
      - fato_pedido

relations:
  # a declaração abaixo não é imposta pelo banco
  - from: fato_venda.data
    to: dim_calendario.data
    enforced: false
    why: O mês a que o registro pertence.

  - from: fato_venda.cidade_id
    to: dim_cidade.cidade_id
    enforced: true
    why: A cidade do registro.

  - from: fato_pedido.data
    to: dim_calendario.data
    enforced: false

conventions:
  - Valores monetários são NUMERIC.
  - Datas são DATE, sem fuso.

accepted:
  - check: primary-key
    table: fato_venda
    why: Fato sem chave natural única.
`;

const DDL = `
CREATE TABLE dimensoes.dim_calendario (data date PRIMARY KEY);
CREATE TABLE dimensoes.dim_cidade (cidade_id integer PRIMARY KEY);
CREATE TABLE fatos.fato_venda (data date, cidade_id integer);
CREATE TABLE fatos.fato_pedido (data date);
`;

// ---------------------------------------------------------------- parser

test('lê domínios, relações, convenções e dispensas', () => {
  const c = parseRelationsYaml(YAML);
  assert.equal(c.domains.length, 2);
  assert.equal(c.relations.length, 3);
  assert.equal(c.conventions.length, 2);
  assert.equal(c.accepted.length, 1);
});

test('array inline e array em lista dão o mesmo resultado', () => {
  const c = parseRelationsYaml(YAML);
  assert.deepEqual(c.domains[0].tables, ['dim_calendario']);
  assert.deepEqual(c.domains[1].tables, ['fato_venda', 'fato_pedido']);
});

test('enforced vira booleano, não string', () => {
  const c = parseRelationsYaml(YAML);
  assert.equal(c.relations[0].enforced, false);
  assert.equal(c.relations[1].enforced, true);
});

test('aspas são removidas do valor', () => {
  const c = parseRelationsYaml(YAML);
  assert.equal(c.domains[0].title, 'Tempo');
});

test('comentário no meio não quebra o bloco', () => {
  const c = parseRelationsYaml(YAML);
  assert.equal(c.relations[0].why, 'O mês a que o registro pertence.');
});

// o bug que passou: o '.' do regex não cruza \r, e a última linha sumia
test('tolera CRLF — a última entrada não pode desaparecer', () => {
  const crlf = YAML.replace(/\n/g, '\r\n');
  const c = parseRelationsYaml(crlf);
  const ultima = c.relations[c.relations.length - 1];
  assert.equal(c.relations.length, 3);
  assert.equal(ultima.enforced, false);
  assert.equal(c.accepted[0].why, 'Fato sem chave natural única.');
});

// ---------------------------------------------------------------- schema

test('mapeia tabela para o schema do DDL', () => {
  const s = schemasOf(DDL);
  assert.equal(s.get('dim_calendario'), 'dimensoes');
  assert.equal(s.get('fato_venda'), 'fatos');
});

test('tabela sem schema vira public', () => {
  const s = schemasOf('CREATE TABLE solta (id int);');
  assert.equal(s.get('solta'), 'public');
});

// ---------------------------------------------------------------- merge

test('enforced: false gera constraint com prefixo decl_', () => {
  const c = parseRelationsYaml(YAML);
  const { sql, naoImpostas } = mergeRelations(DDL, c);
  assert.match(sql, /ADD CONSTRAINT decl_fk_fato_venda_data /);
  assert.equal(naoImpostas.length, 2);
  assert.ok(naoImpostas.some((n) => n.coluna === 'data'));
});

test('enforced: true gera constraint sem prefixo', () => {
  const c = parseRelationsYaml(YAML);
  const { sql } = mergeRelations(DDL, c);
  assert.match(sql, /ADD CONSTRAINT fk_fato_venda_cidade_id /);
  assert.doesNotMatch(sql, /decl_fk_fato_venda_cidade_id/);
});

test('a constraint aponta para o schema correto dos dois lados', () => {
  const c = parseRelationsYaml(YAML);
  const { sql } = mergeRelations(DDL, c);
  assert.match(sql, /ALTER TABLE ONLY fatos\.fato_venda/);
  assert.match(sql, /REFERENCES dimensoes\.dim_calendario\(data\)/);
});

test('relação cuja tabela não está no DDL é ignorada', () => {
  const c = parseRelationsYaml(YAML);
  const soVenda = 'CREATE TABLE fatos.fato_venda (data date, cidade_id integer);';
  const { naoImpostas } = mergeRelations(soVenda, c);
  assert.equal(naoImpostas.length, 0);
});

// ---------------------------------------------------------------- narratives

test('só relação com why entra nas assertions', () => {
  const c = parseRelationsYaml(YAML);
  const n = buildNarratives(c, {});
  assert.equal(n.assertions.cardinality.length, 2); // a terceira não tem why
  assert.equal(n.assertions.cardinality[0].parent, 'dim_calendario');
  assert.equal(n.assertions.cardinality[0].child, 'fato_venda');
  assert.deepEqual(n.assertions.cardinality[0].columns, ['data']);
});

test('dispensa sem why é descartada', () => {
  const sem = `${YAML}\n  - check: fk-index\n    table: fato_pedido\n`;
  const c = parseRelationsYaml(sem);
  const n = buildNarratives(c, {});
  assert.equal(n.assertions.accepted.length, 1); // só a que tem why
});

test('os domínios preservam a ordem do arquivo', () => {
  const c = parseRelationsYaml(YAML);
  const n = buildNarratives(c, {});
  assert.deepEqual(n.domains.map((d) => d.key), ['tempo', 'fatos']);
});

test('convenções vão para o narratives', () => {
  const c = parseRelationsYaml(YAML);
  const n = buildNarratives(c, {});
  assert.equal(n.conventions.length, 2);
});
