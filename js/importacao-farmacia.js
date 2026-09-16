/* =============================================================
   Vettore — importacao-farmacia.js — v0.34.0
   Lê uma planilha (.xlsx/.xls/.csv) no navegador (SheetJS) e
   importa as movimentações direto pro Supabase, em lotes.
   Colunas esperadas, nessa ordem, a partir da linha "Data":
   Data | Turno | Colaborador | E/S | Material | Lote | Validade |
   Destino | Nome do Paciente | Nota Fiscal | Qtde
   ============================================================= */

let PlanilhaImportacao = null; // workbook carregado pelo SheetJS
const ContextoImportacao = { municipioId: null, unidadeId: null };

async function carregarMunicipiosImportacaoSePreciso() {
  const sel = document.getElementById('imp-municipio');
  if (sel && sel.options.length <= 1) await carregarMunicipiosImportacao();
}

async function carregarMunicipiosImportacao() {
  const sel = document.getElementById('imp-municipio');
  const { data, error } = await sb.from('municipio').select('id, nome, uf').eq('ativo', true).order('nome');
  if (error) { console.error('[Vettore] municípios (importação):', error); return; }
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (data || []).map(m => `<option value="${m.id}">${escapar(m.nome)}/${escapar(m.uf)}</option>`).join('');
}

async function carregarInstituicoesImportacao(municipioId) {
  const sel = document.getElementById('imp-instituicao');
  if (!municipioId) {
    sel.innerHTML = '<option value="">Selecione o município primeiro</option>';
    return;
  }
  sel.innerHTML = '<option value="">Carregando…</option>';
  const { data, error } = await sb.from('unidade_saude')
    .select('id, nome, tipo').eq('municipio_id', municipioId).eq('ativo', true).order('nome');
  if (error) { sel.innerHTML = '<option value="">Falha ao carregar</option>'; console.error('[Vettore] unidades (importação):', error); return; }
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (data || []).map(u => `<option value="${u.id}">${escapar(u.nome)} (${escapar(u.tipo)})</option>`).join('');
}

function atualizarBotaoProcessar() {
  const abaEscolhida = document.getElementById('imp-aba').value;
  document.getElementById('imp-processar').disabled =
    !(PlanilhaImportacao && ContextoImportacao.unidadeId && abaEscolhida);
}

function limparTextoImportacao(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function paraNumeroImportacao(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/[\d.,]+/);
  if (!m) return null;
  return parseFloat(m[0].replace(',', '.'));
}

function paraDataISOImportacao(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const barras = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (barras) {
    let ano = barras[3];
    if (ano.length === 2) ano = '20' + ano;
    return `${ano}-${barras[2].padStart(2, '0')}-${barras[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function processarImportacao() {
  const aviso = document.getElementById('imp-aviso');
  const resumo = document.getElementById('imp-resumo');
  const progresso = document.getElementById('imp-progresso');
  const progressoTexto = document.getElementById('imp-progresso-texto');
  const barra = document.getElementById('imp-barra');
  limparAviso(aviso);
  resumo.innerHTML = '';

  const nomeAba = document.getElementById('imp-aba').value;
  const planilha = PlanilhaImportacao.Sheets[nomeAba];
  const linhas = XLSX.utils.sheet_to_json(planilha, { header: 1, raw: true, defval: null });

  // Acha a linha de cabeçalho procurando "Data" na primeira coluna,
  // nas primeiras linhas (a planilha original tem um título por cima).
  let linhaCabecalho = -1;
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    if (String(linhas[i]?.[0] || '').trim().toLowerCase() === 'data') { linhaCabecalho = i; break; }
  }
  if (linhaCabecalho === -1) {
    mostrarAviso(aviso, 'Não achei a linha de cabeçalho — precisa ter "Data" na primeira coluna de alguma das 10 primeiras linhas.');
    return;
  }

  const registros = [];
  let semData = 0, semMaterial = 0, semQtde = 0;

  for (let i = linhaCabecalho + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l || !l[0]) continue;

    const tipoBruto = limparTextoImportacao(l[3]);
    if (tipoBruto !== 'E' && tipoBruto !== 'S') continue; // pula cabeçalho repetido / lixo

    const data = paraDataISOImportacao(l[0]);
    const material = limparTextoImportacao(l[4]);
    const qtde = paraNumeroImportacao(l[10]);

    if (!data) { semData++; continue; }
    if (!material) { semMaterial++; continue; }
    if (!qtde || qtde <= 0) { semQtde++; continue; }

    registros.push({
      unidade_saude_id: ContextoImportacao.unidadeId,
      data,
      turno: limparTextoImportacao(l[1]),
      colaborador: limparTextoImportacao(l[2]),
      tipo: tipoBruto === 'E' ? 'Entrada' : 'Saída',
      material,
      lote: limparTextoImportacao(l[5]),
      validade: paraDataISOImportacao(l[6]),
      destino: limparTextoImportacao(l[7]),
      nome_paciente: limparTextoImportacao(l[8]),
      nota_fiscal: limparTextoImportacao(l[9]),
      qtde
    });
  }

  if (!registros.length) {
    mostrarAviso(aviso, 'Nenhuma linha válida encontrada pra importar.');
    return;
  }

  const descartadas = semData + semMaterial + semQtde;
  const mensagem = `Vai importar ${registros.length} movimentações pra essa unidade`
    + (descartadas ? ` (${descartadas} linhas serão ignoradas: ${semData} sem data, ${semMaterial} sem material, ${semQtde} sem quantidade válida).` : '.')
    + ' Confirma?';
  if (!confirm(mensagem)) return;

  document.getElementById('imp-processar').disabled = true;
  progresso.hidden = false;
  barra.value = 0;

  const LOTE = 500;
  let importadas = 0, falhas = 0;

  for (let i = 0; i < registros.length; i += LOTE) {
    const fatia = registros.slice(i, i + LOTE);
    const { error } = await sb.from('movimentacao_estoque').insert(fatia);
    if (error) { falhas += fatia.length; console.error('[Vettore] importação:', error); }
    else importadas += fatia.length;

    const feitas = Math.min(i + LOTE, registros.length);
    barra.value = Math.round((feitas / registros.length) * 100);
    progressoTexto.textContent = `${feitas} de ${registros.length}…`;
  }

  progresso.hidden = true;
  document.getElementById('imp-processar').disabled = false;

  resumo.innerHTML = `
    <div class="aviso ok">
      Importação concluída: <strong>${importadas}</strong> lançamentos importados.
      ${falhas ? `<br>${falhas} falharam ao salvar — veja o console (F12) pro motivo.` : ''}
      ${descartadas ? `<br>${descartadas} linhas da planilha foram ignoradas (sem data, material ou quantidade válida).` : ''}
    </div>`;

  registrarAuditoria('movimentacao_estoque', ContextoImportacao.unidadeId, 'INSERIR');
  if (subAbaFarmaciaAtual === 'movimentacao') await carregarHistoricoFarmacia();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('imp-municipio')?.addEventListener('change', e => {
    ContextoImportacao.municipioId = e.target.value || null;
    carregarInstituicoesImportacao(ContextoImportacao.municipioId);
    atualizarBotaoProcessar();
  });

  document.getElementById('imp-instituicao')?.addEventListener('change', e => {
    ContextoImportacao.unidadeId = e.target.value || null;
    atualizarBotaoProcessar();
  });

  document.getElementById('imp-arquivo')?.addEventListener('change', async e => {
    const aviso = document.getElementById('imp-aviso');
    const resumo = document.getElementById('imp-resumo');
    limparAviso(aviso);
    resumo.innerHTML = '';
    PlanilhaImportacao = null;

    const arquivo = e.target.files[0];
    const selAba = document.getElementById('imp-aba');
    if (!arquivo) {
      selAba.innerHTML = '<option value="">Escolha um arquivo primeiro</option>';
      atualizarBotaoProcessar();
      return;
    }

    try {
      const dados = await arquivo.arrayBuffer();
      PlanilhaImportacao = XLSX.read(dados, { type: 'array', cellDates: true });
      selAba.innerHTML = PlanilhaImportacao.SheetNames.map(n => `<option>${escapar(n)}</option>`).join('');
    } catch (err) {
      mostrarAviso(aviso, 'Não consegui ler esse arquivo. Confira se é .xlsx, .xls ou .csv.');
      console.error('[Vettore] ler planilha:', err);
      selAba.innerHTML = '<option value="">Escolha um arquivo primeiro</option>';
    }
    atualizarBotaoProcessar();
  });

  document.getElementById('imp-aba')?.addEventListener('change', atualizarBotaoProcessar);
  document.getElementById('imp-processar')?.addEventListener('click', processarImportacao);
});
