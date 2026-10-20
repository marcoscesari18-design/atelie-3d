"""Converte a planilha de estoque de filamentos (Marca | material | cor | KG | valor kg | refil)
em SQL de carga para a tabela public.filamentos do Ateliê 3D.

Uso:  python3 -I ferramentas/planilha_para_sql.py "<planilha.xlsx>" > supabase/local/estoque-inicial.sql

- KG = quanto SOBRA no rolo hoje (confirmado pelo Marcos em 19/10/2026) → gramas_iniciais.
- Tipo vira o material base (PLA/PETG/TPU…), que é o que o Bambu Studio grava no .3mf;
  a linha (Lite, Matte, Silk) fica no nome da cor / observação.
- A cor em código (#RRGGBB) é sugerida pelo nome; o Marcos confere no app e corrige se precisar.
- Sem dependências: lê o .xlsx como zip.
"""
import html
import re
import sys
import unicodedata
import zipfile

# nome (sem acento, minúsculo) → (nome corrigido, cor sugerida)
CORES = {
    'cyan': ('Ciano', '#00AEEF'), 'black': ('Preto', '#1A1A1A'), 'green': ('Verde', '#00A651'), 'red': ('Vermelho', '#D72A26'),
    'laranja': ('Laranja', '#FF6A13'), 'rosa': ('Rosa', '#F49AC1'), 'white': ('Branco', '#F5F5F5'),
    'cocoa brown': ('Cocoa Brown', '#6F4E37'), 'matte beige': ('Matte Bege', '#D8C3A5'), 'vermelho': ('Vermelho', '#C8102E'),
    'fosforescente verde escuro': ('Fosforescente Verde Escuro', '#5B8C2A'), 'caramelo': ('Caramelo', '#C68E3F'),
    'gray': ('Cinza', '#8E9089'), 'dark gray': ('Cinza Escuro', '#545454'), 'amarelo': ('Amarelo', '#FFD200'),
    'silk fuchsia': ('Silk Fúcsia', '#E0218A'), 'silk branco': ('Silk Branco', '#F2F2F2'), 'peeacock blue': ('Peacock Blue', '#006D8F'),
    'preto': ('Preto', '#1A1A1A'), 'matte sunrise orange': ('Matte Sunrise Orange', '#F28C28'), 'silk lavanda': ('Silk Lavanda', '#B57EDC'),
    'verde': ('Verde', '#2E8B57'), 'roxo': ('Roxo', '#6A2C91'), 'verde limao': ('Verde Limão', '#9ACD32'), 'azul': ('Azul', '#0072CE'),
    'cilk happy raenbow': ('Silk Happy Rainbow', '#C77DFF'), 'branco': ('Branco', '#F5F5F5'),
    'matte earth brow': ('Matte Earth Brown', '#7B5B3A'), 'deserto': ('Deserto', '#C2A878'),
}
MARCAS = {'bambulab': 'Bambu Lab', 'multifila': 'Multifila', 'generica': 'Genérica', 'masterprint': 'Masterprint'}


def chave(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z ]', '', s.lower()).strip()


def ler_planilha(caminho):
    z = zipfile.ZipFile(caminho)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        x = z.read('xl/sharedStrings.xml').decode()
        ss = [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))) for si in re.findall(r'<si>(.*?)</si>', x, re.S)]
    x = z.read('xl/worksheets/sheet1.xml').decode()
    linhas = []
    for row in re.findall(r'<row[^>]*>(.*?)</row>', x, re.S):
        cel = {}
        for c in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
            col, attr, corpo = c.groups()
            m = re.search(r'<v>(.*?)</v>', corpo or '')
            if m:
                cel[col] = ss[int(m.group(1))] if 't="s"' in attr else m.group(1)
        linhas.append(cel)
    return linhas


def tipo_e_linha(material):
    m = material.strip().lower()
    for base in ('petg', 'tpu', 'abs', 'asa', 'pla'):
        if base in m:
            resto = m.replace(base, '').strip()
            return base.upper(), resto.title() if resto else ''
    return material.strip().upper(), ''


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def main(caminho):
    linhas = ler_planilha(caminho)
    saida = ['-- Estoque inicial do Ateliê 3D, gerado de "lista filamentos .xlsx" (KG = quanto sobra).',
             '-- Rodar UMA vez no SQL Editor do Supabase, depois do schema.sql.',
             'begin;']
    n = 0
    for cel in linhas[1:]:
        if not cel.get('A') or not cel.get('C'):
            continue  # linha de total / vazia
        marca = MARCAS.get(chave(cel['A']), cel['A'].strip().title())
        tipo, linha = tipo_e_linha(cel.get('B', ''))
        nome, hexa = CORES.get(chave(cel['C']), (cel['C'].strip().title(), '#888888'))
        gramas = round(float(cel.get('D', '0').replace(',', '.')) * 1000, 2)
        custo = round(float(cel.get('E', '0').replace(',', '.')), 2)
        obs = ', '.join(x for x in [f'{tipo} {linha}'.strip() if linha else '', 'refil' if chave(cel.get('F', '')) == 'sim' else ''] if x)
        saida.append('insert into public.filamentos (marca, tipo, cor_nome, cor_hex, custo_kg, gramas_iniciais, obs) values '
                     f"({q(marca)}, {q(tipo)}, {q(nome)}, {q(hexa)}, {custo}, {gramas}, {q(obs) if obs else 'null'});")
        n += 1
    saida.append(f'-- {n} rolos')
    saida.append('commit;')
    print('\n'.join(saida))


if __name__ == '__main__':
    main(sys.argv[1])
