# schema-constellation

**Um schema PostgreSQL vira uma constelação em 3D — e uma documentação por domínio.**

```bash
npx schema-constellation render schema.sql --relations relations.yml --out docs/
```

Abre `docs/schema-3d.html`: cada tabela é um diamante solto no espaço, cada relação é um
arco que sai e entra pela face do diamante, e as tabelas do mesmo domínio se agrupam por
força — não por grade.

---

## Por que existe

Ferramentas de diagrama de schema desenham tudo num plano: tabelas em caixas, linhas
cruzando. Funciona até ~20 tabelas. Depois vira emaranhado.

Esta usa as três dimensões de propósito:

| Ideia | Como |
|---|---|
| **Domínio é gravidade** | tabelas do mesmo assunto se atraem e formam bolsões |
| **Relação é mola** | quem tem FK fica perto |
| **Repulsão** | evita que tudo colapse num ponto |
| **Altura livre** | os arcos saem e entram em qualquer direção, não só para cima |
| **Sem chão** | não há placa por domínio; o que existe é a posição no espaço |

O resultado é determinístico: mesma entrada, mesmas posições. A semente vem do nome da
tabela, então roda igual em qualquer máquina.

---

## O problema que ela resolve e as outras não

Num **data mart**, as relações quase nunca existem no banco. Elas moram no modelo
semântico — Power BI, dbt, LookML. O banco é um monte de tabelas soltas.

Uma ferramenta que só lê o DDL desenha **doze ilhas sem ligação nenhuma**.

O `schema-constellation` aceita as relações declaradas num arquivo separado, e — o ponto
importante — **distingue declarada de imposta**:

```yaml
relations:
  - from: fato_venda.cidade_id
    to: dim_cidade.cidade_id
    enforced: true          # existe constraint no banco
    why: "A cidade do contrato. Dela sai a regional vigente no mês."

  - from: fato_venda.pedido_id
    to: dim_pedido.pedido_id
    enforced: false         # declarada; o banco não tem FK
    why: "O contrato ativado. Grão é contrato × OS."
```

| `enforced` | O que o programa faz |
|---|---|
| `true` | desenha o arco **e** roda os checks de constraint (índice, on-delete, cardinalidade) |
| `false` | desenha o arco, **não** roda check de constraint |

Sem essa distinção a ferramenta mente: ela reporta *"toda exclusão em `dim_cidade` varre
`fato_venda`"* para uma constraint que não existe.

---

## Rodando em 10 segundos

Sem banco, sem configuração — com o exemplo que está no repo:

```bash
npm ci
node bin/cli.mjs render examples/mini.sql --relations examples/mini.relations.yml --out docs
node bin/cli.mjs open docs/schema-3d.html
```

`examples/mini.sql` tem uma dimensão, um calendário e um fato. É o mesmo schema que o CI
usa no smoke test.

## O que sai

```
docs/
├── schema-3d.html       a constelação, autocontida, abre com dois cliques
├── index.html           documentação navegável, com os achados inline
├── README.md            índice markdown e convenções
├── FINDINGS.md          a revisão de desenho, com o SQL de correção
├── erd.svg              o diagrama plano, para quem prefere
├── schema-map.svg       a constelação vista de cima
└── dominios/
    ├── <dominio>.md     tabela de colunas, notas e a lista de relações com o porquê
    └── <dominio>.svg
```

Cada coluna documentada no YAML do dbt (ou num `COMMENT ON`) aparece na coluna **Notes**
da documentação. Sem isso a página mostra tipo e FK e nada mais.

---

## Instalação

Requer **Node 24+**.

```bash
git clone https://github.com/<voce>/schema-constellation
cd schema-constellation && npm ci
node bin/cli.mjs render schema.sql --relations relations.yml --out docs/
```

---

## Os três verbos

### `dump` — pega o schema do banco

```bash
node bin/cli.mjs dump --url postgres://user@host:5432/db --schema marts --out schema.sql
```

Chama o `pg_dump --schema-only` e já remove o ruído de owner e privilégio.

### `render` — gera a constelação e a documentação

```bash
node bin/cli.mjs render schema.sql \
  --relations relations.yml \
  --narratives narratives.json \
  --out docs/
```

| Opção | Para quê |
|---|---|
| `--relations` | as relações declaradas (`enforced: true\|false`) |
| `--narratives` | domínios, convenções e o porquê de cada relação |
| `--fail-on` | `error` (padrão), `warn`, `info`, `never` — para usar em CI |
| `--layout` | `constellation` (padrão) ou `ring` (o layout plano original) |

### `open` — abre o resultado

```bash
node bin/cli.mjs open docs/schema-3d.html
```

---

## A configuração: `relations.yml`

```yaml
domains:
  - key: tempo
    title: Tempo
    tables: [dim_calendario]
  - key: fatos
    title: Fatos
    tables: [fato_venda, fato_pedido]

relations:
  - from: fato_venda.data
    to: dim_calendario.data
    enforced: false
    why: "O mês da execução. Toda análise é por competência."
```

### Dispensar um achado com motivo

```yaml
accepted:
  - check: primary-key
    table: fato_venda
    why: Fato sem chave natural única: o grão é pedido × item.
```

A dispensa **exige** o `why`. Sem ele o achado não é dispensado e o programa avisa —
porque dispensa sem motivo é a forma mais silenciosa de esconder um problema.

O domínio é o que vira **ilha** e o que dá a **cor**. Sem ele, tudo é uma nuvem só.

O `why` não é enfeite: ele aparece na lista de relações e é o que sobrevive quando alguém
novo abre o modelo. Uma relação sem motivo é uma relação que alguém vai quebrar.

---

## Os checks

24 verificações determinísticas. As que mais aparecem num mart:

| Achado | Severidade | O que pega |
|---|---|---|
| `primary-key` | erro | tabela sem chave primária |
| `fk-index` | aviso | coluna de FK sem índice (**só se `enforced: true`**) |
| `cardinality` | erro/aviso | 1:1 modelado como 1:N, ou relação declarada sem FK |
| `natural-key` | erro | chave de negócio sem `UNIQUE` |
| `fk-cycle` | aviso | dependência circular |
| `money-float` | erro | valor monetário em ponto flutuante |
| `wide-table` | nota | 30 colunas ou mais |

---

## Testes

```bash
npm test
```

Cobrem o parser do `relations.yml` e o merge. Inclui um caso de **CRLF**: a última entrada
do arquivo sumia quando o editor gravava em Windows, porque o `.` do regex não cruza `\r`.
Reverter a correção faz esse teste falhar — o que é a definição de um teste útil.

O CI roda os testes e um **render de ponta a ponta** do exemplo, conferindo que o
`schema-3d.html` sai com mais de 500 KB e sem nenhuma referência a `http`.

## Crédito

Derivado do [**ArchLens Postgres**](https://github.com/greenstevester/archlens-postgres)
(MIT), de *greenstevester* — o parser, os 24 checks e a documentação são dele. O layout de
constelação, o diamante, os arcos radiais e o `enforced` são deste projeto.

A licença original está preservada em [`LICENSE`](LICENSE).

---

## Licença

MIT.
