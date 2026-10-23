-- Exemplo: um data mart pequeno, genérico, com quatro dimensões e três fatos.
-- Serve para o smoke test do CI e para ver a ferramenta rodando em 10 segundos.
--
-- Os nomes são de propósito genéricos: nenhum dado de cliente real aqui.

CREATE TABLE marts.dim_tempo (
    data        date PRIMARY KEY,
    ano         integer NOT NULL,
    mes         integer NOT NULL,
    dia_semana  text
);

CREATE TABLE marts.dim_cidade (
    cidade_id   integer PRIMARY KEY,
    cidade      text NOT NULL,
    uf          char(2)
);

CREATE TABLE marts.dim_produto (
    produto_id  integer PRIMARY KEY,
    produto     text NOT NULL,
    categoria   text
);

CREATE TABLE marts.dim_cliente (
    cliente_id  integer PRIMARY KEY,
    nome        text NOT NULL,
    segmento    text
);

CREATE TABLE marts.fato_venda (
    data        date    NOT NULL,
    cidade_id   integer NOT NULL,
    produto_id  integer NOT NULL,
    cliente_id  integer NOT NULL,
    quantidade  integer NOT NULL,
    valor       numeric(14,2) NOT NULL,
    CONSTRAINT uq_venda_grao UNIQUE (data, cidade_id, produto_id, cliente_id)
);

CREATE TABLE marts.fato_meta (
    data        date    NOT NULL,
    produto_id  integer NOT NULL,
    meta_valor  numeric(14,2) NOT NULL,
    CONSTRAINT uq_meta_grao UNIQUE (data, produto_id)
);

CREATE TABLE marts.fato_devolucao (
    data        date    NOT NULL,
    produto_id  integer NOT NULL,
    cliente_id  integer NOT NULL,
    motivo      text,
    valor       numeric(14,2) NOT NULL,
    CONSTRAINT uq_devolucao_grao UNIQUE (data, produto_id, cliente_id)
);

COMMENT ON TABLE marts.fato_venda IS 'Uma linha por venda.';
COMMENT ON COLUMN marts.fato_venda.valor IS 'Valor bruto da venda, sem imposto.';
COMMENT ON COLUMN marts.fato_venda.cidade_id IS 'Cidade em que a venda aconteceu.';
COMMENT ON COLUMN marts.fato_meta.meta_valor IS 'Meta de valor para o produto no mes.';
COMMENT ON COLUMN marts.fato_devolucao.motivo IS 'Motivo informado pelo cliente na devolucao.';
COMMENT ON COLUMN marts.dim_tempo.data IS 'Dia. Chave da dimensao.';
COMMENT ON COLUMN marts.dim_cidade.uf IS 'Unidade federativa da cidade.';

-- Indices nas colunas de FK. Sem eles a ferramenta desenha o arco tracejado,
-- que e o sinal de "esta FK nao tem indice" — util no diagnostico, ruido no exemplo.
CREATE INDEX idx_fato_venda_cidade    ON marts.fato_venda (cidade_id);
CREATE INDEX idx_fato_venda_produto   ON marts.fato_venda (produto_id);
CREATE INDEX idx_fato_venda_cliente   ON marts.fato_venda (cliente_id);
CREATE INDEX idx_fato_meta_produto    ON marts.fato_meta (produto_id);
CREATE INDEX idx_fato_devolucao_prod  ON marts.fato_devolucao (produto_id);
CREATE INDEX idx_fato_devolucao_cli   ON marts.fato_devolucao (cliente_id);
