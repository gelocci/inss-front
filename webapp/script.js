//const BACKEND_URL = 'http://172.31.92.192:8080';
//const BACKEND_URL = 'http://localhost:8080';
const BACKEND_URL = 'https://inss-api.gelocci.com.br';

function isCompetenciaPosJul94(competencia) {
    // formato mm/aaaa
    if (!competencia) return false;
    const [mes, ano] = competencia.split('/').map(Number);
    return (ano > 1994) || (ano === 1994 && mes >= 7);
}

function proximaCompetencia(competencia) {
    if (!competencia || !/^\d{2}\/\d{4}$/.test(competencia)) return '';
    let [mes, ano] = competencia.split('/').map(Number);
    mes++;
    if (mes > 12) {
        mes = 1;
        ano++;
    }
    return (mes < 10 ? '0' : '') + mes + '/' + ano;
}

function encontrarUltimoLancamento(array) {
    // Busca o confirmado mais recente pela competência
    let filtrados = array.filter(r => r.confirmado && r.competencia && /^\d{2}\/\d{4}$/.test(r.competencia));
    if (!filtrados.length) return null;
    filtrados.sort((a, b) => {
        const [mb, ab] = b.competencia.split('/').map(Number);
        const [ma, aa] = a.competencia.split('/').map(Number);
        return (ab - aa) || (mb - ma);
    });
    return filtrados[0];
}

function encontrarUltimoLancamentoSimples(array) {
    // Para a tela manual (array de objetos com competencia)
    let filtrados = array.filter(r => r.competencia && /^\d{2}\/\d{4}$/.test(r.competencia));
    if (!filtrados.length) return null;
    filtrados.sort((a, b) => {
        const [mb, ab] = b.competencia.split('/').map(Number);
        const [ma, aa] = a.competencia.split('/').map(Number);
        return (ab - aa) || (mb - ma);
    });
    return filtrados[0];
}

function abrirTelaPdf() {
    document.getElementById('tela-inicial').classList.add('escondido');
    document.getElementById('tela-manual').classList.add('escondido');
    document.getElementById('tela-pdf').classList.remove('escondido');
    document.getElementById('preview').innerHTML = '';
    document.getElementById('file').value = '';
    registrosExtraidos = [];
    extrasManuais = [];
    ocultarTabelaPaginada();
    document.getElementById('box-resultados').innerHTML = '';
    document.getElementById('extras-inputs').innerHTML = '';
}

function abrirTelaManual() {
    document.getElementById('tela-inicial').classList.add('escondido');
    document.getElementById('tela-pdf').classList.add('escondido');
    document.getElementById('tela-manual').classList.remove('escondido');
    document.getElementById('preview-manual').innerHTML = '';
    document.getElementById('tbody-lancamentos').innerHTML = '';
    addLinha();
    ocultarTabelaPaginada();
    document.getElementById('box-resultados').innerHTML = '';
    document.getElementById('extras-inputs').innerHTML = '';
}

let registrosExtraidos = [];
let extrasManuais = [];

// Variáveis globais de paginação
let _paginaAtualPag = 1;
let _registrosPagina = [];
const _linhasPorPagina = 8;

async function enviarArquivo() {
    const fileInput = document.getElementById('file');
    if (!fileInput.files[0]) {
        alert("Selecione um arquivo PDF!");
        return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    try {
        const response = await fetch(BACKEND_URL + '/api/cnis/extrair', { method: 'POST', body: formData });
        if (!response.ok) throw new Error("Erro ao processar o arquivo!");
        const data = await response.json();
        registrosExtraidos = data.map(r => ({
            competencia: r.competencia,
            remuneracao: r.somaRemuneracoes,
            nomeEmpregador: r.nomeEmpregador || ''
        }));
        extrasManuais = [];
        mostrarTabelaPdf(data, []);
    } catch (e) {
        alert(e.message);
    }
}

function mostrarTabelaPdf(registros, extras) {
    // Junta tudo e só mantém válidos!
    const todos = [
        ...registrosExtraidos.filter(r => r.competencia && !isNaN(r.remuneracao) && r.remuneracao > 0),
        ...extrasManuais
            .filter(r => r.confirmado && r.competencia && !isNaN(r.remuneracao) && r.remuneracao > 0)
            .map(r => ({
                competencia: r.competencia,
                remuneracao: parseFloat(r.remuneracao),
                nomeEmpregador: r.nomeEmpregador || ''
            }))
    ];
    if (!todos.length) {
        document.getElementById('preview').innerHTML = '<div class="media-box">Nenhum dado para simular.</div>';
        ocultarTabelaPaginada();
        document.getElementById('box-resultados').innerHTML = '';
        document.getElementById('extras-inputs').innerHTML = '';
        document.getElementById('botao-add-competencia').style.display = "none";
        return;
    }
    fetch(BACKEND_URL + "/api/cnis/simular-mix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(todos)
    })
    .then(r => r.json())
    .then(resp => {
        // ORDENAR por competência crescente
        resp.sort((a, b) => {
            const [ma, aa] = a.competencia.split('/').map(Number);
            const [mb, ab] = b.competencia.split('/').map(Number);
            return (aa - ab) || (ma - mb);
        });

        mostrarTabelaPaginada(resp);

        // --- NOVO: cálculo do benefício ---
        let soma = 0, qtd = 0, tetoFinal = 0;
        let competenciasDistintas = new Set();
        resp.forEach(r => {
            if (isCompetenciaPosJul94(r.competencia) && r.valorCorrigido && r.valorCorrigido > 0 && isFinite(r.valorCorrigido)) {
                soma += r.valorCorrigido;
                qtd++;
            }
            if (r.competencia) competenciasDistintas.add(r.competencia);
            if (r.teto) tetoFinal = r.teto; // Último teto (tabela já está ordenada crescente)
        });

        let media = qtd ? soma / qtd : 0;

        // Quantos meses e anos de contribuição?
        let mesesContrib = competenciasDistintas.size;
        let anosContrib = mesesContrib / 12.0;

        // Homem
        let percHomem = 60 + Math.max(0, Math.floor(anosContrib - 20)) * 2;
        // Mulher
        let percMulher = 60 + Math.max(0, Math.floor(anosContrib - 15)) * 2;

        percHomem = Math.min(percHomem, 100);
        percMulher = Math.min(percMulher, 100);

        // Valor estimado (limitado ao teto final)
        let valHomem = Math.min((percHomem / 100) * media, tetoFinal);
        let valMulher = Math.min((percMulher / 100) * media, tetoFinal);

        // Média dos salários (novo aviso)
        const aviso = `<div class="info-box" style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;margin-bottom:18px;padding:10px 18px;">
            <b>Atenção:</b> Salários de contribuição <b>anteriores a julho/1994</b> não entram na média, mas contam no tempo de contribuição.
        </div>`;

        const mediaBox = `<div class="media-box">
            Média dos salários de contribuição corrigidos (após 07/1994): <b>R$ ${media.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</b>
        </div>`;

        // Nova tabela de benefício
        const tabelaBeneficio = `
        <div class="media-box" style="margin-top:25px;">
            <b>Simulação do valor estimado da aposentadoria:</b>
            <table class="tabela-simulacao" style="margin-top:15px;font-size:1em;max-width:600px;">
                <thead>
                    <tr>
                        <th></th>
                        <th>Homem</th>
                        <th>Mulher</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><b>Meses de contribuição</b></td>
                        <td colspan="2">${mesesContrib} (${anosContrib.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})} anos)</td>
                    </tr>
                    <tr>
                        <td><b>Percentual aplicado</b></td>
                        <td>${percHomem}%</td>
                        <td>${percMulher}%</td>
                    </tr>
                    <tr>
                        <td><b>Valor estimado<br>(limitado ao teto)</b></td>
                        <td><b style="color:#1976d2;">R$ ${valHomem.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                        <td><b style="color:#1976d2;">R$ ${valMulher.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                    </tr>
                    <tr>
                        <td>Teto Previdenciário do último mês</td>
                        <td colspan="2"><b>R$ ${tetoFinal.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                    </tr>
                </tbody>
            </table>
        </div>
        `;

        document.getElementById('box-resultados').innerHTML = aviso + mediaBox + tabelaBeneficio;
        document.getElementById('botao-add-competencia').style.display = "inline-block";
        document.getElementById('extras-inputs').innerHTML = renderExtrasInputs();
    });
}

// --- BLOCO DA TABELA PAGINADA ---
function mostrarTabelaPaginada(registros) {
    _registrosPagina = registros;
    _paginaAtualPag = 1;
    renderPaginaPaginada();
    document.getElementById("container-tabela-paginada").classList.remove("escondido");
}

function renderPaginaPaginada() {
    const totalPaginas = Math.max(1, Math.ceil(_registrosPagina.length / _linhasPorPagina));
    if (_paginaAtualPag > totalPaginas) _paginaAtualPag = totalPaginas;
    if (_paginaAtualPag < 1) _paginaAtualPag = 1;
    const inicio = (_paginaAtualPag - 1) * _linhasPorPagina;
    const fim = inicio + _linhasPorPagina;
    const linhas = _registrosPagina.slice(inicio, fim);

    let tbody = document.getElementById('tbodyPag');
    tbody.innerHTML = '';
    linhas.forEach(r => {
        const foraMedia = !isCompetenciaPosJul94(r.competencia);
        tbody.innerHTML += `<tr${foraMedia ? ' style="background:#f5f5f5;color:#bbb;"' : ''}>
            <td>${r.competencia}${foraMedia ? ' <span title="Não entra na média" style="color:#fbbc05;">*</span>' : ''}</td>
            <td>R$ ${isFinite(r.somaRemuneracoes) ? r.somaRemuneracoes.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.teto) ? r.teto.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.valorAntesCorrecao) ? r.valorAntesCorrecao.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td><b>R$ ${isFinite(r.valorCorrigido) ? r.valorCorrigido.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</b></td>
            <td>${r.nomeEmpregador ? r.nomeEmpregador : ''}</td>
        </tr>`;
    });
    // Preenche linhas restantes para manter layout
    for (let i = linhas.length; i < _linhasPorPagina; i++) {
        tbody.innerHTML += `<tr>
            <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td>
        </tr>`;
    }
    // Navegação
    let nav = '';
    nav += `<button onclick="_paginaAtualPag=1; renderPaginaPaginada()" ${_paginaAtualPag==1?'disabled':''}>&lt;&lt;</button>`;
    nav += `<button onclick="_paginaAtualPag--; renderPaginaPaginada()" ${_paginaAtualPag==1?'disabled':''}>&lt;</button>`;
    nav += ` Página ${_paginaAtualPag} de ${totalPaginas} `;
    nav += `<button onclick="_paginaAtualPag++; renderPaginaPaginada()" ${_paginaAtualPag==totalPaginas?'disabled':''}>&gt;</button>`;
    nav += `<button onclick="_paginaAtualPag=${totalPaginas}; renderPaginaPaginada()" ${_paginaAtualPag==totalPaginas?'disabled':''}>&gt;&gt;</button>`;
    document.getElementById('paginacao').innerHTML = nav;
}

function ocultarTabelaPaginada() {
    document.getElementById("container-tabela-paginada").classList.add("escondido");
    document.getElementById('botao-add-competencia').style.display = "none";
    document.getElementById('extras-inputs').innerHTML = '';
}

// --- EXTRAS (MELHORADO) ---
function adicionarLinhaExtra() {
    let competencia = '', remuneracao = '', nomeEmpregador = '';
    // Busca último lançamento confirmado (manual ou extra)
    let ultimo = encontrarUltimoLancamento(extrasManuais);

    // Se não achou, pega o mais recente do PDF extraído
    if (!ultimo) {
        let validos = registrosExtraidos.filter(r => r.competencia && /^\d{2}\/\d{4}$/.test(r.competencia));
        if (validos.length) {
            validos.sort((a, b) => {
                const [mb, ab] = b.competencia.split('/').map(Number);
                const [ma, aa] = a.competencia.split('/').map(Number);
                return (ab - aa) || (mb - ma);
            });
            ultimo = validos[0];
        }
    }
    if (ultimo && ultimo.competencia) {
        competencia = proximaCompetencia(ultimo.competencia);
        remuneracao = ultimo.remuneracao;
        nomeEmpregador = ultimo.nomeEmpregador || '';
    }
    extrasManuais.push({ competencia, remuneracao, nomeEmpregador, confirmado: false });
    mostrarTabelaPdf(registrosExtraidos, extrasManuais);
}

function renderExtrasInputs() {
    if (!extrasManuais.length) return '';
    let linhas = `<table style="margin:12px auto 0 auto;width:100%;max-width:1100px;"><tbody>`;
    extrasManuais.forEach((ex, idx) => {
        if (!ex.confirmado) {
            linhas += `<tr>
                <td><input type="text" placeholder="mm/aaaa" maxlength="7" value="${ex.competencia || ''}" id="comp${idx}" /></td>
                <td><input type="number" step="0.01" min="0" placeholder="Remuneração" value="${ex.remuneracao || ''}" id="val${idx}" /></td>
                <td><input type="text" placeholder="Empregador (opcional)" value="${ex.nomeEmpregador || ''}" id="emp${idx}" /></td>
                <td>
                    <button class="confirm-btn" onclick="confirmarExtra(${idx})" title="Confirmar este lançamento">✔</button>
                    <button class="remove-btn" onclick="removerExtra(${idx})">🗑️</button>
                </td>
            </tr>`;
        } else {
            linhas += `<tr>
                <td><input type="text" value="${ex.competencia}" readonly style="background:#f2f8ff;"/></td>
                <td><input type="number" value="${ex.remuneracao}" readonly style="background:#f2f8ff;"/></td>
                <td><input type="text" value="${ex.nomeEmpregador || ''}" readonly style="background:#f2f8ff;"/></td>
                <td>
                    <button class="edit-btn" onclick="voltarParaEdicao(${idx})" title="Editar lançamento">✏️</button>
                    <button class="remove-btn" onclick="removerExtra(${idx})" title="Excluir lançamento">❌</button>
                </td>
            </tr>`;
        }
    });
    linhas += '</tbody></table>';
    return linhas;
}

function confirmarExtra(idx) {
    const tr = document.querySelectorAll('#extras-inputs table tbody tr')[idx];
    if (!tr) return;
    const inputs = tr.querySelectorAll('input');
    extrasManuais[idx].competencia = inputs[0].value;
    extrasManuais[idx].remuneracao = inputs[1].value;
    extrasManuais[idx].nomeEmpregador = inputs[2].value;
    extrasManuais[idx].confirmado = true;
    mostrarTabelaPdf(registrosExtraidos, extrasManuais);
}

function voltarParaEdicao(idx) {
    extrasManuais[idx].confirmado = false;
    mostrarTabelaPdf(registrosExtraidos, extrasManuais);
}
function removerExtra(idx) {
    extrasManuais.splice(idx, 1);
    mostrarTabelaPdf(registrosExtraidos, extrasManuais);
}

// --- TELA MANUAL PADRÃO (MELHORADO) ---
function addLinha(obj) {
    const tbody = document.getElementById("tbody-lancamentos");
    let competencia = '', remuneracao = '', nomeEmpregador = '';
    // Sugere próxima competência e valor com base no mais recente
    let linhas = Array.from(tbody.querySelectorAll('tr')).map(tr => {
        let inputs = tr.querySelectorAll('input');
        return {
            competencia: inputs[0]?.value || '',
            remuneracao: inputs[1]?.value || '',
            nomeEmpregador: inputs[2]?.value || ''
        };
    });
    let ultimo = encontrarUltimoLancamentoSimples(linhas);

    if (!obj && ultimo && ultimo.competencia) {
        competencia = proximaCompetencia(ultimo.competencia);
        remuneracao = ultimo.remuneracao;
        nomeEmpregador = ultimo.nomeEmpregador || '';
    } else if (obj) {
        competencia = obj?.competencia || '';
        remuneracao = obj?.remuneracao || '';
        nomeEmpregador = obj?.nomeEmpregador || '';
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" placeholder="mm/aaaa" maxlength="7" value="${competencia}" /></td>
        <td><input type="number" step="0.01" min="0" placeholder="Remuneração" value="${remuneracao}" /></td>
        <td><input type="text" placeholder="Empregador (opcional)" value="${nomeEmpregador}" /></td>
        <td><button class="remove-btn" onclick="this.parentElement.parentElement.remove()">🗑️</button></td>
    `;
    tbody.appendChild(tr);
}

function enviarManual() {
    const linhas = document.querySelectorAll("#tbody-lancamentos tr");
    const registros = [];
    for (let linha of linhas) {
        const inputs = linha.querySelectorAll("input");
        const competencia = inputs[0].value.trim();
        const remuneracao = parseFloat(inputs[1].value.replace(",", "."));
        const nomeEmpregador = inputs[2].value.trim();
        if (!competencia || isNaN(remuneracao) || remuneracao <= 0) continue;
        registros.push({
            competencia,
            remuneracao,
            nomeEmpregador
        });
    }
    if (registros.length === 0) {
        document.getElementById("preview-manual").innerHTML = '<div class="media-box">Nenhum registro válido informado.</div>';
        return;
    }
    fetch(BACKEND_URL + "/api/cnis/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registros)
    })
    .then(r => r.json())
    .then(resp => {
        mostrarTabelaComMedia(resp);
    })
    .catch(err => {
        document.getElementById("preview-manual").innerHTML = "Erro ao simular. Tente novamente.";
    });
}

function mostrarTabelaComMedia(registros) {
    registros.sort((a, b) => {
        const [ma, aa] = a.competencia.split('/').map(Number);
        const [mb, ab] = b.competencia.split('/').map(Number);
        return (aa - ab) || (ma - mb);
    });
    let soma = 0, qtd = 0, tetoFinal = 0;
    let competenciasDistintas = new Set();
    registros.forEach(r => {
        if (isCompetenciaPosJul94(r.competencia) && r.valorCorrigido && r.valorCorrigido > 0 && isFinite(r.valorCorrigido)) {
            soma += r.valorCorrigido;
            qtd++;
        }
        if (r.competencia) competenciasDistintas.add(r.competencia);
        if (r.teto) tetoFinal = r.teto;
    });
    let media = qtd ? soma / qtd : 0;
    // NOVO: cálculo benefício manual
    let mesesContrib = competenciasDistintas.size;
    let anosContrib = mesesContrib / 12.0;
    let percHomem = 60 + Math.max(0, Math.floor(anosContrib - 20)) * 2;
    let percMulher = 60 + Math.max(0, Math.floor(anosContrib - 15)) * 2;
    percHomem = Math.min(percHomem, 100);
    percMulher = Math.min(percMulher, 100);
    let valHomem = Math.min((percHomem / 100) * media, tetoFinal);
    let valMulher = Math.min((percMulher / 100) * media, tetoFinal);

    let aviso = `<div class="info-box" style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;margin-bottom:18px;padding:10px 18px;">
        <b>Atenção:</b> Salários de contribuição <b>anteriores a julho/1994</b> não entram na média, mas contam no tempo de contribuição.
    </div>`;

    let tabela = `<table class="tabela-simulacao">
      <thead>
      <tr>
        <th>Competência</th>
        <th>Soma das Remunerações</th>
        <th>Teto Vigente</th>
        <th>Valor Utilizado (pré-correção)</th>
        <th>Valor Corrigido</th>
        <th>Empregador(es)</th>
      </tr>
      </thead>
      <tbody>`;
    registros.forEach(r => {
        const foraMedia = !isCompetenciaPosJul94(r.competencia);
        tabela += `<tr${foraMedia ? ' style="background:#f5f5f5;color:#bbb;"' : ''}>
            <td>${r.competencia}${foraMedia ? ' <span title="Não entra na média" style="color:#fbbc05;">*</span>' : ''}</td>
            <td>R$ ${isFinite(r.somaRemuneracoes) ? r.somaRemuneracoes.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.teto) ? r.teto.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.valorAntesCorrecao) ? r.valorAntesCorrecao.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td><b>R$ ${isFinite(r.valorCorrigido) ? r.valorCorrigido.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</b></td>
            <td>${r.nomeEmpregador ? r.nomeEmpregador : ''}</td>
        </tr>`;
    });
    tabela += "</tbody></table>";

    const mediaBox = `<div class="media-box">
        Média dos salários de contribuição corrigidos (após 07/1994): <b>R$ ${media.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</b>
    </div>`;
    const tabelaBeneficio = `
    <div class="media-box" style="margin-top:25px;">
        <b>Simulação do valor estimado da aposentadoria:</b>
        <table class="tabela-simulacao" style="margin-top:15px;font-size:1em;max-width:600px;">
            <thead>
                <tr>
                    <th></th>
                    <th>Homem</th>
                    <th>Mulher</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><b>Meses de contribuição</b></td>
                    <td colspan="2">${mesesContrib} (${anosContrib.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})} anos)</td>
                </tr>
                <tr>
                    <td><b>Percentual aplicado</b></td>
                    <td>${percHomem}%</td>
                    <td>${percMulher}%</td>
                </tr>
                <tr>
                    <td><b>Valor estimado<br>(limitado ao teto)</b></td>
                    <td><b style="color:#1976d2;">R$ ${valHomem.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                    <td><b style="color:#1976d2;">R$ ${valMulher.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                </tr>
                <tr>
                    <td>Teto Previdenciário do último mês</td>
                    <td colspan="2"><b>R$ ${tetoFinal.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b></td>
                </tr>
            </tbody>
        </table>
    </div>
    `;
    document.getElementById('preview-manual').innerHTML = aviso + tabela + mediaBox + tabelaBeneficio;
}

window.onload = () => {
    document.getElementById('tela-inicial').classList.remove('escondido');
    document.getElementById('tela-pdf').classList.add('escondido');
    document.getElementById('tela-manual').classList.add('escondido');
    ocultarTabelaPaginada();
    document.getElementById('box-resultados').innerHTML = '';
    document.getElementById('extras-inputs').innerHTML = '';
};
