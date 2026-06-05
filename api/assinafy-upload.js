import fs from "node:fs/promises";
import { IncomingForm } from "formidable";
import {
  getAssinafyBaseUrl,
  getAssinafyHeaders,
  getDocumentData,
} from "../lib/assinafy.js";
import { saveDocumentMetadata } from "../lib/document-store.js";
import { isValidEmail, sendNewProponenteEmail, sendSignerInvitationEmail } from "../lib/email.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const accountId = process.env.ASSINAFY_ACCOUNT_ID;
    const baseUrl = getAssinafyBaseUrl();

    const sindicatoSignerEmail = process.env.ASSINAFY_SIGNER_EMAIL || process.env.ASSINAFY_ADMIN_SIGNER_EMAIL;
    const sindicatoSignerName = process.env.ASSINAFY_SIGNER_NAME || process.env.ASSINAFY_ADMIN_SIGNER_NAME || "Representante do Sindicato";

    if (!accountId) return sendJson(res, 500, { message: "Configure ASSINAFY_ACCOUNT_ID na Vercel." });
    if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN na Vercel." });
    }
    if (!sindicatoSignerEmail || !isValidEmail(sindicatoSignerEmail)) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_SIGNER_EMAIL com o e-mail do signatário do sindicato." });
    }

    const { fields, files } = await parseMultipartForm(req);
    const uploadedFile = getSingleFile(files.file);
    const proponenteEmail = getField(fields.recipientEmail);
    const proponenteName = getField(fields.recipientName) || "Proponente";
    const proponenteCpf = getField(fields.proponenteCpf);
    const proponenteNascimento = getField(fields.proponenteNascimento);
    const requestedDocumentName = getField(fields.documentName);

    if (!uploadedFile) return sendJson(res, 400, { message: "Nenhum PDF foi enviado." });
    if (!proponenteEmail || !isValidEmail(proponenteEmail)) {
      return sendJson(res, 400, { message: "E-mail do proponente titular inválido ou ausente." });
    }

    const documentName = normalizePdfFilename(
      requestedDocumentName || uploadedFile.originalFilename || `ficha-${slugify(proponenteName)}.pdf`
    );

    const finalRecipients = buildFinalRecipients({
      extraEmails: [process.env.FINAL_DOCUMENT_EMAIL_1, process.env.FINAL_DOCUMENT_EMAIL_2],
    });

    const metadata = {
      proponenteEmail,
      proponenteName,
      proponenteSignerEmail: proponenteEmail,
      proponenteSignerName: proponenteName,
      proponenteCpf,
      proponenteNascimento,
      sindicatoSignerEmail,
      sindicatoSignerName,
      finalRecipients,
      documentName,
      createdAt: new Date().toISOString(),
      flow: "sindpol-document-signature-email-final-v4",
      assignmentStatus: "pending",
    };

    const fileBuffer = await fs.readFile(uploadedFile.filepath);

    const documentResult = await uploadPdfToDocuments({
      baseUrl,
      accountId,
      fileBuffer,
      filename: documentName,
      metadata,
    });

    const documentId = getDocumentId(documentResult);

    if (!documentId) {
      return sendJson(res, 500, {
        message: "Documento criado, mas não foi possível localizar o ID retornado pela Assinafy.",
        documentResult,
      });
    }

    saveDocumentMetadata(documentId, metadata);

    let newProponenteEmailNotification = null;
    try {
      newProponenteEmailNotification = await sendNewProponenteEmail({
        nome: proponenteName,
        cpf: proponenteCpf,
        nascimento: proponenteNascimento,
      });
    } catch (emailNotificationError) {
      // O aviso de novo cadastro não pode travar o fluxo principal da Assinafy.
      // Caso o SMTP ou FINAL_DOCUMENT_EMAIL_1 esteja incorreto, o documento continua sendo criado.
      console.error("[SINDPOL] Falha ao enviar e-mail de novo proponente:", emailNotificationError);
      newProponenteEmailNotification = {
        sent: false,
        error: emailNotificationError?.message || "Falha ao enviar e-mail de novo proponente.",
      };
    }

    // IMPORTANTE:
    // Não criamos a atribuição nesta mesma requisição. A Assinafy pode devolver o documento
    // com status metadata_processing por alguns segundos. Se tentarmos criar a atribuição
    // neste momento, a API retorna erro.
    //
    // Por isso, o fluxo agora é em 2 etapas:
    // 1) /api/assinafy-upload cria apenas o documento;
    // 2) o front chama /api/start-assignment em loop até a Assinafy permitir criar a atribuição.
    return sendJson(res, 202, {
      message: "Documento criado na Assinafy. A assinatura será iniciada assim que o processamento terminar.",
      documentId,
      signerEmail: sindicatoSignerEmail,
      proponenteEmail,
      proponenteSignerEmail: proponenteEmail,
      sindicatoSignerEmail,
      finalRecipients,
      newProponenteEmailNotification,
      nextStep: `/api/start-assignment?documentId=${documentId}`,
      assignmentCreated: false,
    });
  } catch (error) {
    console.error("[SINDPOL] Erro ao criar fluxo de assinatura:", error);
    return sendJson(res, 500, { message: error?.message || "Erro interno ao processar o envio para a Assinafy." });
  }
}

export async function startAssignmentFlow({ baseUrl, accountId, documentId, signerEmail, signerName, metadata }) {
  const proponenteEmail = metadata?.proponenteSignerEmail || metadata?.proponenteEmail;
  const proponenteName = metadata?.proponenteSignerName || metadata?.proponenteName || "Proponente";
  const sindicatoEmail = metadata?.sindicatoSignerEmail || signerEmail;
  const sindicatoName = metadata?.sindicatoSignerName || signerName || "Representante do Sindicato";

  if (!proponenteEmail || !isValidEmail(proponenteEmail)) {
    throw new Error("Não encontrei o e-mail do proponente para registrá-lo como signatário na Assinafy.");
  }

  if (!sindicatoEmail || !isValidEmail(sindicatoEmail)) {
    throw new Error("Não encontrei o e-mail do sindicato para registrá-lo como signatário na Assinafy.");
  }

  const proponenteSigner = await findOrCreateSigner({
    baseUrl,
    accountId,
    fullName: proponenteName,
    email: proponenteEmail,
  });

  const sindicatoSigner = await findOrCreateSigner({
    baseUrl,
    accountId,
    fullName: sindicatoName,
    email: sindicatoEmail,
  });

  const proponenteSignerId = getSignerId(proponenteSigner);
  const sindicatoSignerId = getSignerId(sindicatoSigner);

  if (!proponenteSignerId) {
    throw new Error("Documento criado, mas não consegui criar/localizar o signatário PROPONENTE na Assinafy.");
  }

  if (!sindicatoSignerId) {
    throw new Error("Documento criado, mas não consegui criar/localizar o signatário SINDICATO na Assinafy.");
  }

  const assignment = await createAssignment({
    baseUrl,
    documentId,
    proponenteSignerId,
    proponenteEmail,
    proponenteName,
    sindicatoSignerId,
    sindicatoEmail,
    sindicatoName,
    metadata: {
      ...metadata,
      proponenteSignerId,
      sindicatoSignerId,
      signers: [
        { role: "PROPONENTE", id: proponenteSignerId, email: proponenteEmail, name: proponenteName },
        { role: "SINDICATO", id: sindicatoSignerId, email: sindicatoEmail, name: sindicatoName },
      ],
      assignmentStatus: "created",
      assignmentCreatedAt: new Date().toISOString(),
    },
  });

  const proponenteInvitation = await notifySignerBySmtp({
    assignment,
    signerEmail: proponenteEmail,
    signerName: proponenteName,
    documentName: metadata?.documentName,
    signerId: proponenteSignerId,
  });

  const sindicatoInvitation = await notifySignerBySmtp({
    assignment,
    signerEmail: sindicatoEmail,
    signerName: sindicatoName,
    documentName: metadata?.documentName,
    signerId: sindicatoSignerId,
  });

  const signerInvitations = {
    proponente: proponenteInvitation,
    sindicato: sindicatoInvitation,
  };

  saveDocumentMetadata(documentId, {
    ...metadata,
    proponenteSignerId,
    sindicatoSignerId,
    assignment,
    signerInvitations,
    // Mantido por compatibilidade com versões anteriores do front/endpoints.
    signerInvitation: sindicatoInvitation,
    assignmentStatus: "created",
    assignmentCreatedAt: new Date().toISOString(),
  });

  return {
    assignment,
    signerInvitations,
    signerInvitation: sindicatoInvitation,
  };
}

function getSignerId(signer = {}) {
  return signer?.id || signer?.uuid || signer?.signer_id || signer?.data?.id || signer?.data?.uuid || "";
}

async function uploadPdfToDocuments({ baseUrl, accountId, fileBuffer, filename, metadata }) {
  const formData = new FormData();
  // A Assinafy espera o upload do documento como multipart contendo apenas o campo "file".
  // Metadados do fluxo ficam guardados no backend deste projeto após a API retornar o documentId.
  formData.append("file", new Blob([fileBuffer], { type: "application/pdf" }), filename);

  const response = await fetch(`${baseUrl}/accounts/${accountId}/documents`, {
    method: "POST",
    headers: getAssinafyHeaders(),
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) throw new Error(data?.message || data?.error || "Erro ao criar documento na Assinafy.");
  return data?.data || data;
}

async function findOrCreateSigner({ baseUrl, accountId, fullName, email }) {
  const searchUrl = `${baseUrl}/accounts/${accountId}/signers?search=${encodeURIComponent(email)}`;
  const listResponse = await fetch(searchUrl, { headers: getAssinafyHeaders() });
  const listData = await listResponse.json().catch(() => null);

  const signers = Array.isArray(listData?.data) ? listData.data : [];
  const existing = signers.find((signer) => String(signer.email || "").toLowerCase() === email.toLowerCase());
  if (existing) return existing;

  const response = await fetch(`${baseUrl}/accounts/${accountId}/signers`, {
    method: "POST",
    headers: { ...getAssinafyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, name: fullName, email }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `Erro ao criar signatário ${email} na Assinafy.`);
  return data?.data || data;
}

async function createAssignment({
  baseUrl,
  documentId,
  proponenteSignerId,
  proponenteEmail,
  proponenteName,
  sindicatoSignerId,
  sindicatoEmail,
  sindicatoName,
  metadata,
}) {
  const method = String(process.env.ASSINAFY_SIGNATURE_METHOD || "collect").toLowerCase();
  const signers = [
    {
      id: proponenteSignerId,
      verification_method: "Email",
      notification_methods: ["Email"],
    },
    {
      id: sindicatoSignerId,
      verification_method: "Email",
      notification_methods: ["Email"],
    },
  ];

  if (method === "virtual") {
    const body = {
      method: "virtual",
      signers,
      message:
        process.env.ASSINAFY_SIGNATURE_MESSAGE ||
        "Olá! Por favor, assine o documento enviado pelo SINDPOL/PA.",
      metadata,
      custom_data: metadata,
    };

    return postAssignment({ baseUrl, documentId, body });
  }

  const documentData = await getDocumentData(documentId);
  const page = getFirstPage(documentData);

  if (!page?.id) {
    throw new Error("Não consegui localizar o page_id do PDF na Assinafy. Aguarde o status metadata_ready e tente novamente.");
  }

  const signatureFieldId = await resolveSignatureFieldId({ baseUrl, accountId: process.env.ASSINAFY_ACCOUNT_ID });
  const proponentePosition = getProponenteSignatureDisplaySettings(page);
  const sindicatoPosition = getSindicatoSignatureDisplaySettings(page);

  const body = {
    method: "collect",
    signers,
    entries: [
      {
        page_id: page.id,
        fields: [
          {
            signer_id: proponenteSignerId,
            field_id: signatureFieldId,
            display_settings: proponentePosition,
          },
          {
            signer_id: sindicatoSignerId,
            field_id: signatureFieldId,
            display_settings: sindicatoPosition,
          },
        ],
      },
    ],
    message:
      process.env.ASSINAFY_SIGNATURE_MESSAGE ||
      "Olá! Por favor, assine o documento nos campos indicados para que os dados constem no documento de autenticidade da Assinafy.",
    metadata,
    custom_data: metadata,
  };

  return postAssignment({ baseUrl, documentId, body });
}

async function postAssignment({ baseUrl, documentId, body }) {
  const response = await fetch(`${baseUrl}/documents/${documentId}/assignments`, {
    method: "POST",
    headers: { ...getAssinafyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Documento criado, mas falhou ao solicitar assinatura na Assinafy. Status HTTP: ${response.status}`
    );
  }
  return data?.data || data;
}

function getFirstPage(documentData) {
  const pages = documentData?.pages || documentData?.document?.pages || documentData?.data?.pages || [];
  return Array.isArray(pages) ? pages[0] : null;
}

async function resolveSignatureFieldId({ baseUrl, accountId }) {
  if (process.env.ASSINAFY_SIGNATURE_FIELD_ID) return process.env.ASSINAFY_SIGNATURE_FIELD_ID;

  if (!accountId) {
    throw new Error("Configure ASSINAFY_ACCOUNT_ID para localizar o campo de assinatura padrão.");
  }

  const url = `${baseUrl}/accounts/${accountId}/fields?include_standard=true&include_inactive=false`;
  const response = await fetch(url, { headers: getAssinafyHeaders() });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || "Não foi possível listar os campos padrão da Assinafy.");
  }

  const fields = Array.isArray(data?.data) ? data.data : [];
  const signatureField = fields.find((field) => String(field?.type || "").toLowerCase() === "signature");

  if (!signatureField?.id) {
    throw new Error("Não encontrei o field_id padrão de assinatura. Configure ASSINAFY_SIGNATURE_FIELD_ID na Vercel.");
  }

  return signatureField.id;
}

function getProponenteSignatureDisplaySettings(page = {}) {
  if (process.env.ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON) {
    try {
      return JSON.parse(process.env.ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON);
    } catch {
      console.warn("ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON inválido. Usando posição padrão.");
    }
  }

  // Campo do PROPONENTE: canto inferior esquerdo, acima de "ASSINATURA DO(A) PROPONENTE".
  const widthScale = Number(page.width || 1275) / 595;
  const heightScale = Number(page.height || 2100) / 842;

  return {
    left: Math.round(48 * widthScale),
    top: Math.round(724 * heightScale),
    width: Math.round(164 * widthScale),
    height: Math.round(36 * heightScale),
    fontSize: 18,
    fontFamily: "Arial",
    backgroundColor: "rgb(195, 230, 203)",
  };
}

function getSindicatoSignatureDisplaySettings(page = {}) {
  if (process.env.ASSINAFY_SIGNATURE_FIELD_JSON) {
    try {
      return JSON.parse(process.env.ASSINAFY_SIGNATURE_FIELD_JSON);
    } catch {
      console.warn("ASSINAFY_SIGNATURE_FIELD_JSON inválido. Usando posição padrão.");
    }
  }

  // A API da Assinafy usa o tamanho renderizado da página, normalmente maior que o PDF em pontos.
  // O PDF modelo tem ~595x842 pontos; no retorno da Assinafy o exemplo comum vem em ~1275x2100.
  // A área "ASSINATURA DO SINDICATO" fica no canto inferior direito da primeira página,
  // com o pontilhado em aproximadamente y=764 e o texto logo abaixo.
  // Portanto, o campo deve começar acima do pontilhado, sem cobrir a legenda.
  const widthScale = Number(page.width || 1275) / 595;
  const heightScale = Number(page.height || 2100) / 842;

  return {
    // Alinhado ao bloco direito, exatamente acima de "ASSINATURA DO SINDICATO".
    left: Math.round(382 * widthScale),
    top: Math.round(724 * heightScale),
    width: Math.round(164 * widthScale),
    height: Math.round(36 * heightScale),
    fontSize: 18,
    fontFamily: "Arial",
    backgroundColor: "rgb(195, 230, 203)",
  };
}


function extractSigningUrl(payload, signer = {}) {
  const urls = [];
  const signerSpecificUrls = [];
  const wantedId = String(signer.signerId || "").toLowerCase();
  const wantedEmail = String(signer.signerEmail || "").toLowerCase();

  function objectBelongsToSigner(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const text = JSON.stringify(value).toLowerCase();
    return Boolean((wantedId && text.includes(wantedId)) || (wantedEmail && text.includes(wantedEmail)));
  }

  function walk(value, insideSignerObject = false) {
    if (!value) return;

    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) {
        urls.push(value);
        if (insideSignerObject) signerSpecificUrls.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, insideSignerObject));
      return;
    }

    if (typeof value === "object") {
      const belongs = insideSignerObject || objectBelongsToSigner(value);
      Object.entries(value).forEach(([key, val]) => {
        const lowerKey = String(key || "").toLowerCase();

        if (
          typeof val === "string" &&
          /^https?:\/\//i.test(val) &&
          (
            lowerKey.includes("url") ||
            lowerKey.includes("link") ||
            lowerKey.includes("assin") ||
            lowerKey.includes("sign") ||
            lowerKey.includes("collect")
          )
        ) {
          urls.push(val);
          if (belongs) signerSpecificUrls.push(val);
        }

        walk(val, belongs);
      });
    }
  }

  walk(payload);

  const pool = signerSpecificUrls.length ? signerSpecificUrls : urls;
  const preferred = pool.find((url) => /sign|assin|collect|token|signature/i.test(url));
  return preferred || pool[0] || "";
}

async function notifySignerBySmtp({ assignment, signerEmail, signerName, documentName, signerId }) {
  const signUrl = extractSigningUrl(assignment, { signerId, signerEmail });

  if (!signUrl) {
    console.warn("[SINDPOL] Atribuição criada, mas a Assinafy não retornou link de assinatura no payload.");
    return {
      sent: false,
      reason: "A Assinafy não retornou link de assinatura no payload da atribuição.",
    };
  }

  await sendSignerInvitationEmail({
    to: signerEmail,
    signerName,
    documentName,
    signUrl,
  });

  return {
    sent: true,
    signUrl,
  };
}


function parseMultipartForm(req) {
  const form = new IncomingForm({ multiples: false, keepExtensions: true, maxFileSize: 15 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => (error ? reject(error) : resolve({ fields, files })));
  });
}

function buildFinalRecipients({ extraEmails = [] } = {}) {
  return [...new Set(
    extraEmails
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(isValidEmail)
  )].slice(0, 2);
}

function getSingleFile(fileValue) {
  return Array.isArray(fileValue) ? fileValue[0] : fileValue;
}

function getField(fieldValue) {
  const value = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue;
  return String(value || "").trim();
}

function getDocumentId(data) {
  return data?.data?.id || data?.id || data?.document?.id || data?.data?.document?.id || data?.uuid || "";
}

function normalizePdfFilename(value) {
  const filename = String(value || "ficha-sindpol.pdf").trim().replace(/[^a-zA-Z0-9À-ÿ._ -]/g, "").replace(/\s+/g, "-").toLowerCase();
  return filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
}

function slugify(value) {
  return String(value || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
