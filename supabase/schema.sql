-- =====================================================================
-- ATELIÊ 3D — schema v2 (spec docs/specs/2026-10-19-atelie-3d-design.md §5)
-- Rodar inteiro em: Supabase > SQL Editor, num projeto NOVO.
--
-- Regras principais:
--  * estoque = livro-caixa movimentos_estoque; filamentos.gramas_restantes
--    é mantido só por trigger (ninguém edita direto);
--  * gramas saem do estoque na APROVAÇÃO do orçamento (aprovar_orcamento);
--  * toda mudança de estado passa por funções security definer que travam
--    a linha do orçamento (for update);
--  * só usuários cadastrados em `perfis` enxergam/escrevem qualquer coisa.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 0. PERFIS — quem pode usar o app (2 pessoas, criadas à mão)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  papel    text not null check (papel in ('marcos','pedro')),
  nome     text not null
);

create or replace function private.eh_membro()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where user_id = (select auth.uid()));
$$;

create or replace function private.eh_marcos()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where user_id = (select auth.uid()) and papel = 'marcos');
$$;

create or replace function private.exigir_membro()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.eh_membro() then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
end $$;

-- data de hoje no horário de Brasília (o banco roda em UTC)
create or replace function private.hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;
grant usage on schema private to authenticated;
grant execute on function private.hoje() to authenticated;

-- ---------------------------------------------------------------------
-- 1. FILAMENTOS  (cores + custo + saldo)
-- ---------------------------------------------------------------------
create table if not exists public.filamentos (
  id                uuid primary key default gen_random_uuid(),
  marca             text not null,
  tipo              text not null,                        -- PLA, PLA Silk, PETG, TPU, ABS, ASA
  cor_nome          text not null,
  cor_hex           text not null default '#888888' check (cor_hex ~ '^#[0-9A-Fa-f]{6}$'),
  custo_kg          numeric(10,2) not null check (custo_kg >= 0),   -- R$/kg REAL pago
  gramas_iniciais   numeric(10,2) not null default 1000 check (gramas_iniciais >= 0),
  gramas_restantes  numeric(10,2) not null default 0,     -- pode ficar negativo = "faltando"
  slot_ams          smallint check (slot_ams between 1 and 4),
  ativo             boolean not null default true,
  obs               text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. PRODUTOS  (peças que sabemos imprimir)
-- ---------------------------------------------------------------------
create table if not exists public.produtos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  linha            text not null default 'pedro' check (linha in ('pedro','b2b')),
  cliente          text,
  receita          jsonb,                                  -- impressões/placas/cores do orçamento de origem
  custo_calculado  numeric(10,2) check (custo_calculado >= 0),
  preco_venda      numeric(10,2) check (preco_venda >= 0),
  foto_path        text,
  validado         boolean not null default false,
  obs              text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. ORÇAMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.orcamentos (
  id            uuid primary key default gen_random_uuid(),
  numero        integer generated always as identity unique,   -- exibido como ORC-0001
  cliente       text not null,
  contato       text,
  canal         text not null default 'escola'
                check (canal in ('escola','whatsapp','feira','shopee','ml','b2b','outro')),
  linha         text not null default 'pedro' check (linha in ('pedro','b2b')),
  status        text not null default 'rascunho'
                check (status in ('rascunho','enviado','aprovado','recusado','cancelado')),
  validade      date not null default (private.hoje() + 7),
  desconto_pct  numeric(5,2) not null default 0 check (desconto_pct >= 0 and desconto_pct < 100),
  total_aceito  numeric(10,2),
  obs           text,
  created_at    timestamptz not null default now(),
  enviado_em    timestamptz,
  decidido_em   timestamptz
);

create table if not exists public.orcamento_itens (
  id            uuid primary key default gen_random_uuid(),
  orcamento_id  uuid not null references public.orcamentos(id) on delete cascade,
  produto_id    uuid references public.produtos(id) on delete set null,
  descricao     text not null,
  qtd           smallint not null check (qtd > 0),
  extras        numeric(10,2) not null default 0 check (extras >= 0),
  foto_path     text,
  custo_total   numeric(10,2) not null check (custo_total >= 0),
  preco_unit    numeric(10,2) check (preco_unit >= 0),               -- preço por unidade ANTES do desconto
  preco_total   numeric(10,2) not null check (preco_total >= 0)   -- já com a parte do desconto
);
alter table public.orcamento_itens add column if not exists preco_unit numeric(10,2) check (preco_unit >= 0);
create index if not exists orcamento_itens_orcamento_idx on public.orcamento_itens(orcamento_id);

-- como o item vai ser impresso (P1: refatia o que falta — sem sobra)
create table if not exists public.orcamento_impressoes (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.orcamento_itens(id) on delete cascade,
  arquivo_nome     text,
  vezes            smallint not null check (vezes > 0),
  unidades_por_vez smallint not null default 1 check (unidades_por_vez > 0)
);
create index if not exists orcamento_impressoes_item_idx on public.orcamento_impressoes(item_id);

create table if not exists public.orcamento_item_placas (
  id           uuid primary key default gen_random_uuid(),
  impressao_id uuid not null references public.orcamento_impressoes(id) on delete cascade,
  placa        smallint not null check (placa > 0),
  segundos     integer not null check (segundos > 0),
  gramas       numeric(10,2) not null check (gramas > 0)
);
create index if not exists orcamento_item_placas_impressao_idx on public.orcamento_item_placas(impressao_id);

create table if not exists public.orcamento_placa_filamentos (
  placa_id      uuid not null references public.orcamento_item_placas(id) on delete cascade,
  filamento_id  uuid not null references public.filamentos(id) on delete restrict,
  gramas        numeric(10,2) not null check (gramas > 0),
  primary key (placa_id, filamento_id)
);
create index if not exists orcamento_placa_filamentos_fil_idx on public.orcamento_placa_filamentos(filamento_id);

-- ---------------------------------------------------------------------
-- 4. TAREFAS  (a fila da semana) — criadas só por aprovar/reimprimir
-- ---------------------------------------------------------------------
create table if not exists public.tarefas (
  id                 uuid primary key default gen_random_uuid(),
  semana             date not null,                        -- segunda-feira da semana
  ordem              integer not null default 0,
  produto_id         uuid references public.produtos(id) on delete set null,
  orcamento_item_id  uuid references public.orcamento_itens(id) on delete set null,
  placa_id           uuid references public.orcamento_item_placas(id) on delete set null,
  vez                smallint,
  titulo             text not null,
  qtd                smallint not null default 1 check (qtd > 0),
  gramas_previsto    numeric(10,2),
  segundos_previsto  integer,
  gramas_real        numeric(10,2) check (gramas_real >= 0),
  status             text not null default 'fila' check (status in ('fila','imprimindo','ok','falhou')),
  motivo_falha       text,                                 -- ERRO VIRA LIÇÃO
  aprendizado        text,
  responsavel        text not null default 'pedro',
  reimpressao_de     uuid unique references public.tarefas(id) on delete set null,
  iniciada           boolean not null default false,          -- já saiu da fila alguma vez: filamento gasto
  concluida_em       timestamptz,
  created_at         timestamptz not null default now(),
  constraint falha_tem_licao check (
    status <> 'falhou' or (coalesce(btrim(motivo_falha),'') <> '' and coalesce(btrim(aprendizado),'') <> '')
  )
);
alter table public.tarefas add column if not exists iniciada boolean not null default false;
create index if not exists tarefas_orcamento_item_idx on public.tarefas(orcamento_item_id);
create index if not exists tarefas_semana_idx on public.tarefas(semana, ordem);

create table if not exists public.tarefa_filamentos (
  tarefa_id     uuid not null references public.tarefas(id) on delete cascade,
  filamento_id  uuid not null references public.filamentos(id) on delete restrict,
  gramas        numeric(10,2) not null check (gramas > 0),
  primary key (tarefa_id, filamento_id)
);
create index if not exists tarefa_filamentos_fil_idx on public.tarefa_filamentos(filamento_id);

-- ---------------------------------------------------------------------
-- 5. MOVIMENTOS DE ESTOQUE  (fonte da verdade do saldo)
-- ---------------------------------------------------------------------
create table if not exists public.movimentos_estoque (
  id            uuid primary key default gen_random_uuid(),
  filamento_id  uuid not null references public.filamentos(id) on delete restrict,
  gramas        numeric(10,2) not null check (gramas <> 0),   -- negativo = saiu
  motivo        text not null check (motivo in ('rolo_novo','aprovacao','reimpressao','cancelamento','ajuste')),
  tarefa_id     uuid references public.tarefas(id) on delete set null,
  orcamento_id  uuid references public.orcamentos(id) on delete set null,
  estorno_de    uuid unique references public.movimentos_estoque(id),
  obs           text,
  criado_por    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint ajuste_tem_obs check (motivo <> 'ajuste' or coalesce(btrim(obs),'') <> '')
);
create index if not exists movimentos_filamento_idx on public.movimentos_estoque(filamento_id, created_at);
create index if not exists movimentos_tarefa_idx on public.movimentos_estoque(tarefa_id);
create index if not exists movimentos_orcamento_idx on public.movimentos_estoque(orcamento_id);

-- ---------------------------------------------------------------------
-- 6. VENDAS
-- ---------------------------------------------------------------------
create table if not exists public.vendas (
  id                 uuid primary key default gen_random_uuid(),
  data               date not null default private.hoje(),
  cliente            text not null,
  canal              text not null default 'escola'
                     check (canal in ('escola','whatsapp','feira','shopee','ml','b2b','outro')),
  linha              text not null default 'pedro' check (linha in ('pedro','b2b')),
  produto_id         uuid references public.produtos(id) on delete set null,
  orcamento_id       uuid references public.orcamentos(id) on delete set null,
  orcamento_item_id  uuid references public.orcamento_itens(id) on delete set null,
  descricao          text,
  qtd                smallint not null default 1 check (qtd > 0),
  preco_unit         numeric(10,2) not null check (preco_unit >= 0),
  custo_unit         numeric(12,4) not null default 0 check (custo_unit >= 0),
  desconto           numeric(10,2) not null default 0,
  pago               boolean not null default false,
  entregue           boolean not null default false,
  cancelada          boolean not null default false,
  obs                text,
  created_at         timestamptz not null default now(),
  total    numeric(10,2) generated always as ((preco_unit * qtd) - desconto) stored,
  lucro    numeric(10,2) generated always as ((preco_unit * qtd) - desconto - (custo_unit * qtd)) stored
);
-- projetos criados antes desta coluna / do horário de Brasília
alter table public.vendas alter column data set default private.hoje();
do $$ begin
  if (select numeric_scale from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'custo_unit') < 4 then
    drop view if exists public.v_resumo_mes;
    alter table public.vendas drop column lucro;
    alter table public.vendas alter column custo_unit type numeric(12,4);
    alter table public.vendas add column lucro numeric(10,2) generated always as ((preco_unit * qtd) - desconto - (custo_unit * qtd)) stored;
  end if;
end $$;
alter table public.orcamentos alter column validade set default (private.hoje() + 7);
alter table public.vendas add column if not exists linha text not null default 'pedro' check (linha in ('pedro','b2b'));
-- frete do orçamento: frete_cliente = cliente paga (soma no total); false = frete grátis (sai do lucro)
alter table public.orcamentos add column if not exists frete numeric(10,2) not null default 0 check (frete >= 0);
alter table public.orcamentos add column if not exists frete_cliente boolean not null default true;
create index if not exists vendas_orcamento_idx on public.vendas(orcamento_id);
create index if not exists vendas_data_idx on public.vendas(data);

-- ---------------------------------------------------------------------
-- 7. CONFIG  (padrões da calculadora, marca, presets)
-- ---------------------------------------------------------------------
create table if not exists public.config (
  chave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Presets da calculadora original (idênticos aos DEFAULTS do Precifica3D)
insert into public.config (chave, valor) values
('defaults_calculadora', '{
  "precoKg":120,"margem":100,"maoHora":20,"maoMin":10,
  "falha":5,"tarifa":0.80,"potencia":100,"desgaste":1.50,
  "mkShopComm":20,"mkShopFix":4,
  "mkMlComm":14,"mkMlpComm":19,"mkMlFix":6.25,"mkMlFrete":22,
  "impressora":"bambu-a1","regime":"nenhum"
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
}'::jsonb),
('marca', '{"nome":"","fone":"","instagram":"","logo_path":null}'::jsonb)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 8. TRIGGERS
-- ---------------------------------------------------------------------
-- saldo do rolo = soma dos movimentos
create or replace function private.aplicar_movimento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.filamentos set gramas_restantes = gramas_restantes + new.gramas where id = new.filamento_id;
  return new;
end $$;
drop trigger if exists trg_aplicar_movimento on public.movimentos_estoque;
create trigger trg_aplicar_movimento after insert on public.movimentos_estoque
  for each row execute function private.aplicar_movimento();

-- rolo cadastrado entra no estoque como movimento
create or replace function private.rolo_cadastrado()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.gramas_iniciais > 0 then
    insert into public.movimentos_estoque (filamento_id, gramas, motivo, obs)
    values (new.id, new.gramas_iniciais, 'rolo_novo', 'cadastro do rolo');
  end if;
  return new;
end $$;
drop trigger if exists trg_rolo_cadastrado on public.filamentos;
create trigger trg_rolo_cadastrado after insert on public.filamentos
  for each row execute function private.rolo_cadastrado();

-- data de conclusão; tarefa reimpressa não sai de "falhou"
create or replace function private.tarefa_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'falhou' and exists (select 1 from public.tarefas where reimpressao_de = old.id) then
      raise exception 'essa peça já foi reimpressa; não dá para mudar o status' using errcode = 'P0001';
    end if;
    new.concluida_em := case when new.status in ('ok','falhou') then now() else null end;
    if new.status <> 'fila' then new.iniciada := true; end if;
  end if;
  return new;
end $$;
-- A venda "Frete" de um orçamento segue os itens: paga/entregue só quando todos os itens estão.
-- No banco (não na tela) e travando o orçamento, para dois toques seguidos não deixarem o frete defasado.
create or replace function private.frete_segue_itens()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.orcamento_id is null or new.orcamento_item_id is null then return null; end if;
  perform 1 from public.orcamentos where id = new.orcamento_id for update;
  update public.vendas f
     set pago     = coalesce((select bool_and(i.pago) from public.vendas i
                               where i.orcamento_id = new.orcamento_id and i.orcamento_item_id is not null and not i.cancelada), f.pago),
         entregue = coalesce((select bool_and(i.entregue) from public.vendas i
                               where i.orcamento_id = new.orcamento_id and i.orcamento_item_id is not null and not i.cancelada), f.entregue)
   where f.orcamento_id = new.orcamento_id and f.orcamento_item_id is null and f.descricao = 'Frete' and not f.cancelada;
  return null;
end $$;
drop trigger if exists trg_frete_segue_itens on public.vendas;
create trigger trg_frete_segue_itens after update of pago, entregue on public.vendas
  for each row when (new.orcamento_item_id is not null) execute function private.frete_segue_itens();

drop trigger if exists trg_tarefa_status on public.tarefas;
create trigger trg_tarefa_status before update on public.tarefas
  for each row execute function private.tarefa_status();

-- ---------------------------------------------------------------------
-- 9. FUNÇÕES (RPC) — único caminho para mudar estado e estoque
-- ---------------------------------------------------------------------
create or replace function public.marcar_orcamento(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_atual text;
begin
  perform private.exigir_membro();
  select status into v_atual from public.orcamentos where id = p_id for update;
  if v_atual is null then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  if not ((v_atual = 'rascunho' and p_status in ('enviado','recusado'))
       or (v_atual = 'enviado'  and p_status in ('recusado','rascunho'))) then
    raise exception 'não dá para passar de % para %', v_atual, p_status using errcode = 'P0001';
  end if;
  update public.orcamentos
     set status = p_status,
         enviado_em  = case when p_status = 'enviado' then now() else enviado_em end,
         decidido_em = case when p_status = 'recusado' then now() else decidido_em end
   where id = p_id;
end $$;

create or replace function public.aprovar_orcamento(p_id uuid, p_total_esperado numeric)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  o        public.orcamentos;
  it       record;
  imp      record;
  pl       record;
  v_total  numeric(10,2);
  v_semana date := date_trunc('week', private.hoje())::date;
  v_ordem  integer;
  v_tarefa uuid;
  v_venda  uuid;
  v_vendas uuid[] := '{}';
  v_unid   integer;
  v_preco_unit numeric(10,2);
begin
  perform private.exigir_membro();
  select * into o from public.orcamentos where id = p_id for update;
  if o.id is null then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  if o.status not in ('rascunho','enviado') then
    raise exception 'esse orçamento já foi %', o.status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.orcamento_itens where orcamento_id = p_id) then
    raise exception 'orçamento sem itens' using errcode = 'P0001';
  end if;

  select sum(preco_total) into v_total from public.orcamento_itens where orcamento_id = p_id;
  v_total := v_total + case when o.frete_cliente then o.frete else 0 end;   -- o desconto nunca pega o frete
  if p_total_esperado is null or round(p_total_esperado, 2) is distinct from v_total then
    raise exception 'o orçamento mudou, confira de novo (total agora: %)', v_total using errcode = 'P0001';
  end if;

  -- validações por item
  for it in select * from public.orcamento_itens where orcamento_id = p_id loop
    select coalesce(sum(vezes * unidades_por_vez), 0) into v_unid from public.orcamento_impressoes where item_id = it.id;
    if v_unid <> it.qtd then
      raise exception '"%": as impressões fazem % de %; suba o .3mf do que falta', it.descricao, v_unid, it.qtd using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orcamento_impressoes i
       where i.item_id = it.id
         and not exists (select 1 from public.orcamento_item_placas p where p.impressao_id = i.id)) then
      raise exception '"%": impressão sem placa', it.descricao using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orcamento_impressoes i
        join public.orcamento_item_placas p on p.impressao_id = i.id
       where i.item_id = it.id
         and not exists (select 1 from public.orcamento_placa_filamentos f where f.placa_id = p.id)) then
      raise exception '"%": escolha o rolo de cada cor', it.descricao using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orcamento_impressoes i
        join public.orcamento_item_placas p on p.impressao_id = i.id
       where i.item_id = it.id
         and abs(p.gramas - (select coalesce(sum(f.gramas), 0) from public.orcamento_placa_filamentos f where f.placa_id = p.id)) > 0.5) then
      raise exception '"%": as gramas das cores não batem com o peso da placa; suba o .3mf de novo', it.descricao using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(max(ordem), 0) into v_ordem from public.tarefas where semana = v_semana;

  for it in select * from public.orcamento_itens where orcamento_id = p_id order by descricao, id loop
    for imp in select * from public.orcamento_impressoes where item_id = it.id order by id loop
      for v in 1..imp.vezes loop
        for pl in select * from public.orcamento_item_placas where impressao_id = imp.id order by placa loop
          v_ordem := v_ordem + 1;
          insert into public.tarefas (semana, ordem, produto_id, orcamento_item_id, placa_id, vez, titulo, qtd,
                                      gramas_previsto, segundos_previsto)
          values (v_semana, v_ordem, it.produto_id, it.id, pl.id, v,
                  it.descricao || ' · placa ' || pl.placa || ' · ' || v || '/' || imp.vezes,
                  imp.unidades_por_vez, pl.gramas, pl.segundos)
          returning id into v_tarefa;

          insert into public.tarefa_filamentos (tarefa_id, filamento_id, gramas)
          select v_tarefa, filamento_id, gramas from public.orcamento_placa_filamentos where placa_id = pl.id;

          insert into public.movimentos_estoque (filamento_id, gramas, motivo, tarefa_id, orcamento_id)
          select filamento_id, -gramas, 'aprovacao', v_tarefa, p_id
            from public.orcamento_placa_filamentos where placa_id = pl.id;
        end loop;
      end loop;
    end loop;

    -- venda do item: total da venda = preco_total do item, ao centavo
    v_preco_unit := round(it.preco_total / it.qtd, 2);
    insert into public.vendas (cliente, canal, linha, produto_id, orcamento_id, orcamento_item_id, descricao,
                               qtd, preco_unit, custo_unit, desconto)
    values (o.cliente, o.canal, o.linha, it.produto_id, p_id, it.id, it.descricao,
            it.qtd, v_preco_unit, round(it.custo_total / it.qtd, 4), v_preco_unit * it.qtd - it.preco_total)
    returning id into v_venda;
    v_vendas := v_vendas || v_venda;
  end loop;

  -- frete vira uma venda própria: cliente paga → preço = frete, lucro 0; frete grátis → preço 0, lucro −frete
  if o.frete > 0 then
    insert into public.vendas (cliente, canal, linha, orcamento_id, descricao, qtd, preco_unit, custo_unit)
    values (o.cliente, o.canal, o.linha, p_id, 'Frete', 1, case when o.frete_cliente then o.frete else 0 end, o.frete)
    returning id into v_venda;
    v_vendas := v_vendas || v_venda;
  end if;

  update public.orcamentos
     set status = 'aprovado', total_aceito = v_total, decidido_em = now()
   where id = p_id;
  return v_vendas;
end $$;

create or replace function public.reimprimir_tarefa(p_tarefa uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t       public.tarefas;
  v_orc   uuid;
  v_nova  uuid;
  v_ordem integer;
begin
  perform private.exigir_membro();
  select i.orcamento_id into v_orc
    from public.tarefas tt join public.orcamento_itens i on i.id = tt.orcamento_item_id
   where tt.id = p_tarefa;
  if v_orc is null then raise exception 'tarefa não encontrada' using errcode = 'P0002'; end if;
  perform 1 from public.orcamentos where id = v_orc and status = 'aprovado' for update;
  if not found then raise exception 'o orçamento dessa peça não está aprovado' using errcode = 'P0001'; end if;

  select * into t from public.tarefas where id = p_tarefa for update;
  if t.status <> 'falhou' then
    raise exception 'só dá para reimprimir uma peça que deu ruim' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tarefas where reimpressao_de = p_tarefa) then
    raise exception 'essa peça já foi reimpressa' using errcode = 'P0001';
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem from public.tarefas where semana = date_trunc('week', private.hoje())::date;
  insert into public.tarefas (semana, ordem, produto_id, orcamento_item_id, placa_id, vez, titulo, qtd,
                              gramas_previsto, segundos_previsto, reimpressao_de)
  values (date_trunc('week', private.hoje())::date, v_ordem, t.produto_id, t.orcamento_item_id, t.placa_id, t.vez,
          t.titulo || ' · reimpressão', t.qtd, t.gramas_previsto, t.segundos_previsto, p_tarefa)
  returning id into v_nova;

  insert into public.tarefa_filamentos (tarefa_id, filamento_id, gramas)
  select v_nova, filamento_id, gramas from public.tarefa_filamentos where tarefa_id = p_tarefa;

  insert into public.movimentos_estoque (filamento_id, gramas, motivo, tarefa_id, orcamento_id)
  select filamento_id, -gramas, 'reimpressao', v_nova, v_orc from public.tarefa_filamentos where tarefa_id = p_tarefa;
  return v_nova;
end $$;

create or replace function public.cancelar_orcamento(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  perform private.exigir_membro();
  if not private.eh_marcos() then raise exception 'só o Marcos cancela orçamento aprovado' using errcode = '42501'; end if;
  select status into v_status from public.orcamentos where id = p_id for update;
  if v_status is null then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  if v_status <> 'aprovado' then
    raise exception 'só dá para cancelar orçamento aprovado' using errcode = 'P0001';
  end if;

  -- devolve só o que ainda está na fila; o que foi impresso (ou falhou) foi gasto
  insert into public.movimentos_estoque (filamento_id, gramas, motivo, orcamento_id, estorno_de, obs)
  select m.filamento_id, -m.gramas, 'cancelamento', p_id, m.id, 'cancelamento do orçamento'
    from public.movimentos_estoque m
    join public.tarefas t on t.id = m.tarefa_id
    join public.orcamento_itens i on i.id = t.orcamento_item_id
   where i.orcamento_id = p_id and t.status = 'fila' and not t.iniciada and m.gramas < 0
     and not exists (select 1 from public.movimentos_estoque e where e.estorno_de = m.id);

  delete from public.tarefas t
   using public.orcamento_itens i
   where i.id = t.orcamento_item_id and i.orcamento_id = p_id and t.status = 'fila';

  update public.vendas set cancelada = true where orcamento_id = p_id;
  update public.orcamentos set status = 'cancelado', decidido_em = now() where id = p_id;
end $$;

create or replace function public.ajustar_estoque(p_filamento uuid, p_gramas numeric, p_obs text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.exigir_membro();
  if not private.eh_marcos() then raise exception 'só o Marcos ajusta estoque' using errcode = '42501'; end if;
  if coalesce(btrim(p_obs), '') = '' then raise exception 'diga o motivo do ajuste' using errcode = 'P0001'; end if;
  perform 1 from public.filamentos where id = p_filamento for update;
  if not found then raise exception 'rolo não encontrado' using errcode = 'P0002'; end if;
  insert into public.movimentos_estoque (filamento_id, gramas, motivo, obs)
  values (p_filamento, p_gramas, 'ajuste', p_obs) returning id into v_id;
  return v_id;
end $$;

create or replace function public.entrada_rolo(p_filamento uuid, p_gramas numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.exigir_membro();
  if not private.eh_marcos() then raise exception 'só o Marcos lança rolo novo' using errcode = '42501'; end if;
  if p_gramas is null or p_gramas <= 0 then raise exception 'gramas do rolo novo precisam ser maiores que zero' using errcode = 'P0001'; end if;
  perform 1 from public.filamentos where id = p_filamento for update;
  if not found then raise exception 'rolo não encontrado' using errcode = 'P0002'; end if;
  insert into public.movimentos_estoque (filamento_id, gramas, motivo, obs)
  values (p_filamento, p_gramas, 'rolo_novo', 'rolo novo') returning id into v_id;
  return v_id;
end $$;

-- grava o orçamento inteiro (cabeçalho + itens + impressões + placas + cores) numa transação só
-- Batida na porta do lembrete "manter o banco acordado" (GitHub Actions): responde 'ok' sem ler nenhum dado.
-- É a única função liberada sem login; existe só para o plano grátis não pausar o banco por falta de uso.
create or replace function public.ping()
returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;

-- Cor do rolo conferida por foto: qualquer membro (Pedro também) troca SÓ a cor; preço e gramas seguem só com o Marcos.
create or replace function public.corrigir_cor_rolo(p_filamento uuid, p_cor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_membro();
  if p_cor is null or p_cor !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'cor inválida' using errcode = '22023';
  end if;
  update public.filamentos set cor_hex = upper(p_cor) where id = p_filamento;
  if not found then raise exception 'rolo não encontrado' using errcode = 'P0002'; end if;
end $$;

create or replace function public.salvar_orcamento(p_id uuid, p_dados jsonb)
returns table (id uuid, numero integer) language plpgsql security definer set search_path = '' as $$
declare
  o      jsonb := p_dados -> 'orcamento';
  v_id   uuid := p_id;
  v_num  integer;
  v_st   text;
  v_lin  text;
  it jsonb; imp jsonb; pl jsonb; f jsonb;
  v_item uuid; v_imp uuid; v_placa uuid;
begin
  perform private.exigir_membro();
  if (o ->> 'linha') = 'b2b' and not private.eh_marcos() then
    raise exception 'só o Marcos faz orçamento B2B' using errcode = '42501';
  end if;
  if v_id is null then
    insert into public.orcamentos (cliente, contato, canal, linha, desconto_pct, obs, frete, frete_cliente)
    values (o ->> 'cliente', nullif(o ->> 'contato', ''), coalesce(o ->> 'canal', 'escola'), coalesce(o ->> 'linha', 'pedro'),
            coalesce((o ->> 'desconto_pct')::numeric, 0), nullif(o ->> 'obs', ''),
            coalesce((o ->> 'frete')::numeric, 0), coalesce((o ->> 'frete_cliente')::boolean, true))
    returning orcamentos.id, orcamentos.numero into v_id, v_num;
  else
    select status, linha, orcamentos.numero into v_st, v_lin, v_num from public.orcamentos where orcamentos.id = v_id for update;
    if v_st is null then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
    if v_st not in ('rascunho','enviado') then raise exception 'esse orçamento já foi %; não dá mais para mudar', v_st using errcode = 'P0001'; end if;
    if v_lin = 'b2b' and not private.eh_marcos() then raise exception 'só o Marcos mexe em orçamento B2B' using errcode = '42501'; end if;
    update public.orcamentos set cliente = o ->> 'cliente', contato = nullif(o ->> 'contato', ''), canal = coalesce(o ->> 'canal', canal),
           linha = coalesce(o ->> 'linha', linha), desconto_pct = coalesce((o ->> 'desconto_pct')::numeric, 0), obs = nullif(o ->> 'obs', ''),
           frete = coalesce((o ->> 'frete')::numeric, 0), frete_cliente = coalesce((o ->> 'frete_cliente')::boolean, true)
     where orcamentos.id = v_id;
    delete from public.orcamento_itens where orcamento_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_dados -> 'itens', '[]'::jsonb)) loop
    insert into public.orcamento_itens (orcamento_id, produto_id, descricao, qtd, extras, foto_path, custo_total, preco_unit, preco_total)
    values (v_id, nullif(it ->> 'produto_id', '')::uuid, it ->> 'descricao', (it ->> 'qtd')::smallint, coalesce((it ->> 'extras')::numeric, 0),
            nullif(it ->> 'foto_path', ''), (it ->> 'custo_total')::numeric, (it ->> 'preco_unit')::numeric, (it ->> 'preco_total')::numeric)
    returning orcamento_itens.id into v_item;
    for imp in select * from jsonb_array_elements(coalesce(it -> 'impressoes', '[]'::jsonb)) loop
      insert into public.orcamento_impressoes (item_id, arquivo_nome, vezes, unidades_por_vez)
      values (v_item, imp ->> 'arquivo_nome', (imp ->> 'vezes')::smallint, (imp ->> 'unidades_por_vez')::smallint)
      returning orcamento_impressoes.id into v_imp;
      for pl in select * from jsonb_array_elements(coalesce(imp -> 'placas', '[]'::jsonb)) loop
        insert into public.orcamento_item_placas (impressao_id, placa, segundos, gramas)
        values (v_imp, (pl ->> 'placa')::smallint, (pl ->> 'segundos')::integer, (pl ->> 'gramas')::numeric)
        returning orcamento_item_placas.id into v_placa;
        for f in select * from jsonb_array_elements(coalesce(pl -> 'filamentos', '[]'::jsonb)) loop
          insert into public.orcamento_placa_filamentos (placa_id, filamento_id, gramas)
          values (v_placa, (f ->> 'filamento_id')::uuid, (f ->> 'gramas')::numeric);
        end loop;
      end loop;
    end loop;
  end loop;
  return query select v_id, v_num;
end $$;

-- ---------------------------------------------------------------------
-- 10. VIEWS (security_invoker: respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------
create or replace view public.v_resumo_mes with (security_invoker = true) as
select
  date_trunc('month', data)::date                                        as mes,
  count(*)                                                               as n_vendas,
  sum(total)                                                             as faturamento,
  sum(lucro)                                                             as lucro,
  sum(case when not entregue then total else 0 end)                      as em_producao,
  sum(case when entregue and not pago then total else 0 end)             as a_receber
from public.vendas
where not cancelada
group by 1
order by 1 desc;

drop view if exists public.v_semana_pedro;
create view public.v_semana_pedro with (security_invoker = true) as
select t.*,
       coalesce(p.nome, i.descricao) as produto,
       (select string_agg(f.cor_nome, ' + ' order by f.cor_nome)
          from public.tarefa_filamentos tf join public.filamentos f on f.id = tf.filamento_id
         where tf.tarefa_id = t.id) as cores
from public.tarefas t
left join public.produtos p on p.id = t.produto_id
left join public.orcamento_itens i on i.id = t.orcamento_item_id
order by t.semana desc, t.ordem;

-- ---------------------------------------------------------------------
-- 11. PERMISSÕES — nada para anon; authenticated só o necessário
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.eh_membro(), private.eh_marcos(), private.hoje() to authenticated;

grant select on public.perfis to authenticated;
grant select on public.filamentos to authenticated;
grant insert (marca, tipo, cor_nome, cor_hex, custo_kg, gramas_iniciais, slot_ams, ativo, obs) on public.filamentos to authenticated;
grant update (marca, tipo, cor_nome, cor_hex, custo_kg, slot_ams, ativo, obs) on public.filamentos to authenticated;
grant select, insert, update, delete on public.produtos to authenticated;
grant select on public.orcamentos to authenticated;
grant delete on public.orcamentos to authenticated;
grant select on public.orcamento_itens, public.orcamento_impressoes,
  public.orcamento_item_placas, public.orcamento_placa_filamentos to authenticated;
grant select on public.tarefas, public.tarefa_filamentos, public.movimentos_estoque to authenticated;
grant update (status, motivo_falha, aprendizado, gramas_real, ordem, semana) on public.tarefas to authenticated;
grant select, delete on public.vendas to authenticated;
grant insert (id, data, cliente, canal, linha, produto_id, descricao, qtd, preco_unit, custo_unit, desconto, pago, entregue, obs) on public.vendas to authenticated;
grant update (data, pago, entregue, obs) on public.vendas to authenticated;
grant select, insert, update on public.config to authenticated;
grant select on public.v_resumo_mes, public.v_semana_pedro to authenticated;

grant execute on function public.salvar_orcamento(uuid, jsonb), public.marcar_orcamento(uuid, text), public.aprovar_orcamento(uuid, numeric),
  public.reimprimir_tarefa(uuid), public.cancelar_orcamento(uuid),
  public.ajustar_estoque(uuid, numeric, text), public.entrada_rolo(uuid, numeric),
  public.corrigir_cor_rolo(uuid, text) to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. RLS — só quem está em `perfis`
-- ---------------------------------------------------------------------
alter table public.perfis                     enable row level security;
alter table public.filamentos                 enable row level security;
alter table public.produtos                   enable row level security;
alter table public.orcamentos                 enable row level security;
alter table public.orcamento_itens            enable row level security;
alter table public.orcamento_impressoes       enable row level security;
alter table public.orcamento_item_placas      enable row level security;
alter table public.orcamento_placa_filamentos enable row level security;
alter table public.tarefas                    enable row level security;
alter table public.tarefa_filamentos          enable row level security;
alter table public.movimentos_estoque         enable row level security;
alter table public.vendas                     enable row level security;
alter table public.config                     enable row level security;

-- leitura e escrita simples para membros
do $$
declare t text;
begin
  foreach t in array array['perfis','produtos','tarefas','tarefa_filamentos','movimentos_estoque'] loop
    execute format('drop policy if exists membros on public.%I', t);
    execute format('create policy membros on public.%I for all to authenticated using ((select private.eh_membro())) with check ((select private.eh_membro()))', t);
  end loop;
end $$;

-- filamentos: todos leem, só o Marcos cadastra e edita
drop policy if exists membros on public.filamentos;
drop policy if exists ler on public.filamentos;
create policy ler on public.filamentos for select to authenticated using ((select private.eh_membro()));
drop policy if exists gravar on public.filamentos;
create policy gravar on public.filamentos for insert to authenticated with check ((select private.eh_marcos()));
drop policy if exists alterar on public.filamentos;
create policy alterar on public.filamentos for update to authenticated using ((select private.eh_marcos())) with check ((select private.eh_marcos()));

-- config: todos leem, só o Marcos grava
drop policy if exists ler on public.config;
create policy ler on public.config for select to authenticated using ((select private.eh_membro()));
drop policy if exists gravar on public.config;
create policy gravar on public.config for insert to authenticated with check ((select private.eh_marcos()));
drop policy if exists alterar on public.config;
create policy alterar on public.config for update to authenticated using ((select private.eh_marcos())) with check ((select private.eh_marcos()));

-- orçamentos: editar/apagar só enquanto rascunho/enviado (apagar só rascunho)
drop policy if exists ler on public.orcamentos;
create policy ler on public.orcamentos for select to authenticated using ((select private.eh_membro()));
drop policy if exists criar on public.orcamentos;
create policy criar on public.orcamentos for insert to authenticated with check ((select private.eh_membro()));
drop policy if exists editar on public.orcamentos;
create policy editar on public.orcamentos for update to authenticated
  using ((select private.eh_membro()) and status in ('rascunho','enviado'))
  with check ((select private.eh_membro()) and status in ('rascunho','enviado'));
drop policy if exists apagar on public.orcamentos;
create policy apagar on public.orcamentos for delete to authenticated
  using ((select private.eh_membro()) and status = 'rascunho');

-- filhos do orçamento: só mexe se o orçamento ainda é editável
create or replace function private.orcamento_editavel(p_orcamento uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orcamentos where id = p_orcamento and status in ('rascunho','enviado'));
$$;
create or replace function private.orc_do_item(p_item uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select orcamento_id from public.orcamento_itens where id = p_item $$;
create or replace function private.orc_da_impressao(p_imp uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select i.orcamento_id from public.orcamento_impressoes m join public.orcamento_itens i on i.id = m.item_id where m.id = p_imp $$;
create or replace function private.orc_da_placa(p_placa uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select i.orcamento_id from public.orcamento_item_placas p
    join public.orcamento_impressoes m on m.id = p.impressao_id
    join public.orcamento_itens i on i.id = m.item_id where p.id = p_placa $$;
revoke all on function private.orcamento_editavel(uuid), private.orc_do_item(uuid),
  private.orc_da_impressao(uuid), private.orc_da_placa(uuid) from public, anon;
grant execute on function private.orcamento_editavel(uuid), private.orc_do_item(uuid),
  private.orc_da_impressao(uuid), private.orc_da_placa(uuid) to authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('orcamento_itens',            'orcamento_id'),
    ('orcamento_impressoes',       'private.orc_do_item(item_id)'),
    ('orcamento_item_placas',      'private.orc_da_impressao(impressao_id)'),
    ('orcamento_placa_filamentos', 'private.orc_da_placa(placa_id)')
  ) as x(tabela, expr) loop
    execute format('drop policy if exists ler on public.%I', r.tabela);
    execute format('create policy ler on public.%I for select to authenticated using ((select private.eh_membro()))', r.tabela);
    execute format('drop policy if exists escrever on public.%I', r.tabela);
    execute format('create policy escrever on public.%I for insert to authenticated with check ((select private.eh_membro()) and private.orcamento_editavel(%s))', r.tabela, r.expr);
    execute format('drop policy if exists alterar on public.%I', r.tabela);
    execute format('create policy alterar on public.%I for update to authenticated using ((select private.eh_membro()) and private.orcamento_editavel(%s)) with check ((select private.eh_membro()) and private.orcamento_editavel(%s))', r.tabela, r.expr, r.expr);
    execute format('drop policy if exists apagar on public.%I', r.tabela);
    execute format('create policy apagar on public.%I for delete to authenticated using ((select private.eh_membro()) and private.orcamento_editavel(%s))', r.tabela, r.expr);
  end loop;
end $$;

-- vendas: avulsas (sem orçamento) o app cria/apaga; as de orçamento só pela função
drop policy if exists ler on public.vendas;
create policy ler on public.vendas for select to authenticated using ((select private.eh_membro()));
drop policy if exists criar on public.vendas;
create policy criar on public.vendas for insert to authenticated with check ((select private.eh_membro()) and orcamento_id is null);
drop policy if exists alterar on public.vendas;
create policy alterar on public.vendas for update to authenticated using ((select private.eh_membro())) with check ((select private.eh_membro()));
drop policy if exists apagar on public.vendas;
create policy apagar on public.vendas for delete to authenticated using ((select private.eh_membro()) and orcamento_id is null);

-- ---------------------------------------------------------------------
-- 13. STORAGE — fotos privadas (≤ 300 KB, png/jpeg)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 307200, array['image/png','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 307200, allowed_mime_types = array['image/png','image/jpeg'];

drop policy if exists "fotos: membros leem" on storage.objects;
create policy "fotos: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (select private.eh_membro()));
drop policy if exists "fotos: membros enviam" on storage.objects;
create policy "fotos: membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (select private.eh_membro()));
drop policy if exists "fotos: membros apagam" on storage.objects;
