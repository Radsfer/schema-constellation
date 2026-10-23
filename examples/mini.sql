-- Exemplo mínimo: uma dimensão, um calendário e um fato.
-- Serve para o smoke test do CI e para quem quer ver a ferramenta rodando
-- em 10 segundos, sem precisar de um banco.

CREATE TABLE marts.dim_calendario (
    data        date PRIMARY KEY,
    ano         integer NOT NULL,
    mes         integer NOT NULL
);

CREATE TABLE marts.dim_cidade (
    cidade_id   integer PRIMARY KEY,
    cidade      text NOT NULL,
    regional    text
);

CREATE TABLE marts.fato_venda (
    data        date    NOT NULL,
    cidade_id   integer NOT NULL,
    valor       numeric(14,2) NOT NULL,
    -- uma venda por dia e cidade. Sem isso a ferramenta le a fato como tabela
    -- de juncao (duas FKs sem unicao) e acusa duplicata de vinculo.
    CONSTRAINT uq_fato_venda_dia_cidade UNIQUE (data, cidade_id)
);

COMMENT ON TABLE marts.fato_venda IS 'Uma linha por venda.';
COMMENT ON COLUMN marts.fato_venda.valor IS 'Valor bruto da venda.';
COMMENT ON COLUMN marts.fato_venda.cidade_id IS 'Cidade em que a venda aconteceu.';
COMMENT ON COLUMN marts.dim_calendario.data IS 'Dia. Chave da dimensão.';
