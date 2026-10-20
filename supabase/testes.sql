-- Testes do banco do Ateliê 3D. Rodar no Supabase LOCAL (nunca no de verdade):
--   docker exec -i supabase_db_atelie-3d psql -U postgres -v ON_ERROR_STOP=1 < supabase/testes.sql
-- Cada teste roda numa transação desfeita no fim (rollback). Falha = exceção "FALHOU".
\set ON_ERROR_STOP on
\set QUIET on

-- ---------- preparação (como postgres) ----------
drop schema if exists testes cascade;
create schema testes;
grant usage on schema testes to authenticated, anon;

delete from auth.users where id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'marcos@teste.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'pedro@teste.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'estranho@teste.local','authenticated', 'authenticated');
insert into public.perfis (user_id, papel, nome) values
  ('00000000-0000-0000-0000-00000000000a', 'marcos', 'Marcos'),
  ('00000000-0000-0000-0000-00000000000b', 'pedro',  'Pedro');

create function testes.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function testes.igual(p_real anyelement, p_esperado anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception 'FALHOU: % (veio %, esperado %)', p_msg, p_real, p_esperado;
  end if;
end $$;

create function testes.rolo(p_cor text, p_gramas numeric default 1000, p_tipo text default 'PLA') returns uuid language sql security definer as $$
  insert into public.filamentos (marca, tipo, cor_nome, cor_hex, custo_kg, gramas_iniciais)
  values ('Teste', p_tipo, p_cor, '#FF6910', 120, p_gramas) returning id;
$$;

create function testes.saldo(p_rolo uuid) returns numeric language sql as $$
  select gramas_restantes from public.filamentos where id = p_rolo;
$$;

create function testes.orcamento(p_cliente text default 'Cliente teste') returns uuid language sql security definer as $$
  insert into public.orcamentos (cliente, canal) values (p_cliente, 'escola') returning id;
$$;

create function testes.item(p_orc uuid, p_qtd int, p_preco_total numeric, p_custo_total numeric default 5) returns uuid language sql security definer as $$
  insert into public.orcamento_itens (orcamento_id, descricao, qtd, custo_total, preco_total)
  values (p_orc, 'Peça teste', p_qtd, p_custo_total, p_preco_total) returning id;
$$;

-- impressão com 1 placa; p_rolos/p_gramas = gramas por rolo nessa placa
create function testes.impressao(p_item uuid, p_vezes int, p_upv int, p_rolos uuid[], p_gramas numeric[]) returns uuid language plpgsql security definer as $$
declare v_imp uuid; v_placa uuid; i int; v_total numeric := 0;
begin
  insert into public.orcamento_impressoes (item_id, vezes, unidades_por_vez) values (p_item, p_vezes, p_upv) returning id into v_imp;
  for i in 1..array_length(p_gramas, 1) loop v_total := v_total + p_gramas[i]; end loop;
  insert into public.orcamento_item_placas (impressao_id, placa, segundos, gramas) values (v_imp, 1, 3600, v_total) returning id into v_placa;
  for i in 1..array_length(p_rolos, 1) loop
    insert into public.orcamento_placa_filamentos (placa_id, filamento_id, gramas) values (v_placa, p_rolos[i], p_gramas[i]);
  end loop;
  return v_imp;
end $$;

create function testes.forcar_gramas_placa(p_imp uuid, p_gramas numeric) returns void language sql security definer as $$
  update public.orcamento_item_placas set gramas = p_gramas where impressao_id = p_imp;
$$;

create function testes.linha(p_orc uuid, p_linha text) returns void language sql security definer as $$
  update public.orcamentos set linha = p_linha where id = p_orc;
$$;

create function testes.frete(p_orc uuid, p_frete numeric, p_cliente boolean) returns void language sql security definer as $$
  update public.orcamentos set frete = p_frete, frete_cliente = p_cliente where id = p_orc;
$$;

grant execute on all functions in schema testes to authenticated, anon;

-- ================================================================
\echo '1. aprovar multicor tira as gramas de cada rolo'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); b uuid := testes.rolo('Azul'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a, b], array[6, 5.69]);
  v := public.aprovar_orcamento(o, 13);
  perform testes.igual(testes.saldo(a), 994.00::numeric, 'saldo laranja');
  perform testes.igual(testes.saldo(b), 994.31::numeric, 'saldo azul');
  perform testes.igual((select count(*) from public.tarefas where orcamento_item_id = it), 1::bigint, 'tarefas');
  perform testes.igual(array_length(v, 1), 1, 'vendas');
  perform testes.igual((select total from public.vendas where id = v[1]), 13.00::numeric, 'total da venda');
  perform testes.igual((select status from public.orcamentos where id = o), 'aprovado', 'status');
end $$;
rollback;

\echo '2. item que não fecha a quantidade é recusado'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 5, 20);
  perform testes.impressao(it, 1, 4, array[a], array[46.76]);
  begin
    perform public.aprovar_orcamento(o, 20);
    raise exception 'FALHOU: aprovou item que faz 4 de 5';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm not like '%suba o .3mf do que falta%' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if;
  end;
  perform testes.igual(testes.saldo(a), 1000.00::numeric, 'saldo não mudou');
end $$;
rollback;

\echo '3. refatiar: 4x1 + 1x1 fecha 5 e baixa as duas impressões'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); it := testes.item(o, 5, 37.50);
  perform testes.impressao(it, 1, 4, array[a], array[46.76]);
  perform testes.impressao(it, 1, 1, array[a], array[11.69]);
  v := public.aprovar_orcamento(o, 37.50);
  perform testes.igual(testes.saldo(a), 941.55::numeric, 'saldo');
  perform testes.igual((select count(*) from public.tarefas where orcamento_item_id = it), 2::bigint, 'tarefas');
  perform testes.igual((select qtd from public.vendas where id = v[1]), 5::smallint, 'qtd da venda');
end $$;
rollback;

\echo '4. imprimir 2 vezes baixa 2 vezes'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 4, 20);
  perform testes.impressao(it, 2, 2, array[a], array[10]);
  perform public.aprovar_orcamento(o, 20);
  perform testes.igual(testes.saldo(a), 980.00::numeric, 'saldo');
  perform testes.igual((select count(*) from public.tarefas where orcamento_item_id = it), 2::bigint, 'tarefas');
end $$;
rollback;

\echo '5. aprovar duas vezes: a segunda é recusada e não baixa de novo'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  begin
    perform public.aprovar_orcamento(o, 13);
    raise exception 'FALHOU: aprovou duas vezes';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm not like '%já foi aprovado%' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if;
  end;
  perform testes.igual(testes.saldo(a), 990.00::numeric, 'saldo');
end $$;
rollback;

\echo '6. total diferente do que a tela mostrou é recusado'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  begin
    perform public.aprovar_orcamento(o, 12);
    raise exception 'FALHOU: aprovou com total errado';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm not like '%o orçamento mudou%' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if;
  end;
end $$;
rollback;

\echo '7. reimprimir tira as gramas de novo, uma vez só'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; t uuid; n uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  select id into t from public.tarefas where orcamento_item_id = it;
  update public.tarefas set status = 'falhou', motivo_falha = 'descolou da mesa', aprendizado = 'limpar a mesa antes' where id = t;
  n := public.reimprimir_tarefa(t);
  perform testes.igual(testes.saldo(a), 980.00::numeric, 'saldo após reimpressão');
  perform testes.igual((select reimpressao_de from public.tarefas where id = n), t, 'ligação com a falha');
  begin
    perform public.reimprimir_tarefa(t);
    raise exception 'FALHOU: reimprimiu duas vezes';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm not like '%já foi reimpressa%' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if;
  end;
  perform testes.igual(testes.saldo(a), 980.00::numeric, 'saldo não muda no 2º toque');
end $$;
rollback;

\echo '8. "deu ruim" sem as duas respostas é recusado'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; t uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  select id into t from public.tarefas where orcamento_item_id = it;
  begin
    update public.tarefas set status = 'falhou', motivo_falha = 'descolou' where id = t;
    raise exception 'FALHOU: aceitou falha sem aprendizado';
  exception when check_violation then null;
  end;
end $$;
rollback;

\echo '9. cancelar devolve só o que estava na fila'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; t1 uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 2, 26);
  perform testes.impressao(it, 2, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 26);
  perform testes.igual(testes.saldo(a), 980.00::numeric, 'saldo após aprovar');
  select id into t1 from public.tarefas where orcamento_item_id = it order by vez limit 1;
  update public.tarefas set status = 'ok' where id = t1;
  perform public.cancelar_orcamento(o);
  perform testes.igual(testes.saldo(a), 990.00::numeric, 'devolveu só a da fila');
  perform testes.igual((select count(*) from public.tarefas where orcamento_item_id = it), 1::bigint, 'a impressa fica');
  perform testes.igual((select bool_and(cancelada) from public.vendas where orcamento_id = o), true, 'vendas canceladas');
  perform testes.igual((select status from public.orcamentos where id = o), 'cancelado', 'status');
end $$;
rollback;

\echo '10. venda fecha no centavo do orçamento'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); it := testes.item(o, 3, 13.01);
  perform testes.impressao(it, 1, 3, array[a], array[10]);
  v := public.aprovar_orcamento(o, 13.01);
  perform testes.igual((select total from public.vendas where id = v[1]), 13.01::numeric, 'total ao centavo');
end $$;
rollback;

\echo '11. sem login não lê nada'
begin; set local role anon;
do $$
declare t text;
begin
  foreach t in array array['perfis','filamentos','produtos','orcamentos','orcamento_itens','orcamento_impressoes',
    'orcamento_item_placas','orcamento_placa_filamentos','tarefas','tarefa_filamentos','movimentos_estoque',
    'vendas','config','v_resumo_mes','v_semana_pedro'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'FALHOU: anon leu %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform public.aprovar_orcamento(gen_random_uuid(), 1);
    raise exception 'FALHOU: anon chamou aprovar_orcamento';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo '12. ninguém altera o saldo do rolo direto'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja');
begin
  begin
    update public.filamentos set gramas_restantes = 5000 where id = a;
    raise exception 'FALHOU: alterou saldo direto';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.movimentos_estoque (filamento_id, gramas, motivo) values (a, 500, 'rolo_novo');
    raise exception 'FALHOU: inseriu movimento direto';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo '13. login que não está em perfis não vê nem aprova nada'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
select testes.rolo('Laranja');
select testes.como('00000000-0000-0000-0000-00000000000c');
do $$
begin
  perform testes.igual((select count(*) from public.filamentos), 0::bigint, 'estranho vê rolos');
  begin
    perform public.aprovar_orcamento(gen_random_uuid(), 1);
    raise exception 'FALHOU: estranho chamou aprovar';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm <> 'sem acesso' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if;
  end;
  begin
    insert into public.filamentos (marca, tipo, cor_nome, custo_kg) values ('x','PLA','x',1);
    raise exception 'FALHOU: estranho cadastrou rolo';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo '14. foto: membro envia, estranho não'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id) values ('fotos', 'teste/pedro.png', '00000000-0000-0000-0000-00000000000b');
select testes.como('00000000-0000-0000-0000-00000000000c');
do $$
begin
  perform testes.igual((select count(*) from storage.objects where bucket_id = 'fotos'), 0::bigint, 'estranho vê fotos');
  begin
    insert into storage.objects (bucket_id, name) values ('fotos', 'teste/estranho.png');
    raise exception 'FALHOU: estranho enviou foto';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo '15. orçamento aprovado não pode ser editado pelo app'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; n int;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  begin
    update public.orcamento_itens set preco_total = 1 where id = it;
    raise exception 'FALHOU: editou item aprovado';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.orcamento_itens (orcamento_id, descricao, qtd, custo_total, preco_total) values (o, 'x', 1, 1, 99);
    raise exception 'FALHOU: incluiu item em orçamento aprovado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamentos set cliente = 'outro' where id = o;
    raise exception 'FALHOU: editou orçamento direto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamentos set status = 'rascunho' where id = o;
    raise exception 'FALHOU: mudou status direto';
  exception when insufficient_privilege then null;
  end;
  delete from public.vendas where orcamento_id = o;
  get diagnostics n = row_count;
  perform testes.igual(n, 0, 'apagou venda de orçamento');
end $$;
rollback;

\echo '16. só o Marcos ajusta estoque, e com motivo'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja');
begin
  perform public.ajustar_estoque(a, -12.5, 'pesei o rolo');
  perform testes.igual(testes.saldo(a), 987.50::numeric, 'ajuste');
  begin
    perform public.ajustar_estoque(a, -1, '  ');
    raise exception 'FALHOU: ajuste sem motivo';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  perform public.entrada_rolo(a, 1000);
  perform testes.igual(testes.saldo(a), 1987.50::numeric, 'rolo novo');
  perform testes.como('00000000-0000-0000-0000-00000000000b');
  begin
    perform public.ajustar_estoque(a, 100, 'quero mais');
    raise exception 'FALHOU: Pedro ajustou estoque';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo '17. estoque pode ficar negativo (mostra "faltando")'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja', 5); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  perform testes.igual(testes.saldo(a), -5.00::numeric, 'saldo negativo');
end $$;
rollback;

\echo '18. venda avulsa e painel do mês'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare antes public.v_resumo_mes; depois public.v_resumo_mes;
begin
  select * into antes from public.v_resumo_mes where mes = date_trunc('month', current_date)::date;
  insert into public.vendas (cliente, qtd, preco_unit, custo_unit, entregue, pago) values ('A', 1, 10, 4, true, false);
  insert into public.vendas (cliente, qtd, preco_unit, custo_unit, entregue, pago) values ('B', 2, 5, 2, false, false);
  select * into depois from public.v_resumo_mes where mes = date_trunc('month', current_date)::date;
  perform testes.igual(depois.a_receber - coalesce(antes.a_receber, 0), 10.00::numeric, 'a receber = entregue e não pago');
  perform testes.igual(depois.em_producao - coalesce(antes.em_producao, 0), 10.00::numeric, 'em produção');
  perform testes.igual(depois.faturamento - coalesce(antes.faturamento, 0), 20.00::numeric, 'faturamento');
end $$;
rollback;

\echo '19. Pedro não altera a configuração'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare n int;
begin
  update public.config set valor = '{}'::jsonb where chave = 'marca';
  get diagnostics n = row_count;
  perform testes.igual(n, 0, 'Pedro alterou config');
end $$;
rollback;

\echo '20. venda herda a linha (Pedro ou B2B) do orçamento'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); perform testes.linha(o, 'b2b');
  it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  v := public.aprovar_orcamento(o, 13);
  perform testes.igual((select linha from public.vendas where id = v[1]), 'b2b', 'linha da venda');
  insert into public.vendas (cliente, qtd, preco_unit) values ('Avulsa', 1, 5);
  perform testes.igual((select linha from public.vendas where cliente = 'Avulsa'), 'pedro', 'venda avulsa é do Pedro por padrão');
end $$;
rollback;

\echo '21. datas no horário de Brasília (venda, validade, semana)'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  insert into public.vendas (cliente, qtd, preco_unit) values ('Data', 1, 5);
  perform testes.igual((select data from public.vendas where cliente = 'Data'), hoje, 'data da venda');
  o := testes.orcamento();
  perform testes.igual((select validade from public.orcamentos where id = o), hoje + 7, 'validade');
  it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  perform testes.igual((select semana from public.tarefas where orcamento_item_id = it), date_trunc('week', hoje)::date, 'semana');
end $$;
rollback;

\echo '22. Pedro não cancela orçamento, não soma nem cadastra rolo'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  begin perform public.cancelar_orcamento(o); raise exception 'FALHOU: Pedro cancelou';
  exception when insufficient_privilege then null; end;
  begin perform public.entrada_rolo(a, 500); raise exception 'FALHOU: Pedro somou rolo';
  exception when insufficient_privilege then null; end;
  begin insert into public.filamentos (marca, tipo, cor_nome, custo_kg) values ('x','PLA','x',1); raise exception 'FALHOU: Pedro cadastrou rolo';
  exception when insufficient_privilege then null; end;
  perform testes.igual(testes.saldo(a), 990.00::numeric, 'saldo');
end $$;
rollback;

\echo '23. cancelar não devolve o que já começou a imprimir (mesmo se voltou para a fila)'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; t uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform public.aprovar_orcamento(o, 13);
  select id into t from public.tarefas where orcamento_item_id = it;
  update public.tarefas set status = 'ok' where id = t;
  update public.tarefas set status = 'fila' where id = t;
  perform public.cancelar_orcamento(o);
  perform testes.igual(testes.saldo(a), 990.00::numeric, 'não devolveu');
end $$;
rollback;

\echo '24. aprovar recusa total vazio e gramas que não batem'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; imp uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 13);
  imp := testes.impressao(it, 1, 1, array[a], array[10]);
  begin perform public.aprovar_orcamento(o, null); raise exception 'FALHOU: aprovou com total nulo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform testes.forcar_gramas_placa(imp, 100);
  begin perform public.aprovar_orcamento(o, 13); raise exception 'FALHOU: aprovou placa de 100 g com 10 g nas cores';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if;
    if sqlerrm not like '%não batem%' then raise exception 'FALHOU: mensagem errada: %', sqlerrm; end if; end;
  perform testes.igual(testes.saldo(a), 1000.00::numeric, 'saldo intacto');
end $$;
rollback;

\echo '25. salvar_orcamento grava tudo numa transação e regrava sem perder'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); r record; d jsonb;
begin
  d := jsonb_build_object('orcamento', jsonb_build_object('cliente','João','canal','escola','linha','pedro','desconto_pct',0),
    'itens', jsonb_build_array(jsonb_build_object('descricao','Chaveiro','qtd',2,'extras',0,'custo_total',8,'preco_total',26,'preco_unit',13,
      'impressoes', jsonb_build_array(jsonb_build_object('arquivo_nome','c.3mf','vezes',1,'unidades_por_vez',2,
        'placas', jsonb_build_array(jsonb_build_object('placa',1,'segundos',3600,'gramas',12,
          'filamentos', jsonb_build_array(jsonb_build_object('filamento_id',a,'gramas',12)))))))));
  select * into r from public.salvar_orcamento(null, d);
  perform testes.igual((select count(*) from public.orcamento_itens where orcamento_id = r.id), 1::bigint, 'item criado');
  perform testes.igual((select preco_unit from public.orcamento_itens where orcamento_id = r.id), 13.00::numeric, 'preço bruto guardado');
  d := jsonb_set(d, '{orcamento,cliente}', '"João Silva"');
  perform public.salvar_orcamento(r.id, d);
  perform testes.igual((select cliente from public.orcamentos where id = r.id), 'João Silva', 'regravou');
  perform testes.igual((select count(*) from public.orcamento_itens where orcamento_id = r.id), 1::bigint, 'sem duplicar');
  begin perform public.salvar_orcamento(r.id, jsonb_set(d, '{itens,0,qtd}', '0')); raise exception 'FALHOU: aceitou qtd 0';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform testes.igual((select count(*) from public.orcamento_itens where orcamento_id = r.id), 1::bigint, 'erro não apagou o que havia');
  begin perform public.salvar_orcamento(null, jsonb_set(d, '{orcamento,linha}', '"b2b"')); raise exception 'FALHOU: Pedro salvou B2B';
  exception when insufficient_privilege then null; end;
  perform public.aprovar_orcamento(r.id, 26);
  begin perform public.salvar_orcamento(r.id, d); raise exception 'FALHOU: regravou aprovado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
rollback;

\echo '26. lucro da venda sem erro de centavos'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); it := testes.item(o, 3, 15, 10);
  perform testes.impressao(it, 1, 3, array[a], array[10]);
  v := public.aprovar_orcamento(o, 15);
  perform testes.igual((select lucro from public.vendas where id = v[1]), 5.00::numeric, 'lucro');
end $$;
rollback;

\echo '27. venda avulsa com id do aparelho não duplica ao repetir'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare i uuid := gen_random_uuid();
begin
  insert into public.vendas (id, cliente, qtd, preco_unit) values (i, 'Repete', 1, 5);
  begin insert into public.vendas (id, cliente, qtd, preco_unit) values (i, 'Repete', 1, 5); raise exception 'FALHOU: duplicou';
  exception when unique_violation then null; end;
  perform testes.igual((select count(*) from public.vendas where cliente = 'Repete'), 1::bigint, 'uma venda');
end $$;
rollback;

\echo '28. ninguém apaga foto pela API'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id) values ('fotos', 'teste/x.png', '00000000-0000-0000-0000-00000000000b');
do $$
declare n int;
begin
  delete from storage.objects where bucket_id = 'fotos' and name = 'teste/x.png';
  get diagnostics n = row_count;
  perform testes.igual(n, 0, 'apagou foto');
end $$;
rollback;

\echo '29. frete pago pelo cliente soma no total e vira a venda Frete (lucro 0)'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid; v uuid[];
begin
  o := testes.orcamento(); it := testes.item(o, 1, 20, 8);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform testes.frete(o, 12.5, true);
  begin perform public.aprovar_orcamento(o, 20); raise exception 'FALHOU: aprovou sem o frete no total';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  v := public.aprovar_orcamento(o, 32.5);
  perform testes.igual((select total_aceito from public.orcamentos where id = o), 32.50::numeric, 'total aceito com frete');
  perform testes.igual(array_length(v, 1), 2, 'item + frete');
  perform testes.igual((select sum(total) from public.vendas where orcamento_id = o), 32.50::numeric, 'vendas batem com o total');
  perform testes.igual((select total from public.vendas where orcamento_id = o and descricao = 'Frete'), 12.50::numeric, 'venda Frete');
  perform testes.igual((select lucro from public.vendas where orcamento_id = o and descricao = 'Frete'), 0.00::numeric, 'frete do cliente não é lucro');
end $$;
rollback;

\echo '30. frete pago por mim: total sem frete e o frete sai do lucro'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 20, 8);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform testes.frete(o, 10, false);
  begin perform public.aprovar_orcamento(o, 30); raise exception 'FALHOU: somou frete grátis no total';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.aprovar_orcamento(o, 20);
  perform testes.igual((select sum(total) from public.vendas where orcamento_id = o), 20.00::numeric, 'vendas = total');
  perform testes.igual((select lucro from public.vendas where orcamento_id = o and descricao = 'Frete'), -10.00::numeric, 'frete grátis tira do lucro');
  perform testes.igual((select sum(lucro) from public.vendas where orcamento_id = o), 2.00::numeric, 'lucro total 20 - 8 - 10');
end $$;
rollback;

\echo '31. salvar grava o frete; frete negativo é recusado; sem frete não cria venda Frete'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); d jsonb; r record; v uuid[];
begin
  d := jsonb_build_object('orcamento', jsonb_build_object('cliente','Ana','canal','escola','linha','pedro','desconto_pct',0,'frete',7.5,'frete_cliente',false),
    'itens', jsonb_build_array(jsonb_build_object('descricao','Peça','qtd',1,'custo_total',5,'preco_unit',10,'preco_total',10,
      'impressoes', jsonb_build_array(jsonb_build_object('vezes',1,'unidades_por_vez',1,
        'placas', jsonb_build_array(jsonb_build_object('placa',1,'segundos',600,'gramas',12,
          'filamentos', jsonb_build_array(jsonb_build_object('filamento_id',a,'gramas',12)))))))));
  select * into r from public.salvar_orcamento(null, d);
  perform testes.igual((select frete from public.orcamentos where id = r.id), 7.50::numeric, 'frete gravado');
  perform testes.igual((select frete_cliente from public.orcamentos where id = r.id), false, 'quem paga gravado');
  begin perform public.salvar_orcamento(r.id, jsonb_set(d, '{orcamento,frete}', '-1')); raise exception 'FALHOU: aceitou frete negativo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.salvar_orcamento(r.id, jsonb_set(d, '{orcamento,frete}', '0'));
  v := public.aprovar_orcamento(r.id, 10);
  perform testes.igual(array_length(v, 1), 1, 'sem frete, só a venda do item');
end $$;
rollback;

\echo '32. cancelar orçamento cancela também a venda Frete'
begin; select testes.como('00000000-0000-0000-0000-00000000000a'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; it uuid;
begin
  o := testes.orcamento(); it := testes.item(o, 1, 20, 8);
  perform testes.impressao(it, 1, 1, array[a], array[10]);
  perform testes.frete(o, 5, true);
  perform public.aprovar_orcamento(o, 25);
  perform public.cancelar_orcamento(o);
  perform testes.igual((select bool_and(cancelada) from public.vendas where orcamento_id = o), true, 'todas canceladas');
end $$;
rollback;

\echo '33. Pedro corrige só a cor do rolo; cor inválida é recusada'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); n int;
begin
  perform public.corrigir_cor_rolo(a, '#12ab9f');
  perform testes.igual((select cor_hex from public.filamentos where id = a), '#12AB9F', 'cor trocada');
  begin perform public.corrigir_cor_rolo(a, 'vermelho'); raise exception 'FALHOU: aceitou cor inválida';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  update public.filamentos set custo_kg = 1 where id = a;
  get diagnostics n = row_count;
  perform testes.igual(n, 0, 'Pedro mudou o preço do rolo');
end $$;
rollback;

\echo '34. login fora de perfis não corrige cor'
begin; select testes.como('00000000-0000-0000-0000-00000000000c'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja');
begin
  begin perform public.corrigir_cor_rolo(a, '#000000'); raise exception 'FALHOU: estranho corrigiu cor';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
rollback;

\echo '35. venda Frete segue os itens no banco (pago/entregue quando todos estão)'
begin; select testes.como('00000000-0000-0000-0000-00000000000b'); set local role authenticated;
do $$
declare a uuid := testes.rolo('Laranja'); o uuid; i1 uuid; i2 uuid; v1 uuid; v2 uuid;
begin
  o := testes.orcamento(); i1 := testes.item(o, 1, 10, 4); i2 := testes.item(o, 1, 10, 4);
  perform testes.impressao(i1, 1, 1, array[a], array[5]); perform testes.impressao(i2, 1, 1, array[a], array[5]);
  perform testes.frete(o, 6, true);
  perform public.aprovar_orcamento(o, 26);
  select id into v1 from public.vendas where orcamento_item_id = i1; select id into v2 from public.vendas where orcamento_item_id = i2;
  update public.vendas set pago = true, entregue = true where id = v1;
  perform testes.igual((select pago from public.vendas where orcamento_id = o and descricao = 'Frete'), false, 'frete pago com um item só');
  update public.vendas set pago = true where id = v2;
  perform testes.igual((select pago from public.vendas where orcamento_id = o and descricao = 'Frete'), true, 'frete pago com os dois');
  perform testes.igual((select entregue from public.vendas where orcamento_id = o and descricao = 'Frete'), false, 'frete entregue antes da hora');
  update public.vendas set pago = false where id = v1;
  perform testes.igual((select pago from public.vendas where orcamento_id = o and descricao = 'Frete'), false, 'frete voltou a não pago');
end $$;
rollback;

-- ---------- limpeza ----------
delete from public.perfis where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b');
delete from auth.users where id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
drop schema testes cascade;
\echo 'TODOS OS TESTES DO BANCO PASSARAM'
