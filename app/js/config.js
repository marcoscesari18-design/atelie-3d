// Onde está o banco. No computador (localhost) usa o Supabase LOCAL de teste;
// publicado, usa o projeto de verdade da conta pessoal (chave publishable — pública por natureza,
// a proteção é o RLS do banco). NUNCA colocar a secret key aqui.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const SUPABASE = LOCAL
  ? {
      url: 'http://127.0.0.1:55321',
      // chave anon de demonstração que vem em todo Supabase local (não serve fora deste computador)
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    }
  : {
      url: '', // preencher na Task 7 com a Project URL do projeto atelie-3d
      key: '', // preencher na Task 7 com a Publishable key (sb_publishable_…)
    };

export const AMBIENTE = LOCAL ? 'teste local' : 'produção';
