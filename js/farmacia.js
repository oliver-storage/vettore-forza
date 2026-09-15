/* =============================================================
   Vettore — farmacia.js — v0.32.0
   Movimentação de estoque (entrada/saída) por unidade de saúde,
   e catálogo de materiais (MMH) por município, em sub-abas.
   ============================================================= */

const ContextoFarmacia = { municipioId: null, unidadeId: null };
const ContextoMMH = { municipioId: null };
let LISTAS_OPCAO_FARMACIA = null;
let subAbaFarmaciaAtual = 'movimentacao';

function irParaSubAbaFarmacia(nome) {
  subAbaFarmaciaAtual = nome;
  document.querySelectorAll('.sub-aba-farmacia').forEach(b =>
    b.setAttribute('aria-selected', b.dataset.subf === nome));
  document.querySelectorAll('.painel-farmacia').forEach(p =>
    p.hidden = p.dataset.subf !== nome);

  if (nome === 'mmh' && document.getElementById('farm-mmh-municipio').options.length <= 1) {
    carregarMunicipiosMMH();
  }
}

async function carregarMunicipiosFarmacia() {
  const sel = document.getElementById('farm-municipio');
  const { data, error } = await sb.from('municipio').select('id, nome, uf').eq('ativo', true).order('nome');
  if (error) { console.error('[Vettore] municípios (farmácia):', error); return; }
  const opcoes = '<option value="">Selecione…</option>' +
    (data || []).map(m => `<option value="${m.id}">${escapar(m.nome)}/${escapar(m.uf)}</option>`).join('');
  sel.innerHTML = opcoes;
}

async function carregarInstituicoesFarmacia(municipioId) {
  const sel = document.getElementById('farm-instituicao');
  document.getElementById('farm-conteudo').hidden = true;
  if (!municipioId) {
    sel.innerHTML = '<option value="">Selecione o município primeiro</option>';
    return;
  }
  sel.innerHTML = '<option value="">Carregando…</option>';
  const { data, error } = await sb.from('unidade_saude')
    .select('id, nome, tipo').eq('municipio_id', municipioId).eq('ativo', true).order('nome');
  if (error) { sel.innerHTML = '<option value="">Falha ao carregar</option>'; console.error('[Vettore] unidades (farmácia):', error); return; }
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (data || []).map(u => `<option value="${u.id}">${escapar(u.nome)} (${escapar(u.tipo)})</option>`).join('');
}

async function garantirListasOpcaoFarmacia() {
  if (LISTAS_OPCAO_FARMACIA) return LISTAS_OPCAO_FARMACIA;
  const { data, error } = await sb.from('farmacia_lista_opcao').select('*').order('valor');
  if (error) { console.error('[Vettore] farmacia_lista_opcao:', error); return {}; }
  LISTAS_OPCAO_FARMACIA = {};
  (data || []).forEach(o => { (LISTAS_OPCAO_FARMACIA[o.lista] = LISTAS_OPCAO_FARMACIA[o.lista] || []).push(o.valor); });
  return LISTAS_OPCAO_FARMACIA;
}

async function abrirUnidadeFarmacia(unidadeId) {
  ContextoFarmacia.unidadeId = unidadeId;
  document.getElementById('farm-conteudo').hidden = !unidadeId;
  if (!unidadeId) return;

  const listas = await garantirListasOpcaoFarmacia();
  document.getElementById('farm-turno').innerHTML =
    (listas['Turno'] || []).map(v => `<option>${escapar(v)}</option>`).join('');
  document.getElementById('farm-destino').innerHTML = '<option value="">—</option>' +
    (listas['Destino'] || []).map(v => `<option>${escapar(v)}</option>`).join('');

  document.getElementById('farm-data').value = new Date().toISOString().slice(0, 10);
  await carregarDatalistMateriais(ContextoFarmacia.municipioId);
  await carregarHistoricoFarmacia();
}

// Datalist do formulário de movimentação — só sugere, sem editor.
async function carregarDatalistMateriais(municipioId) {
  const { data, error } = await sb.from('farmacia_material')
    .select('nome').eq('municipio_id', municipioId).eq('ativo', true).order('nome');
  if (error) { console.error('[Vettore] farmacia_material:', error); return; }
  document.getElementById('farm-lista-materiais').innerHTML =
    (data || []).map(m => `<option value="${escapar(m.nome)}">`).join('');
}

/* -------- Sub-aba MMH: gerenciar a lista de materiais -------- */

async function carregarMunicipiosMMH() {
  const sel = document.getElementById('farm-mmh-municipio');
  const { data, error } = await sb.from('municipio').select('id, nome, uf').eq('ativo', true).order('nome');
  if (error) { console.error('[Vettore] municípios (MMH):', error); return; }
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (data || []).map(m => `<option value="${m.id}">${escapar(m.nome)}/${escapar(m.uf)}</option>`).join('');
}

async function abrirMunicipioMMH(municipioId) {
  ContextoMMH.municipioId = municipioId;
  document.getElementById('farm-painel-materiais').hidden = !municipioId;
  if (!municipioId) return;
  await carregarEditorMateriais();
}

async function carregarEditorMateriais() {
  const editor = document.getElementById('farm-lista-materiais-editor');
  const { data, error } = await sb.from('farmacia_material')
    .select('*').eq('municipio_id', ContextoMMH.municipioId).eq('ativo', true).order('nome');
  if (error) { console.error('[Vettore] farmacia_material (editor):', error); return; }

  editor.innerHTML = (data || []).map(m => `
    <span class="chip-arquivo">
      ${escapar(m.nome)}
      <button type="button" class="excluir-arquivo" data-excluir-material="${m.id}" title="Remover">✕</button>
    </span>`).join('') || '<div class="vazio">Nenhum material cadastrado ainda.</div>';
}

async function adicionarMaterialFarmacia() {
  const input = document.getElementById('farm-novo-material');
  const aviso = document.getElementById('farm-aviso-material');
  limparAviso(aviso);
  const nome = input.value.trim();
  if (!nome) return;

  const { error } = await sb.from('farmacia_material').insert({
    municipio_id: ContextoMMH.municipioId, nome, criado_por: Sessao.perfil.id
  });
  if (error) {
    mostrarAviso(aviso, /duplicate|unique/i.test(error.message) ? 'Esse material já está na lista.' : 'Não foi possível adicionar.');
    console.error('[Vettore] adicionar material:', error);
    return;
  }
  input.value = '';
  await carregarEditorMateriais();
}

async function excluirMaterialFarmacia(id) {
  if (!confirm('Remover este material da lista?')) return;
  const { error } = await sb.from('farmacia_material').delete().eq('id', id);
  if (error) { alert('Não foi possível remover.'); console.error('[Vettore] excluir material:', error); return; }
  await carregarEditorMateriais();
}

async function carregarHistoricoFarmacia() {
  const alvo = document.getElementById('farm-historico');
  const { data, error } = await sb.from('movimentacao_estoque')
    .select('*').eq('unidade_saude_id', ContextoFarmacia.unidadeId)
    .order('data', { ascending: false }).order('criado_em', { ascending: false })
    .limit(200);

  if (error) { alvo.innerHTML = '<div class="vazio">Não foi possível carregar o histórico.</div>'; console.error('[Vettore] histórico farmácia:', error); return; }
  if (!data || !data.length) { alvo.innerHTML = '<div class="vazio">Nenhuma movimentação registrada ainda.</div>'; return; }

  const podeExcluir = pode('farmacia.excluir');
  alvo.innerHTML = `
    <div class="tabela-historico-wrap">
    <table class="tabela-historico">
      <thead><tr>
        <th>Data</th><th>Turno</th><th>Tipo</th><th>Material</th><th>Lote</th>
        <th>Validade</th><th>Destino</th><th>Paciente</th><th>NF</th><th>Qtde</th><th>Colaborador</th>
        ${podeExcluir ? '<th></th>' : ''}
      </tr></thead>
      <tbody>
        ${data.map(m => `
          <tr>
            <td>${formatarDataBR(m.data)}</td>
            <td>${escapar(m.turno || '—')}</td>
            <td class="${m.tipo === 'Entrada' ? 'tag-entrada' : 'tag-saida'}">${escapar(m.tipo)}</td>
            <td>${escapar(m.material)}</td>
            <td>${escapar(m.lote || '—')}</td>
            <td>${m.validade ? formatarDataBR(m.validade) : '—'}</td>
            <td>${escapar(m.destino || '—')}</td>
            <td>${escapar(m.nome_paciente || '—')}</td>
            <td>${escapar(m.nota_fiscal || '—')}</td>
            <td>${m.qtde}</td>
            <td>${escapar(m.colaborador || '—')}</td>
            ${podeExcluir ? `<td><button type="button" class="excluir-arquivo" data-excluir-movimentacao="${m.id}" title="Excluir">✕</button></td>` : ''}
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

async function salvarMovimentacaoFarmacia() {
  const aviso = document.getElementById('farm-aviso');
  limparAviso(aviso);
  const botao = document.getElementById('farm-salvar');

  const dados = {
    unidade_saude_id: ContextoFarmacia.unidadeId,
    data: document.getElementById('farm-data').value,
    turno: document.getElementById('farm-turno').value || null,
    tipo: document.getElementById('farm-tipo').value,
    colaborador: document.getElementById('farm-colaborador').value.trim() || null,
    material: document.getElementById('farm-material').value.trim(),
    lote: document.getElementById('farm-lote').value.trim() || null,
    validade: document.getElementById('farm-validade').value || null,
    destino: document.getElementById('farm-destino').value || null,
    nome_paciente: document.getElementById('farm-paciente').value.trim() || null,
    nota_fiscal: document.getElementById('farm-nf').value.trim() || null,
    qtde: Number(document.getElementById('farm-qtde').value),
    criado_por: Sessao.perfil.id
  };

  if (!dados.material) return mostrarAviso(aviso, 'Informe o material.');
  if (!dados.qtde || dados.qtde <= 0) return mostrarAviso(aviso, 'Informe uma quantidade maior que zero.');
  if (!dados.data) return mostrarAviso(aviso, 'Informe a data.');

  botao.disabled = true;
  botao.textContent = 'Salvando…';

  const { data: registro, error } = await sb.from('movimentacao_estoque').insert(dados).select().single();

  botao.disabled = false;
  botao.textContent = 'Lançar movimentação';

  if (error) {
    mostrarAviso(aviso, 'Não foi possível salvar. Confira as permissões.');
    console.error('[Vettore] salvar movimentação:', error);
    return;
  }

  registrarAuditoria('movimentacao_estoque', registro.id, 'INSERIR');
  mostrarAviso(aviso, 'Movimentação lançada.', 'ok');

  ['farm-colaborador', 'farm-material', 'farm-lote', 'farm-validade', 'farm-paciente', 'farm-nf', 'farm-qtde']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('farm-destino').value = '';

  await carregarHistoricoFarmacia();
}

async function excluirMovimentacaoFarmacia(id) {
  if (!confirm('Excluir esta movimentação?')) return;
  const { error } = await sb.from('movimentacao_estoque').delete().eq('id', id);
  if (error) { alert('Não foi possível excluir. Confira as permissões.'); console.error('[Vettore] excluir movimentação:', error); return; }
  registrarAuditoria('movimentacao_estoque', id, 'EXCLUIR');
  await carregarHistoricoFarmacia();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sub-aba-farmacia').forEach(b =>
    b.addEventListener('click', () => irParaSubAbaFarmacia(b.dataset.subf)));

  document.getElementById('farm-municipio')?.addEventListener('change', e => {
    ContextoFarmacia.municipioId = e.target.value || null;
    carregarInstituicoesFarmacia(ContextoFarmacia.municipioId);
  });
  document.getElementById('farm-instituicao')?.addEventListener('change', e =>
    abrirUnidadeFarmacia(e.target.value || null));
  document.getElementById('farm-salvar')?.addEventListener('click', salvarMovimentacaoFarmacia);
  document.getElementById('farm-historico')?.addEventListener('click', e => {
    const botao = e.target.closest('[data-excluir-movimentacao]');
    if (botao) excluirMovimentacaoFarmacia(botao.dataset.excluirMovimentacao);
  });

  document.getElementById('farm-mmh-municipio')?.addEventListener('change', e =>
    abrirMunicipioMMH(e.target.value || null));
  document.getElementById('farm-add-material')?.addEventListener('click', adicionarMaterialFarmacia);
  document.getElementById('farm-lista-materiais-editor')?.addEventListener('click', e => {
    const botao = e.target.closest('[data-excluir-material]');
    if (botao) excluirMaterialFarmacia(botao.dataset.excluirMaterial);
  });
});
