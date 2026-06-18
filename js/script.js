
function isAssinafyDocumentFullySigned(payload = {}) {
  const rawStatus = String(
    payload.status ||
    payload.document_status ||
    payload.document?.status ||
    payload.data?.status ||
    payload.data?.document?.status ||
    payload.event ||
    ""
  ).toLowerCase();

  const finishedStatuses = [
    "assinado",
    "signed",
    "completed",
    "complete",
    "concluido",
    "concluído",
    "finalizado",
    "finished"
  ];

  return finishedStatuses.some((status) => rawStatus.includes(status));
}

// ===============================
// ELEMENTOS DOM
// ===============================
const form1 = document.getElementById("cadastroForm1");
const proponentesContainer = document.getElementById("proponentes-container");
const addProponenteBtn = document.getElementById("addProponenteBtn");
const valorTotalOutput = document.getElementById("valorTotal");
const dadosPagadorSection = document.getElementById("dados-pagador-section");
const submitBtn = document.querySelector(".submit-btn");

const VALOR_POR_PESSOA = 40;
const MAX_PROPONENTES_VINCULADOS = 5;
let pagadorAlertShown = false;

// ===============================
// FUNÇÕES AUXILIARES
// ===============================
function onlyNumbers(value) {
  return (value || "").replace(/\D/g, "");
}

function formatCPF(value) {
  value = onlyNumbers(value).slice(0, 11);
  value = value.replace(/(\d{3})(\d)/, "$1.$2");
  value = value.replace(/(\d{3})(\d)/, "$1.$2");
  value = value.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return value;
}

function formatCEP(value) {
  value = onlyNumbers(value).slice(0, 8);
  value = value.replace(/(\d{5})(\d)/, "$1-$2");
  return value;
}

function formatPhone(value) {
  value = onlyNumbers(value).slice(0, 11);

  if (value.length <= 10) {
    value = value.replace(/(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d{4})(\d)/, "$1-$2");
  } else {
    value = value.replace(/(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d{5})(\d)/, "$1-$2");
  }

  return value;
}

function formatDateBR(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatCurrencyBR(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function slugify(value) {
  return String(value || "documento")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "documento";
}

function getFieldValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setFieldValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || "";
}

// ===============================
// MÁSCARAS
// ===============================
["f1_cpf", "pagador_cpf"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatCPF(event.target.value);
  });
});

["f1_cep", "pagador_cep"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatCEP(event.target.value);
  });
});

["f1_telefone", "pagador_telefone"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatPhone(event.target.value);
  });
});

// ===============================
// VIA CEP
// ===============================
async function buscarCEP(cep, prefix) {
  const cepLimpo = onlyNumbers(cep);
  if (cepLimpo.length !== 8) return;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const data = await response.json();

    if (data.erro) {
      alert("CEP não encontrado.");
      return;
    }

    const enderecoInput = document.getElementById(`${prefix}_endereco`);
    const bairroInput = document.getElementById(`${prefix}_bairro`);
    const cidadeInput = document.getElementById(`${prefix}_cidade`);
    const ufInput = document.getElementById(`${prefix}_uf`);

    if (bairroInput) bairroInput.value = data.bairro || "";
    if (cidadeInput) cidadeInput.value = data.localidade || "";
    if (ufInput) ufInput.value = data.uf || "";

    if (enderecoInput && !enderecoInput.value.trim()) {
      enderecoInput.value = data.logradouro || "";
    }
  } catch (error) {
    console.error("Erro ao buscar CEP:", error);
    alert("Erro ao consultar o CEP.");
  }
}

document.getElementById("f1_cep")?.addEventListener("blur", (event) => buscarCEP(event.target.value, "f1"));
document.getElementById("pagador_cep")?.addEventListener("blur", (event) => buscarCEP(event.target.value, "pagador"));

// ===============================
// PROPONENTES ADICIONAIS
// ===============================
function atualizarOrdemProponentes() {
  const cards = [...document.querySelectorAll(".proponente-card")];

  cards.forEach((card, index) => {
    const number = index + 1;
    card.dataset.index = String(number);
    card.querySelector(".proponente-title").textContent = `Proponente ${number}`;

    card.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      input.id = `proponente_${field}_${number}`;
      input.name = `proponente_${field}_${number}`;
    });

    card.querySelectorAll("label").forEach((label) => {
      const field = label.dataset.field;
      label.setAttribute("for", `proponente_${field}_${number}`);
    });
  });
}

function criarProponenteCard() {
  const totalAtual = document.querySelectorAll(".proponente-card").length;

  // O PDF oficial possui apenas 5 linhas numeradas para proponentes vinculados: 01, 02, 03, 04 e 05.
  // Por isso, o sistema limita o cadastro para evitar que alguém adicione um sexto vinculado que não teria espaço no PDF.
  if (totalAtual >= MAX_PROPONENTES_VINCULADOS) {
    alert("O PDF permite preencher até 5 proponentes vinculados.");
    return;
  }

  const number = totalAtual + 1;
  const card = document.createElement("div");
  card.className = "proponente-card";
  card.dataset.index = String(number);

  card.innerHTML = `
    <div class="proponente-top">
      <span class="proponente-title">Proponente ${number}</span>
      <div class="proponente-actions">
        <button class="btn btn-value valor-pessoa-btn" type="button" disabled>Valor por pessoa: R$ 40,00</button>
        <button type="button" class="btn btn-danger delete-btn" aria-label="Excluir proponente">
          🗑 Excluir
        </button>
      </div>
    </div>

    <div class="grid">
      <div class="field full">
        <label data-field="nome" for="proponente_nome_${number}">Nome:</label>
        <input data-field="nome" type="text" id="proponente_nome_${number}" name="proponente_nome_${number}" />
      </div>

      <div class="field">
        <label data-field="cpf" for="proponente_cpf_${number}">CPF:</label>
        <input data-field="cpf" type="text" id="proponente_cpf_${number}" name="proponente_cpf_${number}" />
      </div>

      <div class="field">
        <label data-field="nascimento" for="proponente_nascimento_${number}">Data de nascimento:</label>
        <input data-field="nascimento" type="date" id="proponente_nascimento_${number}" name="proponente_nascimento_${number}" />
      </div>

      <div class="field full">
        <label data-field="email" for="proponente_email_${number}">E-mail:</label>
        <input data-field="email" type="email" id="proponente_email_${number}" name="proponente_email_${number}" />
      </div>
    </div>
  `;

  card.querySelector(".delete-btn").addEventListener("click", () => {
    card.remove();
    atualizarOrdemProponentes();
    gerarValorTotal();
  });

  card.querySelector('[data-field="cpf"]')?.addEventListener("input", (event) => {
    event.target.value = formatCPF(event.target.value);
  });

  proponentesContainer?.appendChild(card);
  atualizarOrdemProponentes();
  gerarValorTotal();
}

function getProponentesAdicionais() {
  // Cada card criado na tela representa uma linha numerada no PDF:
  // Proponente 1 -> linha 01, Proponente 2 -> linha 02, e assim por diante até a linha 05.
  // A coleta abaixo usa duas estratégias: primeiro lê os cards visíveis; depois reforça a leitura pelos IDs.
  // Isso evita falhas caso algum navegador altere a ordem do DOM ou algum card seja recriado dinamicamente.
  const proponentes = [];
  const cards = [...document.querySelectorAll(".proponente-card")].slice(0, MAX_PROPONENTES_VINCULADOS);

  cards.forEach((card, index) => {
    const numero = index + 1;
    const nome = card.querySelector('[data-field="nome"]')?.value?.trim() || getFieldValue(`proponente_nome_${numero}`);
    const cpf = card.querySelector('[data-field="cpf"]')?.value?.trim() || getFieldValue(`proponente_cpf_${numero}`);
    const nascimentoRaw = card.querySelector('[data-field="nascimento"]')?.value || getFieldValue(`proponente_nascimento_${numero}`);
    const email = card.querySelector('[data-field="email"]')?.value?.trim() || getFieldValue(`proponente_email_${numero}`);

    proponentes.push({
      numero,
      nome,
      cpf,
      nascimento: formatDateBR(nascimentoRaw),
      email,
      valorPorPessoa: VALOR_POR_PESSOA,
    });
  });

  // Fallback: caso exista input com ID de proponente, mas o card não tenha sido capturado pela classe.
  for (let numero = 1; numero <= MAX_PROPONENTES_VINCULADOS; numero++) {
    const jaExiste = proponentes.some((proponente) => proponente.numero === numero);
    if (jaExiste) continue;

    const nome = getFieldValue(`proponente_nome_${numero}`);
    const cpf = getFieldValue(`proponente_cpf_${numero}`);
    const nascimento = formatDateBR(getFieldValue(`proponente_nascimento_${numero}`));
    const email = getFieldValue(`proponente_email_${numero}`);

    if (nome || cpf || nascimento || email) {
      proponentes.push({
        numero,
        nome,
        cpf,
        nascimento,
        email,
        valorPorPessoa: VALOR_POR_PESSOA,
      });
    }
  }

  return proponentes
    .sort((a, b) => a.numero - b.numero)
    .slice(0, MAX_PROPONENTES_VINCULADOS)
    .filter((proponente) => proponente.nome || proponente.cpf || proponente.nascimento || proponente.email);
}

addProponenteBtn?.addEventListener("click", () => {
  criarProponenteCard();
});

// ===============================
// DADOS DO RESPONSÁVEL FINANCEIRO
// ===============================
function copiarDadosProponenteParaPagador() {
  const map = {
    pagador_nome: "f1_nome",
    pagador_rg: "f1_rg",
    pagador_cpf: "f1_cpf",
    pagador_sexo: "f1_sexo",
    pagador_admissao: "f1_admissao",
    pagador_nascimento: "f1_nascimento",
    pagador_tipoSanguineo: "f1_tipoSanguineo",
    pagador_endereco: "f1_endereco",
    pagador_cep: "f1_cep",
    pagador_bairro: "f1_bairro",
    pagador_cidade: "f1_cidade",
    pagador_uf: "f1_uf",
    pagador_telefone: "f1_telefone",
    pagador_email: "f1_email",
    pagador_cargo: "f1_cargo",
    pagador_lotacao: "f1_lotacao",
    pagador_situacaoFuncional: "f1_situacaoFuncional",
  };

  Object.entries(map).forEach(([pagadorId, proponenteId]) => {
    setFieldValue(pagadorId, getFieldValue(proponenteId));
  });
}

function fecharAlertaPagador() {
  document.querySelector(".payer-alert-overlay")?.remove();
}

function mostrarAlertaPagador() {
  if (pagadorAlertShown) return;
  pagadorAlertShown = true;

  const overlay = document.createElement("div");
  overlay.className = "payer-alert-overlay";
  overlay.innerHTML = `
    <div class="payer-alert-card" role="dialog" aria-modal="true">
      <p>Deseja utilizar os mesmos dados já preenchidos?</p>
      <div class="payer-alert-actions">
        <button type="button" class="btn btn-success" id="usarDadosProponenteBtn">Sim</button>
        <button type="button" class="btn btn-danger" id="preencherManualBtn">Não</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("usarDadosProponenteBtn")?.addEventListener("click", () => {
    copiarDadosProponenteParaPagador();
    fecharAlertaPagador();
  });

  document.getElementById("preencherManualBtn")?.addEventListener("click", fecharAlertaPagador);
}

dadosPagadorSection?.addEventListener("focusin", mostrarAlertaPagador);


// ===============================
// FORMA DE PAGAMENTO
// ===============================
// A forma de pagamento agora é fixa como BOLETO, conforme novo PDF oficial.
// As antigas opções de pagamento e seus campos foram removidos para simplificar o fluxo.
function getFormaPagamento() {
  return {
    forma: "boleto",
    boleto: {
      melhorDiaPagamento: "",
    },
    cartaoCredito: {},
    debitoConta: {},
    descontoFolha: {},
  };
}

function resetarFormaPagamento() {
  gerarValorTotal();
}

// ===============================
// VALOR TOTAL
// ===============================
function calcularValorTotal() {
  const quantidadePessoas = document.querySelectorAll(".valor-pessoa-btn").length;
  return quantidadePessoas * VALOR_POR_PESSOA;
}

function gerarValorTotal() {
  const total = calcularValorTotal();

  if (valorTotalOutput) {
    valorTotalOutput.textContent = formatCurrencyBR(total);
  }

  return total;
}


// ===============================
// COLETA DE DADOS
// ===============================
function getFormDataObject() {
  return {
    tipoFormulario: "Formulário 1 - Clube de Benefícios Planos de Saúde",
    enviadoEm: new Date().toISOString(),
    valorPorPessoa: VALOR_POR_PESSOA,
    valorTotal: gerarValorTotal(),
    dadosProponente: {
      nome: getFieldValue("f1_nome"),
      rg: getFieldValue("f1_rg"),
      cpf: getFieldValue("f1_cpf"),
      sexo: getFieldValue("f1_sexo"),
      admissao: formatDateBR(getFieldValue("f1_admissao")),
      nascimento: formatDateBR(getFieldValue("f1_nascimento")),
      tipoSanguineo: getFieldValue("f1_tipoSanguineo"),
      endereco: getFieldValue("f1_endereco"),
      cep: getFieldValue("f1_cep"),
      bairro: getFieldValue("f1_bairro"),
      cidade: getFieldValue("f1_cidade"),
      uf: getFieldValue("f1_uf"),
      telefone: getFieldValue("f1_telefone"),
      email: getFieldValue("f1_email"),
      cargo: getFieldValue("f1_cargo"),
      lotacao: getFieldValue("f1_lotacao"),
      situacaoFuncional: getFieldValue("f1_situacaoFuncional"),
    },
    dadosPagador: {
      nome: getFieldValue("pagador_nome"),
      rg: getFieldValue("pagador_rg"),
      cpf: getFieldValue("pagador_cpf"),
      sexo: getFieldValue("pagador_sexo"),
      admissao: formatDateBR(getFieldValue("pagador_admissao")),
      nascimento: formatDateBR(getFieldValue("pagador_nascimento")),
      tipoSanguineo: getFieldValue("pagador_tipoSanguineo"),
      endereco: getFieldValue("pagador_endereco"),
      cep: getFieldValue("pagador_cep"),
      bairro: getFieldValue("pagador_bairro"),
      cidade: getFieldValue("pagador_cidade"),
      uf: getFieldValue("pagador_uf"),
      telefone: getFieldValue("pagador_telefone"),
      email: getFieldValue("pagador_email"),
      cargo: getFieldValue("pagador_cargo"),
      lotacao: getFieldValue("pagador_lotacao"),
      situacaoFuncional: getFieldValue("pagador_situacaoFuncional"),
    },
    proponentesAdicionais: getProponentesAdicionais(),
    formaPagamento: getFormaPagamento(),
  };
}



// ===============================
// GERAÇÃO DO PDF + ENVIO PARA ASSINAFY
// ===============================
const PDF_MODELO_PATH = "docs/ficha-sindpol.pdf";
const ASSINAFY_UPLOAD_ENDPOINT = "/api/assinafy-upload";

function ajustarTextoAoBox(text, font, initialSize, maxWidth, minSize = 5.2) {
  const value = String(text || "").trim();
  let size = Number(initialSize || 6.6);

  // Primeiro reduz a fonte para manter o texto dentro do espaço branco do PDF.
  while (size > minSize && font.widthOfTextAtSize(value, size) > maxWidth) {
    size -= 0.2;
  }

  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return { value, size };
  }

  // Só corta no limite extremo, quando nem a fonte reduzida couber no campo.
  let compactValue = value;
  while (compactValue.length > 0 && font.widthOfTextAtSize(`${compactValue}…`, size) > maxWidth) {
    compactValue = compactValue.slice(0, -1);
  }

  return { value: compactValue ? `${compactValue}…` : "", size };
}

function drawTextInBox(page, text, box, options = {}) {
  if (!text) return;

  const [x, y, width, height] = box;
  const font = options.font;
  const initialSize = options.size || 6.6;
  const minSize = options.minSize || 5.2;
  const paddingX = options.paddingX ?? 3;
  const pageHeight = page.getHeight();
  const maxWidth = Math.max(4, width - paddingX * 2);
  const fitted = ajustarTextoAoBox(text, font, initialSize, maxWidth, minSize);

  if (!fitted.value) return;

  // O y informado representa a posição visual do topo do campo no PDF renderizado.
  // A centralização vertical evita que o texto encoste nas bordas/linhas do modelo.
  const pdfX = x + paddingX;
  const pdfY = pageHeight - y - height + ((height - fitted.size) / 2) + 0.6;

  page.drawText(fitted.value, {
    x: pdfX,
    y: pdfY,
    size: fitted.size,
    font,
    color: PDFLib.rgb(0, 0, 0),
  });
}

function drawCheckInBox(page, active, box, font) {
  if (!active) return;

  const [x, y, width, height] = box;
  const pageHeight = page.getHeight();
  const size = 9;

  page.drawText("X", {
    x: x + width / 2 - 3,
    y: pageHeight - y - height + ((height - size) / 2) + 1,
    size,
    font,
    color: PDFLib.rgb(0, 0, 0),
  });
}


async function preencherPdf(payload) {
  if (!window.PDFLib) {
    throw new Error("Biblioteca de PDF não carregada. Verifique sua conexão e tente novamente.");
  }

  const response = await fetch(PDF_MODELO_PATH);
  if (!response.ok) {
    throw new Error("PDF modelo não encontrado na pasta docs.");
  }

  const existingPdfBytes = await response.arrayBuffer();
  const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];

  const titular = payload.dadosProponente;
  const pagador = payload.dadosPagador;
  const pagamento = payload.formaPagamento;
  const vinculados = payload.proponentesAdicionais.slice(0, 5);
  const totalFormatado = formatCurrencyBR(payload.valorTotal);

  const B = {
    // Coordenadas finais calibradas no PDF otimizado usado em docs/ficha-sindpol.pdf.
    // Formato: [x, yVisualDoTopo, largura, altura], em pontos PDF.
    // O yVisualDoTopo segue a mesma orientação visual da página renderizada: de cima para baixo.
    titular: {
      nome: [66.0, 108.7, 174.0, 16.7],
      rg: [262.0, 108.7, 50.7, 16.7],
      cpf: [340.0, 108.7, 78.7, 16.7],
      nascimento: [490.0, 108.7, 72.0, 19.3],
      sexo: [61.3, 131.3, 107.3, 18.0],
      tipoSanguineo: [247.3, 132.7, 65.3, 18.0],
      admissao: [402.7, 132.0, 104.0, 18.7],
      telefone: [134.7, 153.3, 106.0, 17.3],
      email: [274.0, 153.3, 233.3, 18.7],
      endereco: [81.3, 177.3, 160.7, 16.7],
      cidade: [280.0, 176.0, 67.3, 18.7],
      uf: [368.7, 176.7, 48.7, 18.0],
      cep: [444.0, 176.0, 116.0, 18.0],
      cargo: [64.0, 195.3, 108.0, 16.0],
      lotacao: [214.0, 195.3, 98.7, 16.0],
      situacaoFuncional: [386.7, 195.3, 123.3, 16.0],
    },
    pagador: {
      nome: [66.0, 241.3, 176.0, 17.3],
      rg: [263.3, 242.0, 48.0, 16.7],
      cpf: [338.7, 243.3, 79.3, 15.3],
      nascimento: [488.7, 243.3, 76.0, 17.3],
      sexo: [60.0, 265.3, 112.0, 15.3],
      tipoSanguineo: [248.0, 266.7, 63.3, 16.7],
      admissao: [402.7, 266.0, 108.7, 17.3],
      telefone: [132.0, 288.0, 108.7, 16.0],
      email: [274.0, 287.3, 237.3, 16.7],
      endereco: [80.7, 308.7, 160.0, 17.3],
      cidade: [279.3, 308.0, 69.3, 18.0],
      uf: [370.0, 308.0, 48.7, 17.3],
      cep: [445.3, 308.0, 120.0, 17.3],
      cargo: [66.0, 332.0, 104.0, 14.0],
      lotacao: [216.0, 333.3, 96.7, 12.0],
      situacaoFuncional: [386.7, 331.3, 126.0, 14.0],
    },
    vinculados: [
      { nome: [63.0, 388.5, 160.0, 16.0], cpf: [248.0, 388.5, 76.0, 16.0], nascimento: [386.0, 388.5, 64.0, 16.0], email: [478.0, 388.5, 92.0, 16.0] },
      { nome: [63.0, 423.5, 160.0, 16.0], cpf: [248.0, 423.5, 76.0, 16.0], nascimento: [386.0, 423.5, 64.0, 16.0], email: [478.0, 423.5, 92.0, 16.0] },
      { nome: [63.0, 460.5, 160.0, 16.0], cpf: [248.0, 460.5, 76.0, 16.0], nascimento: [386.0, 460.5, 64.0, 16.0], email: [478.0, 460.5, 92.0, 16.0] },
      { nome: [63.0, 497.0, 160.0, 16.0], cpf: [248.0, 497.0, 76.0, 16.0], nascimento: [386.0, 497.0, 64.0, 16.0], email: [478.0, 497.0, 92.0, 16.0] },
      { nome: [63.0, 532.5, 160.0, 16.0], cpf: [248.0, 532.5, 76.0, 16.0], nascimento: [386.0, 532.5, 64.0, 16.0], email: [478.0, 532.5, 92.0, 16.0] },
    ],
    pagamento: {
      total: [307.0, 561.0, 90.0, 14.0],
    },
  };

  const drawPerson = (data, boxes) => {
    drawTextInBox(page, data.nome, boxes.nome, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.rg, boxes.rg, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.cpf, boxes.cpf, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.nascimento, boxes.nascimento, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.sexo, boxes.sexo, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.tipoSanguineo, boxes.tipoSanguineo, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.admissao, boxes.admissao, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.telefone, boxes.telefone, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.email, boxes.email, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.endereco, boxes.endereco, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.cidade, boxes.cidade, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.uf, boxes.uf, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.cep, boxes.cep, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.cargo, boxes.cargo, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.lotacao, boxes.lotacao, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, data.situacaoFuncional, boxes.situacaoFuncional, { font, size: 6.6, minSize: 5.0 });
  };

  drawPerson(titular, B.titular);
  drawPerson(pagador, B.pagador);

  vinculados.forEach((item, index) => {
    // Preenchimento fiel à numeração visual do PDF.
    // Linha 01 recebe o primeiro proponente capturado, linha 02 recebe o segundo, até a linha 05.
    // Se o objeto vier com numero explícito, ele é respeitado; se não vier, usa o índice como segurança.
    const linhaPdf = Number(item.numero || index + 1);
    const boxes = B.vinculados[linhaPdf - 1] || B.vinculados[index];
    if (!boxes) return;

    drawTextInBox(page, item.nome, boxes.nome, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, item.cpf, boxes.cpf, { font, size: 6.6, minSize: 5.0 });
    drawTextInBox(page, item.nascimento, boxes.nascimento, { font, size: 6.4, minSize: 4.8 });
    drawTextInBox(page, item.email, boxes.email, { font, size: 6.2, minSize: 4.6 });
  });

  drawTextInBox(page, totalFormatado, B.pagamento.total, { font: fontBold, size: 6.6, minSize: 5.0 });

  // Forma de pagamento fixa como BOLETO no novo modelo.


  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function enviarPdfParaAssinafy(pdfBlob, filename, payload) {
  const formData = new FormData();
  formData.append("file", pdfBlob, filename);

  // Estes dados não vão para o usuário final agora; ficam salvos no backend
  // vinculados ao documentId da Assinafy. Quando o webhook avisar que o documento
  // foi assinado por todos, o backend usa este mesmo e-mail para enviar o PDF final.
  formData.append("recipientEmail", payload.dadosProponente.email);
  formData.append("recipientName", payload.dadosProponente.nome);
  formData.append("proponenteCpf", payload.dadosProponente.cpf);
  formData.append("proponenteNascimento", payload.dadosProponente.nascimento);
  formData.append("documentName", filename);

  const response = await fetch(ASSINAFY_UPLOAD_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || "Não foi possível enviar o PDF para a Assinafy.");
  }

  return result;
}


async function iniciarAssinaturaAssinafyComRetry(resultadoAssinafy, payload) {
  const documentId = resultadoAssinafy?.documentId || resultadoAssinafy?.id;

  if (!documentId) {
    throw new Error("Documento criado, mas o ID não foi retornado pela Assinafy.");
  }

  const maxTentativas = 12;
  const intervaloMs = 4000;
  let ultimoResultado = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const response = await fetch("/api/start-assignment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        proponenteEmail: payload?.dadosProponente?.email || resultadoAssinafy?.proponenteEmail || resultadoAssinafy?.proponenteSignerEmail || "",
        proponenteName: payload?.dadosProponente?.nome || resultadoAssinafy?.proponenteName || resultadoAssinafy?.proponenteSignerName || "Proponente",
        sindicatoSignerEmail: resultadoAssinafy?.sindicatoSignerEmail || "",
      }),
    });

    const result = await response.json().catch(() => ({}));
    ultimoResultado = result;

    if (response.ok && result.assignmentCreated) {
      return result;
    }

    if (response.status !== 202 && !response.ok) {
      throw new Error(result.message || "Não foi possível iniciar a assinatura na Assinafy.");
    }

    if (submitBtn) {
      submitBtn.textContent = `Aguardando Assinafy... (${tentativa}/${maxTentativas})`;
    }

    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }

  throw new Error(
    ultimoResultado?.message ||
      "O documento foi criado, mas a Assinafy ainda está processando. Tente iniciar a assinatura novamente em alguns segundos."
  );
}

async function processarEnvio(event) {
  event.preventDefault();

  if (!form1.checkValidity()) {
    form1.reportValidity();
    return;
  }


  const payload = getFormDataObject();
  const filename = `ficha-${slugify(payload.dadosProponente.nome)}.pdf`;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Gerando PDF...";
    }

    const pdfBlob = await preencherPdf(payload);

    // A Vercel bloqueia requests para Functions acima de aproximadamente 4.5 MB.
    // Mantemos o modelo PDF otimizado e validamos antes do upload para evitar erro 413/FUNCTION_PAYLOAD_TOO_LARGE.
    const limiteVercelBytes = 4.2 * 1024 * 1024;
    if (pdfBlob.size > limiteVercelBytes) {
      throw new Error(
        `O PDF gerado ficou muito pesado (${(pdfBlob.size / 1024 / 1024).toFixed(2)} MB). ` +
          "O modelo precisa continuar otimizado para ser enviado pela Vercel."
      );
    }

    if (submitBtn) submitBtn.textContent = "Enviando para Assinafy...";
    const resultadoAssinafy = await enviarPdfParaAssinafy(pdfBlob, filename, payload);

    if (submitBtn) submitBtn.textContent = "Aguardando processamento da Assinafy...";
    await iniciarAssinaturaAssinafyComRetry(resultadoAssinafy, payload);

    alert("Documento enviado para a Assinafy. O proponente receberá o convite no e-mail informado no formulário e o sindicato também será registrado como 2º signatário. Quando os dois assinarem, o PDF final e o documento de autenticidade serão enviados aos 2 e-mails configurados.");
  } catch (error) {
    console.error("Erro no envio do formulário:", error);
    alert(error.message || "Erro ao gerar/enviar o PDF. Tente novamente.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar formulário";
    }
  }
}

form1?.addEventListener("submit", processarEnvio);

// ===============================
// INICIALIZAÇÃO
// ===============================
window.addEventListener("load", () => {
  if (proponentesContainer) proponentesContainer.innerHTML = "";
  gerarValorTotal();
  resetarFormaPagamento();
});