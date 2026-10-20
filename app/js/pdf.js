// PDF do orçamento para o CLIENTE (P2: sem custo e sem lucro).
// jsPDF é injetado (window.jspdf.jsPDF no navegador, pacote no teste).
import { numeroOrc } from './formato.js';

const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const formatoImg = (dataUrl) => (String(dataUrl).startsWith('data:image/jpeg') ? 'JPEG' : 'PNG');

export function gerarPdfOrcamento(JsPDF, d) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15;
  const laranja = [255, 138, 61], escuro = [40, 28, 18], dim = [110, 98, 84];

  // Faixa do topo
  doc.setFillColor(22, 17, 13); doc.rect(0, 0, W, 36, 'F');
  doc.setFillColor(...laranja); doc.rect(0, 34, W, 2, 'F');
  let x = M;
  if (d.marca?.logo) { try { doc.addImage(d.marca.logo, formatoImg(d.marca.logo), M, 7, 22, 22); x = M + 27; } catch { /* logo inválido: segue sem */ } }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text(d.marca?.nome || 'Ateliê 3D', x, 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(200, 180, 160);
  const contato = [d.marca?.fone, d.marca?.instagram].filter(Boolean).join('   ');
  if (contato) doc.text(contato, x, 24);
  doc.setTextColor(...laranja); doc.setFont('helvetica', 'bold'); doc.text('ORÇAMENTO ' + numeroOrc(d.numero), W - M, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 180, 160);
  doc.text('Data: ' + dataBR(d.data), W - M, 21, { align: 'right' });
  doc.text('Validade: ' + dataBR(d.validade), W - M, 26, { align: 'right' });

  // Cliente
  let y = 48;
  doc.setTextColor(...dim); doc.setFontSize(9); doc.text('PARA', M, y);
  doc.setTextColor(...escuro); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(d.cliente, M, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  if (d.contato) { doc.setTextColor(...dim); doc.text(d.contato, M, y + 13); }
  y += 24;

  // Itens
  doc.setDrawColor(220, 200, 180); doc.setFontSize(9); doc.setTextColor(...dim);
  doc.text('ITEM', M, y); doc.text('QTD', 125, y, { align: 'right' }); doc.text('UNITÁRIO', 160, y, { align: 'right' }); doc.text('TOTAL', W - M, y, { align: 'right' });
  doc.line(M, y + 2, W - M, y + 2); y += 9;
  doc.setFontSize(11);
  for (const it of d.itens) {
    const alto = it.foto ? 24 : 9;
    if (y + alto > 270) { doc.addPage(); y = 20; }
    let tx = M;
    if (it.foto) { try { doc.addImage(it.foto, formatoImg(it.foto), M, y - 5, 20, 20); tx = M + 24; } catch { /* sem foto */ } }
    doc.setTextColor(...escuro);
    doc.text(doc.splitTextToSize(it.descricao, 125 - tx - 18), tx, y);
    doc.text(String(it.qtd), 125, y, { align: 'right' });
    doc.text(brl(it.precoUnit), 160, y, { align: 'right' });
    doc.text(brl(it.qtd * it.precoUnit), W - M, y, { align: 'right' });
    y += alto;
    doc.line(M, y - 4, W - M, y - 4);
  }

  // Totais
  y += 4;
  doc.setFontSize(11); doc.setTextColor(...dim);
  if (Number(d.descontoPct) > 0) {
    doc.text('Subtotal', 150, y, { align: 'right' }); doc.setTextColor(...escuro); doc.text(brl(d.subtotal), W - M, y, { align: 'right' }); y += 7;
    doc.setTextColor(...dim); doc.text(`Desconto (${String(d.descontoPct).replace('.', ',')}%)`, 150, y, { align: 'right' });
    doc.setTextColor(...escuro); doc.text('- ' + brl(Number(d.subtotal) - Number(d.total)), W - M, y, { align: 'right' }); y += 9;
  }
  doc.setFillColor(...laranja); doc.roundedRect(110, y - 6, W - M - 110, 14, 3, 3, 'F');
  doc.setTextColor(26, 14, 5); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Total', 115, y + 3); doc.text(brl(d.total), W - M - 5, y + 3, { align: 'right' });

  // Condições
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...dim);
  doc.text(`Orçamento válido até ${dataBR(d.validade)}. Prazo de entrega combinado na aprovação.`, M, 285);
  return doc;
}
