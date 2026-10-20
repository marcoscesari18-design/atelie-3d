// Transforma erro do Supabase/rede em frase curta em português, sem jargão.

const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function traduzirErro(erro) {
  if (!erro) return '';
  const msg = String(erro.message || '');
  const code = erro.code || '';
  if (erro instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'Sem conexão. Nada foi salvo — tente de novo.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha não conferem.';
  if (code === 'PGRST301' || /JWT expired|session.*(missing|expired)/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
  if (code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return msg === 'sem acesso' || msg.startsWith('só o Marcos') ? `${capitalizar(msg)}.` : 'Você não tem permissão para fazer isso.';
  }
  if (code === 'P0001' || code === 'P0002') return `${capitalizar(msg.replace(/\.$/, ''))}.`;
  if (code === '23514') return 'Algum valor está fora do permitido. Confira os campos.';
  return 'Algo deu errado. Tente de novo; se continuar, avise o Marcos.';
}
