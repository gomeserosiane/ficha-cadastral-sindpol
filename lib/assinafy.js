export function getAssinafyHeaders(apiKeyOverride = "") {
  const apiKey = apiKeyOverride || process.env.ASSINAFY_API_KEY;
  const accessToken = process.env.ASSINAFY_ACCESS_TOKEN;
  const headers = {};

  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (apiKey) headers["X-Api-Key"] = apiKey;

  if (!apiKey && !accessToken) {
    throw new Error("Configure ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN nas variáveis de ambiente.");
  }

  return headers;
}

export function getAssinafyBaseUrl() {
  return process.env.ASSINAFY_BASE_URL || "https://api.assinafy.com.br/v1";
}

export function extractDocumentId(body = {}) {
  return (
    body?.object?.id ||
    body?.payload?.object?.id ||
    body?.payload?.document?.id ||
    body?.data?.document?.id ||
    body?.data?.id ||
    body?.document?.id ||
    body?.document_id ||
    body?.id_document ||
    body?.id ||
    ""
  );
}

export function extractMetadata(source) {
  if (!source) return {};

  const possible =
    source.metadata ||
    source.custom_data ||
    source.customData ||
    source.data?.metadata ||
    source.data?.custom_data ||
    source.data?.customData ||
    source.object?.metadata ||
    source.object?.custom_data ||
    source.object?.customData ||
    source.payload?.metadata ||
    source.payload?.custom_data ||
    source.payload?.customData ||
    {};

  if (typeof possible === "string") {
    try {
      return JSON.parse(possible);
    } catch {
      return {};
    }
  }

  return typeof possible === "object" && possible !== null ? possible : {};
}

export function isDocumentFinished(payload = {}) {
  const status = getDocumentStatus(payload);
  const values = collectStringValues(payload).join(" ").toLowerCase();

  const finishedTokens = [
    "certificated",
    "certificate",
    "document_ready",
    "assinado",
    "assinada",
    "signed",
    "completed",
    "complete",
    "concluido",
    "concluído",
    "concluida",
    "concluída",
    "finalizado",
    "finalizada",
    "finished",
    "ready",
  ];

  const pendingTokens = [
    "metadata_processing",
    "metadata_ready",
    "processing",
    "uploading",
    "uploaded",
    "pending",
    "pending_signature",
    "pendente",
    "waiting",
    "aguardando",
    "created",
    "criado",
    "sent",
    "enviado",
    "opened",
    "visualizado",
  ];

  if (status && pendingTokens.includes(status)) return false;
  if (status === "certificating") return false;
  return finishedTokens.some((token) => values.includes(token));
}

export function isDocumentBlockedForAssignment(payload = {}, method = process.env.ASSINAFY_SIGNATURE_METHOD || "collect") {
  const status = getDocumentStatus(payload);

  if (String(method).toLowerCase() === "collect") {
    // A Assinafy exige status metadata_ready para assinatura com campos.
    return status !== "metadata_ready";
  }

  return ["metadata_processing", "processing", "uploading", "creating", "queued"].includes(status);
}

export function getDocumentStatus(payload = {}) {
  return String(
    payload?.status ||
      payload?.document_status ||
      payload?.data?.status ||
      payload?.data?.document_status ||
      payload?.document?.status ||
      payload?.object?.status ||
      payload?.payload?.status ||
      payload?.payload?.document?.status ||
      ""
  ).toLowerCase();
}

function collectStringValues(value, acc = []) {
  if (value == null) return acc;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, acc));
    return acc;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, acc));
  }

  return acc;
}

export async function getDocumentData(documentId) {
  const baseUrl = getAssinafyBaseUrl();
  const urls = [`${baseUrl}/documents/${documentId}`];

  if (process.env.ASSINAFY_ACCOUNT_ID) {
    urls.push(`${baseUrl}/accounts/${process.env.ASSINAFY_ACCOUNT_ID}/documents/${documentId}`);
  }

  for (const url of urls) {
    const response = await fetch(url, { headers: getAssinafyHeaders() });
    const data = await response.json().catch(() => null);

    if (response.ok) return data?.data || data || null;
  }

  return null;
}

export async function downloadFinalPdf(documentId, documentData = null) {
  const data = documentData || (await getDocumentData(documentId));

  const directArtifacts = [
    ["certificated", data?.artifacts?.certificated],
    ["certificate", data?.artifacts?.certificate],
    ["bundle", data?.artifacts?.bundle],
    ["signed", data?.artifacts?.signed],
    ["final", data?.download_final_url || data?.signed_url || data?.final_url],
  ].filter(([, url]) => typeof url === "string" && url.startsWith("http"));

  for (const [artifactName, url] of directArtifacts) {
    const response = await fetch(url, { headers: getAssinafyHeaders() });
    if (response.ok) {
      return {
        pdfBuffer: Buffer.from(await response.arrayBuffer()),
        artifactName,
      };
    }
  }

  const baseUrl = getAssinafyBaseUrl();

  // Nunca use o artifact "original" como documento final.
  // O "original" é o PDF enviado para a Assinafy antes do signatário assinar;
  // se ele for baixado depois do webhook, a impressão é que a assinatura "sumiu".
  const artifactNames = ["certificated", "certificate", "bundle", "signed", "final"];
  const urls = [];

  for (const artifactName of artifactNames) {
    urls.push({ artifactName, url: `${baseUrl}/documents/${documentId}/download/${artifactName}` });
    urls.push({ artifactName, url: `${baseUrl}/documents/${documentId}/${artifactName}` });
    urls.push({ artifactName, url: `${baseUrl}/documents/${documentId}/download?artifact=${artifactName}` });

    if (process.env.ASSINAFY_ACCOUNT_ID) {
      urls.push({
        artifactName,
        url: `${baseUrl}/accounts/${process.env.ASSINAFY_ACCOUNT_ID}/documents/${documentId}/download/${artifactName}`,
      });
    }
  }

  let lastError = "";

  for (const { artifactName, url } of urls) {
    const response = await fetch(url, { headers: getAssinafyHeaders() });

    if (response.ok) {
      return {
        pdfBuffer: Buffer.from(await response.arrayBuffer()),
        artifactName,
      };
    }

    lastError = `${url}: ${response.status}`;
  }

  throw new Error(`Não foi possível baixar o PDF final assinado/certificado da Assinafy. Último retorno: ${lastError}`);
}

export async function waitAndDownloadFinalPdf(documentId, options = {}) {
  const { attempts = 10, intervalMs = 3000 } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const documentData = await getDocumentData(documentId);

    try {
      return await downloadFinalPdf(documentId, documentData);
    } catch (error) {
      lastError = error;
      const status = getDocumentStatus(documentData);

      // Logo após o último clique do signatário, a Assinafy pode levar alguns segundos
      // para gerar o PDF assinado/certificado. Aguardamos em vez de cair no original.
      console.warn(`[SINDPOL] PDF final ainda não disponível (${attempt}/${attempts}). Status: ${status || "sem status"}.`);
      if (attempt < attempts) await sleep(intervalMs);
    }
  }

  throw lastError || new Error("PDF final assinado/certificado ainda não ficou disponível na Assinafy.");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
