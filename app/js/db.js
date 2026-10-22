// Único ponto de contato com o Supabase. Tudo devolve { dados, erro } com erro em português.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE } from './config.js';
import { traduzirErro } from './erros.js';

export const configurado = Boolean(SUPABASE.url && SUPABASE.key);
export const cliente = configurado
  ? createClient(SUPABASE.url, SUPABASE.key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const resultado = (r) => ({ dados: r.error ? null : r.data, erro: r.error ? traduzirErro(r.error) : null });
async function seguro(fn) {
  try { return resultado(await fn()); } catch (e) { return { dados: null, erro: traduzirErro(e) }; }
}

export async function entrar(email, senha) {
  return seguro(() => cliente.auth.signInWithPassword({ email: email.trim(), password: senha }));
}

export async function sair() { await cliente.auth.signOut(); }

export async function usuario() {
  if (!cliente) return null;
  const { data } = await cliente.auth.getSession();
  return data.session?.user ?? null;
}

export function aoMudarSessao(fn) {
  if (!cliente) return null;
  return cliente.auth.onAuthStateChange((evento, sessao) => fn(evento, sessao));
}

// { papel: 'marcos'|'pedro', nome } ou null se o login não está em perfis
export async function perfil() {
  const u = await usuario();
  if (!u) return { dados: null, erro: null };
  return seguro(() => cliente.from('perfis').select('papel, nome').eq('user_id', u.id).maybeSingle());
}

// consulta(tabela) → builder do supabase-js; use .listar(q => q.select(...).eq(...))
export async function listar(tabela, montar = (q) => q.select('*')) {
  return seguro(() => montar(cliente.from(tabela)));
}

export async function inserir(tabela, linha, colunas = '*') {
  return seguro(() => cliente.from(tabela).insert(linha).select(colunas).single());
}

export async function atualizar(tabela, id, mudancas, colunas = '*') {
  return seguro(() => cliente.from(tabela).update(mudancas).eq('id', id).select(colunas).maybeSingle());
}

export async function apagar(tabela, id) {
  return seguro(() => cliente.from(tabela).delete().eq('id', id));
}

export async function rpc(nome, args) {
  return seguro(() => cliente.rpc(nome, args));
}

export async function foto(caminho) {
  if (!caminho) return { dados: null, erro: null };
  return seguro(() => cliente.storage.from('fotos').download(caminho));
}

export async function enviarFoto(blob) {
  const caminho = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.png`;
  const r = await seguro(() => cliente.storage.from('fotos').upload(caminho, blob, { contentType: blob.type || 'image/png' }));
  return r.erro ? r : { dados: caminho, erro: null };
}

// todos os caminhos do bucket de fotos (pastas por mês: 2026-10/uuid.png) — para a cópia de segurança
export async function listarFotos() {
  const pasta = async (prefixo) => {
    const itens = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await seguro(() => cliente.storage.from('fotos').list(prefixo, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }));
      if (r.erro) return r;
      itens.push(...r.dados);
      if (r.dados.length < 1000) return { dados: itens, erro: null };
    }
  };
  const raiz = await pasta('');
  if (raiz.erro) return raiz;
  const caminhos = [];
  for (const e of raiz.dados) {
    if (e.id) { caminhos.push(e.name); continue; }          // arquivo solto na raiz
    const sub = await pasta(e.name);                          // pasta do mês
    if (sub.erro) return sub;
    caminhos.push(...sub.dados.filter((f) => f.id).map((f) => `${e.name}/${f.name}`));
  }
  return { dados: caminhos, erro: null };
}
