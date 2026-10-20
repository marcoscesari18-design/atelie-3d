-- =====================================================================
-- ATELIÊ 3D — schema completo
-- Projeto pai & filho (Marcos + Pedro) · Bambu Lab A1 + AMS Lite
-- Rodar inteiro em: Supabase > SQL Editor  (ou via MCP apply_migration)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILAMENTOS  (catálogo de cores + estoque)
-- ---------------------------------------------------------------------
create table if not exists filamentos (
  id                uuid primary key default gen_random_uuid(),
  marca             text not null,                        -- Bambu, Voolt, 3DLab...
  tipo              text not null,                        -- PLA, PLA Silk, PETG, TPU, ABS, ASA
  cor_nome          text not null,                        -- "Laranja", "Preto"
  cor_hex           text not null default '#888888',      -- swatch mostrado no app
  custo_kg          numeric(10,2) not null,               -- R$/kg REAL pago
  gramas_iniciais   numeric(10,1) not null default 1000,
  gramas_restantes  numeric(10,1) not null default 1000,
  slot_ams          smallint,                             -- 1..4 se estiver no AMS, null se na gaveta
  ativo             boolean not null default true,
  obs               text,
  created_at        timestamptz not null default now()
);
comment on table filamentos is 'Estoque de filamento. gramas_restantes é baixado automaticamente quando uma tarefa vira status=ok.';

-- alerta de estoque baixo é calculado no app: gramas_restantes < 100 => "acabando"

-- ---------------------------------------------------------------------
-- 2. PRODUTOS  (catálogo de peças que sabemos imprimir)
-- ---------------------------------------------------------------------
create table if not exists produtos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  linha            text not null default 'pedro'
                   check (linha in ('pedro','b2b')),      -- lojinha do Pedro x cliente
  cliente          text,                                  -- nome do cliente (só linha=b2b)
  arquivo          text,                                  -- nome do .3mf/.stl na pasta
  gramas           numeric(10,2),                         -- do fatiamento no Bambu Studio
  minutos          integer,                               -- do fatiamento no Bambu Studio
  n_cores          smallint default 1,
  custo_calculado  numeric(10,2),                         -- veio da calculadora
  preco_venda      numeric(10,2),                         -- preço definido COM o Pedro
  foto_url         text,
  validado         boolean not null default false,        -- true = já imprimiu e deu certo
  obs              text,
  created_at       timestamptz not null default now()
);
comment on column produtos.gramas is 'NUNCA estimar. Só preencher com o número real que o Bambu Studio mostrou no fatiamento.';

-- ---------------------------------------------------------------------
-- 3. TAREFAS  (a fila da semana do Pedro)
-- ---------------------------------------------------------------------
create table if not exists tarefas (
  id                uuid primary key default gen_random_uuid(),
  semana            date not null,                        -- segunda-feira da semana
  ordem             smallint not null default 0,          -- ordem na fila
  produto_id        uuid references produtos(id) on delete set null,
  titulo            text not null,                        -- ex: "3 chaveiros PEC laranja"
  qtd               smallint not null default 1,
  gramas_previsto   numeric(10,2),
  minutos_previsto  integer,
  gramas_real       numeric(10,2),                        -- preenchido no fim, se diferente
  status            text not null default 'fila'
                    check (status in ('fila','imprimindo','ok','falhou')),
  motivo_falha      text,                                 -- ERRO VIRA LIÇÃO: sempre preencher
  aprendizado       text,                                 -- o que o Pedro aprendeu com a falha
  responsavel       text not null default 'pedro',
  concluida_em      timestamptz,
  created_at        timestamptz not null default now()
);

-- cores usadas em cada tarefa (multicor: uma tarefa pode usar 4 filamentos)
create table if not exists tarefa_filamentos (
  tarefa_id     uuid not null references tarefas(id) on delete cascade,
  filamento_id  uuid not null references filamentos(id) on delete restrict,
  gramas        numeric(10,2) not null default 0,
  primary key (tarefa_id, filamento_id)
);

-- ---------------------------------------------------------------------
-- 4. VENDAS
-- ---------------------------------------------------------------------
create table if not exists vendas (
  id           uuid primary key default gen_random_uuid(),
  data         date not null default current_date,
  cliente      text not null,                             -- nome do comprador
  canal        text not null default 'escola'
               check (canal in ('escola','whatsapp','feira','shopee','ml','b2b','outro')),
  produto_id   uuid references produtos(id) on delete set null,
  descricao    text,                                      -- se não tiver produto cadastrado
  qtd          smallint not null default 1,
  preco_unit   numeric(10,2) not null,
  custo_unit   numeric(10,2) not null default 0,
  desconto     numeric(10,2) not null default 0,
  pago         boolean not null default false,
  entregue     boolean not null default false,
  obs          text,
  created_at   timestamptz not null default now(),

  total    numeric(10,2) generated always as ((preco_unit * qtd) - desconto) stored,
  lucro    numeric(10,2) generated always as ((preco_unit * qtd) - desconto - (custo_unit * qtd)) stored
);

-- ---------------------------------------------------------------------
-- 5. CONFIG  (guarda os DEFAULTS da calculadora, dados da marca, logo)
-- ---------------------------------------------------------------------
create table if not exists config (
  chave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Presets migrados do Precifica3D original (mantidos idênticos)
insert into config (chave, valor) values
('defaults_calculadora', '{
  "precoKg":120,"margem":100,"maoHora":20,"maoMin":10,
  "falha":5,"tarifa":0.80,"potencia":100,"desgaste":1.50,
  "mkShopComm":20,"mkShopFix":4,
  "mkMlComm":14,"mkMlpComm":19,"mkMlFix":6.25,"mkMlFrete":22,
  "material":"pla","impressora":"bambu-a1","regime":"nenhum"
}'::jsonb),
('impressoras', '[
  {"id":"bambu-a1","nome":"Bambu Lab A1","potencia":100,"desgaste":1.50},
  {"id":"bambu-a1-mini","nome":"Bambu Lab A1 Mini","potencia":80,"desgaste":1.20},
  {"id":"bambu-p1s","nome":"Bambu Lab P1S","potencia":170,"desgaste":2.50},
  {"id":"bambu-x1c","nome":"Bambu Lab X1C","potencia":220,"desgaste":3.50},
  {"id":"outra","nome":"Outra (edite manual)","potencia":100,"desgaste":1.50}
]'::jsonb),
('regimes', '{
  "nenhum":{"taxa":0,"label":"Sem imposto","alerta":""},
  "mei":{"taxa":0,"label":"MEI · DAS fixo","alerta":"Adicione R$ 75/mês de DAS no seu custo se vender 4+/mês."},
  "simples":{"taxa":6,"label":"Simples Nacional 6%","alerta":""},
  "pf":{"taxa":0,"label":"Pessoa Física","alerta":"Sem CNPJ é tolerado até ~R$ 28.500/ano. Acima disso vire MEI."}
}'::jsonb)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 6. TRIGGER — baixa automática de estoque
--    Quando a tarefa vira 'ok', desconta as gramas de cada filamento usado.
--    Quando volta de 'ok' pra outro status, devolve (permite corrigir engano).
-- ---------------------------------------------------------------------
create or replace function baixa_estoque_filamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ok' and coalesce(old.status,'') <> 'ok' then
    update filamentos f
       set gramas_restantes = greatest(f.gramas_restantes - tf.gramas, 0)
      from tarefa_filamentos tf
     where tf.tarefa_id = new.id and tf.filamento_id = f.id;
    new.concluida_em := now();

  elsif old.status = 'ok' and new.status <> 'ok' then
    update filamentos f
       set gramas_restantes = f.gramas_restantes + tf.gramas
      from tarefa_filamentos tf
     where tf.tarefa_id = new.id and tf.filamento_id = f.id;
    new.concluida_em := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_baixa_estoque on tarefas;
create trigger trg_baixa_estoque
  before update of status on tarefas
  for each row execute function baixa_estoque_filamento();

-- ---------------------------------------------------------------------
-- 7. VIEWS de apoio
-- ---------------------------------------------------------------------
create or replace view v_resumo_mes as
select
  date_trunc('month', data)::date              as mes,
  count(*)                                     as n_vendas,
  sum(total)                                   as faturamento,
  sum(lucro)                                   as lucro,
  sum(case when not pago then total else 0 end) as a_receber
from vendas
group by 1
order by 1 desc;

create or replace view v_semana_pedro as
select t.*,
       p.nome as produto,
       (select string_agg(f.cor_nome, ' + ' order by f.cor_nome)
          from tarefa_filamentos tf join filamentos f on f.id = tf.filamento_id
         where tf.tarefa_id = t.id) as cores
from tarefas t
left join produtos p on p.id = t.produto_id
order by t.semana desc, t.ordem;

-- ---------------------------------------------------------------------
-- 8. RLS — app privado: só usuário logado enxerga/escreve
-- ---------------------------------------------------------------------
alter table filamentos        enable row level security;
alter table produtos          enable row level security;
alter table tarefas           enable row level security;
alter table tarefa_filamentos enable row level security;
alter table vendas            enable row level security;
alter table config            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['filamentos','produtos','tarefas','tarefa_filamentos','vendas','config']
  loop
    execute format(
      'create policy "logado_total_%1$s" on %1$I
         for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- FIM
