import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, runTransaction, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ⚠️ Substitua pelos dados do SEU projeto Firebase (os mesmos usados em login.html)
const firebaseConfig = {
  apiKey: "AIzaSyDlrs2kyTlwrXjIOivSth9U5PSOQCPvXvY",
  authDomain: "esd-gestao.firebaseapp.com",
  projectId: "esd-gestao",
  storageBucket: "esd-gestao.firebasestorage.app",
  messagingSenderId: "1047951862397",
  appId: "1:1047951862397:web:622d146434b65eac161f14"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============ CONSTANTES ============
const CATEGORIAS = ["Papelaria", "Limpeza", "Equipamento", "Alimentício", "Manutenção", "Outros"];
const UNIDADES = ["un", "cx", "pct", "L", "ml", "kg", "g", "par", "rolo"];

let SETOR_ID = null;
let itensCache = [];
let movsCache = [];
let itensUnsub = null;
let movsUnsub = null;

// ============ AUTENTICAÇÃO ============
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  const userDoc = await getDoc(doc(db, "usuarios", user.uid));
  if (!userDoc.exists() || !userDoc.data().setor) {
    alert("Sua conta não está associada a nenhum setor. Fale com o administrador do sistema.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }
  SETOR_ID = userDoc.data().setor;
  document.getElementById("setorNome").textContent = formatarSetor(SETOR_ID);
  iniciarListeners();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});

function formatarSetor(id) {
  const nomes = { "coordenacao": "Coordenação", "cantina": "Cantina", "auxiliares-gerais": "Auxiliares Gerais" };
  return nomes[id] || id;
}

// ============ REFERÊNCIAS DO FIRESTORE (por setor) ============
function itensRef() { return collection(db, "setores", SETOR_ID, "itens"); }
function movsRef() { return collection(db, "setores", SETOR_ID, "movimentacoes"); }

function iniciarListeners() {
  itensUnsub = onSnapshot(query(itensRef(), orderBy("nome")), (snap) => {
    itensCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    popularCategorias();
    renderItens();
    renderDashboard();
    renderCompras();
  });

  movsUnsub = onSnapshot(query(movsRef(), orderBy("data", "desc")), (snap) => {
    movsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMovimentacoes();
    renderDashboard();
    renderRelatorio();
  });
}

// ============ STATUS DE ESTOQUE ============
function statusItem(item) {
  if (item.quantidadeAtual <= item.quantidadeMinima) return "critico";
  if (item.quantidadeAtual <= item.quantidadeAtencao) return "atencao";
  return "ok";
}
function badgeStatus(status) {
  if (status === "critico") return '<span class="badge badge-crit">Abaixo do mínimo</span>';
  if (status === "atencao") return '<span class="badge badge-warn">Em atenção</span>';
  return '<span class="badge badge-ok">Normal</span>';
}

// ============ TOAST ============
function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 3200);
}

// ============ NAVEGAÇÃO ENTRE VIEWS ============
document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

// ============ MODAIS: abrir/fechar ============
function abrirModal(id) { document.getElementById(id).classList.add("active"); }
function fecharModal(id) { document.getElementById(id).classList.remove("active"); }
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.target.closest(".modal-overlay").classList.remove("active");
  });
});
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("active"); });
});

function popularCategorias() {
  const filtro = document.getElementById("filtroCategoria");
  const atual = filtro.value;
  filtro.innerHTML = '<option value="">Todas as categorias</option>' +
    CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join("");
  filtro.value = atual;
}
(function popularSelects() {
  document.getElementById("itemCategoria").innerHTML = CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join("");
  document.getElementById("itemUnidade").innerHTML = UNIDADES.map(u => `<option value="${u}">${u}</option>`).join("");
})();

// ============================================================
// ITENS — CRUD
// ============================================================
const formItem = document.getElementById("formItem");

document.getElementById("btnNovoItem").addEventListener("click", () => {
  formItem.reset();
  document.getElementById("itemId").value = "";
  document.getElementById("modalItemTitulo").textContent = "Novo item";
  abrirModal("modalItem");
});

function editarItem(id) {
  const item = itensCache.find(i => i.id === id);
  if (!item) return;
  document.getElementById("itemId").value = item.id;
  document.getElementById("itemNome").value = item.nome;
  document.getElementById("itemCategoria").value = item.categoria;
  document.getElementById("itemUnidade").value = item.unidade;
  document.getElementById("itemQtdAtual").value = item.quantidadeAtual;
  document.getElementById("itemQtdMinima").value = item.quantidadeMinima;
  document.getElementById("itemQtdAtencao").value = item.quantidadeAtencao;
  document.getElementById("modalItemTitulo").textContent = "Editar item";
  abrirModal("modalItem");
}

formItem.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("itemId").value;
  const dados = {
    nome: document.getElementById("itemNome").value.trim(),
    categoria: document.getElementById("itemCategoria").value,
    unidade: document.getElementById("itemUnidade").value,
    quantidadeAtual: parseFloat(document.getElementById("itemQtdAtual").value),
    quantidadeMinima: parseFloat(document.getElementById("itemQtdMinima").value),
    quantidadeAtencao: parseFloat(document.getElementById("itemQtdAtencao").value),
    atualizadoEm: Timestamp.now()
  };
  try {
    if (id) {
      await updateDoc(doc(db, "setores", SETOR_ID, "itens", id), dados);
      toast("Item atualizado com sucesso.");
    } else {
      dados.criadoEm = Timestamp.now();
      await addDoc(itensRef(), dados);
      toast("Item cadastrado com sucesso.");
    }
    fecharModal("modalItem");
  } catch (err) {
    console.error(err);
    toast("Erro ao salvar item.", true);
  }
});

// ---- Modal de confirmação estilizado (substitui o confirm() nativo do navegador) ----
let acaoConfirmada = null;
function abrirConfirmacao(titulo, mensagem, aoConfirmar) {
  document.getElementById("confirmarTitulo").textContent = titulo;
  document.getElementById("confirmarMensagem").textContent = mensagem;
  acaoConfirmada = aoConfirmar;
  abrirModal("modalConfirmar");
}
document.getElementById("btnConfirmarAcao").addEventListener("click", async () => {
  const btn = document.getElementById("btnConfirmarAcao");
  const acao = acaoConfirmada;
  if (!acao) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Excluindo...';
  try {
    await acao();
    fecharModal("modalConfirmar");
  } catch (err) {
    console.error(err);
    toast("Erro ao excluir item.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sim, excluir";
    acaoConfirmada = null;
  }
});

async function excluirItem(id) {
  const item = itensCache.find(i => i.id === id);
  if (!item) return;
  abrirConfirmacao(
    "Excluir item?",
    `Tem certeza que deseja excluir "${item.nome}" do estoque? Essa ação não pode ser desfeita.`,
    async () => {
      await deleteDoc(doc(db, "setores", SETOR_ID, "itens", id));
      toast("Item excluído.");
    }
  );
}

// ---- Entrada ----
let itemAlvoId = null;
function abrirEntrada(id) {
  itemAlvoId = id;
  const item = itensCache.find(i => i.id === id);
  document.getElementById("entradaItemNome").textContent = item ? `${item.nome} · atual: ${item.quantidadeAtual} ${item.unidade}` : "";
  document.getElementById("formEntrada").reset();
  abrirModal("modalEntrada");
}
document.getElementById("formEntrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const qtd = parseFloat(document.getElementById("entradaQtd").value);
  const obs = document.getElementById("entradaObs").value.trim();
  try {
    await registrarMovimentacao(itemAlvoId, "entrada", qtd, obs);
    fecharModal("modalEntrada");
    toast("Entrada registrada.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Erro ao registrar entrada.", true);
  }
});

// ---- Retirada ----
function abrirRetirada(id) {
  itemAlvoId = id;
  const item = itensCache.find(i => i.id === id);
  document.getElementById("retiradaItemNome").textContent = item ? `${item.nome} · atual: ${item.quantidadeAtual} ${item.unidade}` : "";
  document.getElementById("formRetirada").reset();
  abrirModal("modalRetirada");
}
document.getElementById("formRetirada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const qtd = parseFloat(document.getElementById("retiradaQtd").value);
  const obs = document.getElementById("retiradaObs").value.trim();
  try {
    await registrarMovimentacao(itemAlvoId, "saida", qtd, obs);
    fecharModal("modalRetirada");
    toast("Retirada registrada.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Erro ao registrar retirada.", true);
  }
});

// Transação: atualiza a quantidade do item e grava o histórico de forma atômica
async function registrarMovimentacao(itemId, tipo, quantidade, observacao) {
  const itemDocRef = doc(db, "setores", SETOR_ID, "itens", itemId);
  await runTransaction(db, async (transaction) => {
    const itemSnap = await transaction.get(itemDocRef);
    if (!itemSnap.exists()) throw new Error("Item não encontrado.");
    const dadosItem = itemSnap.data();
    let novaQtd = dadosItem.quantidadeAtual;
    if (tipo === "entrada") {
      novaQtd += quantidade;
    } else {
      if (quantidade > dadosItem.quantidadeAtual) {
        throw new Error(`Não há ${quantidade} ${dadosItem.unidade} disponível (atual: ${dadosItem.quantidadeAtual}).`);
      }
      novaQtd -= quantidade;
    }
    transaction.update(itemDocRef, { quantidadeAtual: novaQtd, atualizadoEm: Timestamp.now() });
    const movDocRef = doc(movsRef());
    transaction.set(movDocRef, {
      itemId, itemNome: dadosItem.nome, tipo, quantidade,
      observacao: observacao || "", data: Timestamp.now()
    });
  });
}

// Torna funções acessíveis pelos botões inline da tabela
window.editarItem = editarItem;
window.excluirItem = excluirItem;
window.abrirEntrada = abrirEntrada;
window.abrirRetirada = abrirRetirada;

// ---- Render tabela de itens ----
function renderItens() {
  const busca = document.getElementById("buscaItem").value.toLowerCase();
  const catFiltro = document.getElementById("filtroCategoria").value;
  const statusFiltro = document.getElementById("filtroStatus").value;

  const filtrados = itensCache.filter(item => {
    if (busca && !item.nome.toLowerCase().includes(busca)) return false;
    if (catFiltro && item.categoria !== catFiltro) return false;
    if (statusFiltro && statusItem(item) !== statusFiltro) return false;
    return true;
  });

  const tbody = document.getElementById("itensTableBody");
  document.getElementById("itensEmpty").style.display = filtrados.length ? "none" : "block";

  tbody.innerHTML = filtrados.map(item => {
    const status = statusItem(item);
    return `<tr>
      <td><strong>${item.nome}</strong></td>
      <td><span class="badge badge-cat">${item.categoria}</span></td>
      <td>${item.unidade}</td>
      <td>${item.quantidadeAtual}</td>
      <td>${item.quantidadeMinima} / ${item.quantidadeAtencao}</td>
      <td>${badgeStatus(status)}</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="abrirEntrada('${item.id}')">+ Entrada</button>
        <button class="btn btn-outline btn-sm" onclick="abrirRetirada('${item.id}')">− Retirada</button>
        <button class="btn btn-outline btn-sm" onclick="editarItem('${item.id}')">Editar</button>
        <button class="btn btn-danger-outline btn-sm" onclick="excluirItem('${item.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join("");
}
["buscaItem"].forEach(id => document.getElementById(id).addEventListener("input", renderItens));
["filtroCategoria", "filtroStatus"].forEach(id => document.getElementById(id).addEventListener("change", renderItens));

// ============================================================
// MOVIMENTAÇÕES
// ============================================================
function dentroDoPeriodo(dataMov, periodo) {
  if (periodo === "tudo") return true;
  const agora = new Date();
  const dataMovJs = dataMov.toDate ? dataMov.toDate() : new Date(dataMov);
  const diffDias = (agora - dataMovJs) / (1000 * 60 * 60 * 24);
  if (periodo === "semana") return diffDias <= 7;
  if (periodo === "mes") return diffDias <= 30;
  return true;
}

function renderMovimentacoes() {
  const tipoFiltro = document.getElementById("filtroMovTipo").value;
  const periodoFiltro = document.getElementById("filtroMovPeriodo").value;

  const filtradas = movsCache.filter(mov => {
    if (tipoFiltro && mov.tipo !== tipoFiltro) return false;
    if (!dentroDoPeriodo(mov.data, periodoFiltro)) return false;
    return true;
  });

  const tbody = document.getElementById("movTableBody");
  document.getElementById("movEmpty").style.display = filtradas.length ? "none" : "block";

  tbody.innerHTML = filtradas.map(mov => {
    const data = mov.data.toDate ? mov.data.toDate() : new Date(mov.data);
    const tipoBadge = mov.tipo === "entrada"
      ? '<span class="badge badge-in">Entrada</span>'
      : '<span class="badge badge-out">Saída</span>';
    return `<tr>
      <td>${data.toLocaleDateString("pt-BR")} ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${mov.itemNome}</td>
      <td>${tipoBadge}</td>
      <td>${mov.quantidade}</td>
      <td>${mov.observacao || "—"}</td>
    </tr>`;
  }).join("");
}
["filtroMovTipo", "filtroMovPeriodo"].forEach(id => document.getElementById(id).addEventListener("change", renderMovimentacoes));

// ============================================================
// DASHBOARD
// ============================================================
let chartTopSaidas = null;
let dashboardPeriodo = "semana";

document.querySelectorAll("#dashboardPeriodo button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#dashboardPeriodo button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    dashboardPeriodo = btn.dataset.p;
    renderDashboard();
  });
});

function renderDashboard() {
  const total = itensCache.length;
  const emAtencao = itensCache.filter(i => statusItem(i) === "atencao").length;
  const critico = itensCache.filter(i => statusItem(i) === "critico").length;
  const movMes = movsCache.filter(m => dentroDoPeriodo(m.data, "mes")).length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statAtencao").textContent = emAtencao;
  document.getElementById("statCritico").textContent = critico;
  document.getElementById("statMov").textContent = movMes;

  const badgeCompras = document.getElementById("badgeCompras");
  const totalAlerta = emAtencao + critico;
  badgeCompras.style.display = totalAlerta > 0 ? "inline-block" : "none";
  badgeCompras.textContent = totalAlerta;

  // Top itens que mais saíram no período
  const saidas = movsCache.filter(m => m.tipo === "saida" && dentroDoPeriodo(m.data, dashboardPeriodo));
  const somaPorItem = {};
  saidas.forEach(m => { somaPorItem[m.itemNome] = (somaPorItem[m.itemNome] || 0) + m.quantidade; });
  const topItens = Object.entries(somaPorItem).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const canvas = document.getElementById("chartTopSaidas");
  document.getElementById("chartEmpty").style.display = topItens.length ? "none" : "block";
  canvas.style.display = topItens.length ? "block" : "none";

  if (chartTopSaidas) chartTopSaidas.destroy();
  if (topItens.length) {
    chartTopSaidas = new Chart(canvas, {
      type: "bar",
      data: {
        labels: topItens.map(t => t[0]),
        datasets: [{
          data: topItens.map(t => t[1]),
          backgroundColor: "#6086c3",
          borderRadius: 6,
          barThickness: 26
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "#eef0f5" } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // Tabela de itens em alerta
  const alertados = itensCache.filter(i => statusItem(i) !== "ok");
  const tbody = document.getElementById("dashboardAlertBody");
  document.getElementById("dashboardAlertEmpty").style.display = alertados.length ? "none" : "block";
  tbody.innerHTML = alertados.map(item => `<tr>
    <td><strong>${item.nome}</strong></td>
    <td><span class="badge badge-cat">${item.categoria}</span></td>
    <td>${item.quantidadeAtual} ${item.unidade}</td>
    <td>${item.quantidadeMinima} ${item.unidade}</td>
    <td>${badgeStatus(statusItem(item))}</td>
  </tr>`).join("");
}

// ============================================================
// IMPORTAR PLANILHA
// ============================================================
let itensImportados = [];

document.getElementById("importDrop").addEventListener("click", () => document.getElementById("importFile").click());

document.getElementById("btnBaixarModelo").addEventListener("click", () => {
  const modelo = [
    { "Nome": "Papel A4 (resma)", "Categoria": "Papelaria", "Unidade": "cx", "Quantidade Atual": 10, "Quantidade Mínima": 3, "Quantidade Atenção": 5 },
    { "Nome": "Álcool em gel", "Categoria": "Limpeza", "Unidade": "L", "Quantidade Atual": 8, "Quantidade Mínima": 2, "Quantidade Atenção": 4 }
  ];
  const ws = XLSX.utils.json_to_sheet(modelo);
  ws["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 15 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Modelo");
  XLSX.writeFile(wb, "modelo-importacao-estoque.xlsx");
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const wb = XLSX.read(evt.target.result, { type: "binary" });
    const primeiraAba = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(primeiraAba, { defval: "" });

    itensImportados = linhas.map(l => {
      const nome = String(l["Nome"] || l["nome"] || "").trim();
      let categoria = String(l["Categoria"] || l["categoria"] || "").trim();
      if (!CATEGORIAS.includes(categoria)) categoria = "Outros";
      let unidade = String(l["Unidade"] || l["unidade"] || "un").trim();
      if (!UNIDADES.includes(unidade)) unidade = "un";
      return {
        nome,
        categoria,
        unidade,
        quantidadeAtual: parseFloat(l["Quantidade Atual"] || l["quantidadeAtual"] || 0) || 0,
        quantidadeMinima: parseFloat(l["Quantidade Mínima"] || l["quantidadeMinima"] || 0) || 0,
        quantidadeAtencao: parseFloat(l["Quantidade Atenção"] || l["quantidadeAtencao"] || 0) || 0
      };
    }).filter(i => i.nome);

    renderPreviewImportacao();
  };
  reader.readAsBinaryString(file);
});

function renderPreviewImportacao() {
  const painel = document.getElementById("importPreviewPanel");
  painel.style.display = itensImportados.length ? "block" : "none";
  const tbody = document.getElementById("importPreviewBody");
  tbody.innerHTML = itensImportados.map((item, idx) => `<tr>
    <td>${item.nome}</td>
    <td>
      <select onchange="atualizarCategoriaImportada(${idx}, this.value)">
        ${CATEGORIAS.map(c => `<option value="${c}" ${c === item.categoria ? "selected" : ""}>${c}</option>`).join("")}
      </select>
    </td>
    <td>${item.unidade}</td>
    <td>${item.quantidadeAtual}</td>
    <td>${item.quantidadeMinima}</td>
    <td>${item.quantidadeAtencao}</td>
    <td><button class="btn btn-danger-outline btn-sm" onclick="removerItemImportado(${idx})">Remover</button></td>
  </tr>`).join("");
}
window.atualizarCategoriaImportada = (idx, valor) => { itensImportados[idx].categoria = valor; };
window.removerItemImportado = (idx) => { itensImportados.splice(idx, 1); renderPreviewImportacao(); };

document.getElementById("btnConfirmarImportacao").addEventListener("click", async () => {
  if (!itensImportados.length) return;
  const btn = document.getElementById("btnConfirmarImportacao");
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Importando...';
  try {
    const batch = writeBatch(db);
    itensImportados.forEach(item => {
      const novoDocRef = doc(itensRef());
      batch.set(novoDocRef, { ...item, criadoEm: Timestamp.now(), atualizadoEm: Timestamp.now() });
      if (item.quantidadeAtual > 0) {
        const movDocRef = doc(movsRef());
        batch.set(movDocRef, {
          itemId: novoDocRef.id, itemNome: item.nome, tipo: "entrada",
          quantidade: item.quantidadeAtual, observacao: "Importação inicial via planilha", data: Timestamp.now()
        });
      }
    });
    await batch.commit();
    toast(`${itensImportados.length} itens importados com sucesso.`);
    itensImportados = [];
    renderPreviewImportacao();
    document.getElementById("importFile").value = "";
  } catch (err) {
    console.error(err);
    toast("Erro ao importar planilha.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar importação";
  }
});

// ============================================================
// RELATÓRIOS
// ============================================================
let relatorioPeriodo = "semana";
document.querySelectorAll("#relatorioPeriodo button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#relatorioPeriodo button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    relatorioPeriodo = btn.dataset.p;
    renderRelatorio();
  });
});

function movsDoPeriodoRelatorio() {
  const agora = new Date();
  return movsCache.filter(m => {
    const d = m.data.toDate ? m.data.toDate() : new Date(m.data);
    if (relatorioPeriodo === "semana") {
      return (agora - d) / (1000 * 60 * 60 * 24) <= 7;
    }
    if (relatorioPeriodo === "mes") {
      return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    }
    if (relatorioPeriodo === "mes-anterior") {
      const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      return d.getMonth() === mesAnterior.getMonth() && d.getFullYear() === mesAnterior.getFullYear();
    }
    return true;
  });
}

function renderRelatorio() {
  const movs = movsDoPeriodoRelatorio();
  const saidas = movs.filter(m => m.tipo === "saida");
  const entradas = movs.filter(m => m.tipo === "entrada");

  document.getElementById("relSaidas").textContent = saidas.reduce((s, m) => s + m.quantidade, 0);
  document.getElementById("relEntradas").textContent = entradas.reduce((s, m) => s + m.quantidade, 0);

  const somaPorItem = {};
  saidas.forEach(m => { somaPorItem[m.itemNome] = (somaPorItem[m.itemNome] || 0) + m.quantidade; });
  const top = Object.entries(somaPorItem).sort((a, b) => b[1] - a[1]);

  document.getElementById("relTopItem").textContent = top.length ? top[0][0] : "—";

  const tbody = document.getElementById("relTopBody");
  document.getElementById("relEmpty").style.display = top.length ? "none" : "block";
  tbody.innerHTML = top.slice(0, 5).map(([nome, qtd]) => {
    const item = itensCache.find(i => i.nome === nome);
    return `<tr><td>${nome}</td><td>${item ? `<span class="badge badge-cat">${item.categoria}</span>` : "—"}</td><td>${qtd}</td></tr>`;
  }).join("");
}

document.getElementById("btnExportarRelatorio").addEventListener("click", () => {
  const movs = movsDoPeriodoRelatorio();
  if (!movs.length) { toast("Não há movimentações neste período para exportar.", true); return; }
  const linhas = movs.map(m => {
    const d = m.data.toDate ? m.data.toDate() : new Date(m.data);
    return {
      "Data": d.toLocaleDateString("pt-BR"),
      "Item": m.itemNome,
      "Tipo": m.tipo === "entrada" ? "Entrada" : "Saída",
      "Quantidade": m.quantidade,
      "Observação": m.observacao || ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, `relatorio-estoque-${relatorioPeriodo}.xlsx`);
});

// ============================================================
// LISTA DE COMPRAS
// ============================================================
function itensParaCompra() {
  return itensCache.filter(i => statusItem(i) !== "ok").map(i => ({
    ...i,
    status: statusItem(i),
    sugestao: Math.max(i.quantidadeMinima * 2 - i.quantidadeAtual, i.quantidadeMinima - i.quantidadeAtual, 1)
  })).sort((a, b) => (a.status === "critico" ? 0 : 1) - (b.status === "critico" ? 0 : 1));
}

function renderCompras() {
  const lista = itensParaCompra();
  const tbody = document.getElementById("comprasTableBody");
  document.getElementById("comprasEmpty").style.display = lista.length ? "none" : "block";
  tbody.innerHTML = lista.map(item => `<tr>
    <td><strong>${item.nome}</strong></td>
    <td><span class="badge badge-cat">${item.categoria}</span></td>
    <td>${item.quantidadeAtual} ${item.unidade}</td>
    <td>${item.quantidadeMinima} ${item.unidade}</td>
    <td>${badgeStatus(item.status)}</td>
    <td>${Math.ceil(item.sugestao)} ${item.unidade}</td>
  </tr>`).join("");
}

document.getElementById("btnExportarCompras").addEventListener("click", () => {
  const lista = itensParaCompra();
  if (!lista.length) { toast("Nenhum item precisa de reposição no momento.", true); return; }
  const linhas = lista.map(item => ({
    "Item": item.nome,
    "Categoria": item.categoria,
    "Quantidade Atual": item.quantidadeAtual,
    "Quantidade Mínima": item.quantidadeMinima,
    "Status": item.status === "critico" ? "Abaixo do mínimo" : "Em atenção",
    "Sugestão de Compra": Math.ceil(item.sugestao),
    "Unidade": item.unidade
  }));
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 18 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lista de Compras");
  XLSX.writeFile(wb, `lista-de-compras-${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`);
});
