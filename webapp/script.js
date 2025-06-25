const BACKEND_URL = 'http://172.31.92.192:8080';

function abrirTelaPdf() {
    document.getElementById('tela-inicial').classList.add('escondido');
    document.getElementById('tela-manual').classList.add('escondido');
    document.getElementById('tela-pdf').classList.remove('escondido');
    document.getElementById('preview').innerHTML = '';
    document.getElementById('file').value = '';
    registrosExtraidos = [];
    extrasManuais = [];
}

function abrirTelaManual() {
    document.getElementById('tela-inicial').classList.add('escondido');
    document.getElementById('tela-pdf').classList.add('escondido');
    document.getElementById('tela-manual').classList.remove('escondido');
    document.getElementById('preview-manual').innerHTML = '';
    document.getElementById('tbody-lancamentos').innerHTML = '';
    addLinha();
}

let registrosExtraidos = [];
let extrasManuais = [];

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
        document.getElementById('preview').innerHTML = '<div class="media-box">Nenhum dado para simular.</div>' + renderExtrasInputs();
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
        let soma = 0, qtd = 0;
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
        resp.forEach(r => {
            tabela += `<tr>
                <td>${r.competencia}</td>
                <td>R$ ${isFinite(r.somaRemuneracoes) ? r.somaRemuneracoes.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
                <td>R$ ${isFinite(r.teto) ? r.teto.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
                <td>R$ ${isFinite(r.valorAntesCorrecao) ? r.valorAntesCorrecao.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
                <td><b>R$ ${isFinite(r.valorCorrigido) ? r.valorCorrigido.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</b></td>
                <td>${r.nomeEmpregador ? r.nomeEmpregador : ''}</td>
            </tr>`;
            if (r.valorCorrigido && r.valorCorrigido > 0 && isFinite(r.valorCorrigido)) {
                soma += r.valorCorrigido;
                qtd++;
            }
        });
        tabela += "</tbody></table>";
        let media = qtd ? soma / qtd : 0;
        const mediaBox = `<div class="media-box">
            <b>Média dos salários de contribuição corrigidos e limitados ao teto:</b><br>
            <span style="font-size:2em;color:#1976d2;">R$ ${media.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>`;
        const botaoMais = `<div style="margin-top:10px;">
            <button class="add-btn" onclick="adicionarLinhaExtra()" title="Adicionar competência extra">➕ Adicionar Competência</button>
        </div>`;
        document.getElementById('preview').innerHTML = tabela + mediaBox + botaoMais + renderExtrasInputs();
    });
}

function adicionarLinhaExtra() {
    extrasManuais.push({ competencia: '', remuneracao: '', nomeEmpregador: '', confirmado: false });
    mostrarTabelaPdf(registrosExtraidos, extrasManuais);
}

function renderExtrasInputs() {
    if (!extrasManuais.length) return '';
    let linhas = `<table style="margin-top:15px;width:100%;max-width:1100px;"><tbody>`;
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
    const tr = document.querySelectorAll('#preview table')[1]?.querySelectorAll('tbody tr')[idx];
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

// --- TELA MANUAL PADRÃO ---
function addLinha(obj) {
    const tbody = document.getElementById("tbody-lancamentos");
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" placeholder="mm/aaaa" maxlength="7" value="${obj?.competencia || ''}" /></td>
        <td><input type="number" step="0.01" min="0" placeholder="Remuneração" value="${obj?.remuneracao || ''}" /></td>
        <td><input type="text" placeholder="Empregador (opcional)" value="${obj?.nomeEmpregador || ''}" /></td>
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
    let soma = 0, qtd = 0;
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
        tabela += `<tr>
            <td>${r.competencia}</td>
            <td>R$ ${isFinite(r.somaRemuneracoes) ? r.somaRemuneracoes.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.teto) ? r.teto.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td>R$ ${isFinite(r.valorAntesCorrecao) ? r.valorAntesCorrecao.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</td>
            <td><b>R$ ${isFinite(r.valorCorrigido) ? r.valorCorrigido.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : ''}</b></td>
            <td>${r.nomeEmpregador ? r.nomeEmpregador : ''}</td>
        </tr>`;
        if (r.valorCorrigido && r.valorCorrigido > 0 && isFinite(r.valorCorrigido)) {
            soma += r.valorCorrigido;
            qtd++;
        }
    });
    tabela += "</tbody></table>";
    let media = qtd ? soma / qtd : 0;
    const mediaBox = `<div class="media-box">
        <b>Média dos salários de contribuição corrigidos e limitados ao teto:</b><br>
        <span style="font-size:2em;color:#1976d2;">R$ ${media.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
    </div>`;
    document.getElementById('preview-manual').innerHTML = tabela + mediaBox;
}

window.onload = () => {
    document.getElementById('tela-inicial').classList.remove('escondido');
    document.getElementById('tela-pdf').classList.add('escondido');
    document.getElementById('tela-manual').classList.add('escondido');
};
