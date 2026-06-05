const DEFAULT_DESTINATION = "5591984536649";

function onlyNumbers(value) {
  return String(value || "").replace(/\D/g, "");
}

function getDestinationPhone() {
  return onlyNumbers(process.env.WHATSAPP_TO || process.env.WHATSAPP_ADMIN_PHONE || DEFAULT_DESTINATION);
}

function buildNewProponenteMessage({ nome, cpf, nascimento }) {
  return [
    "Novo proponente cadastrado!!!",
    `Nome: ${nome || "Não informado"}`,
    `CPF: ${cpf || "Não informado"}`,
    `Data de nascimento: ${nascimento || "Não informada"}`,
  ].join("\n");
}

export async function sendNewProponenteWhatsApp({ nome, cpf, nascimento }) {
  const to = getDestinationPhone();
  const message = buildNewProponenteMessage({ nome, cpf, nascimento });

  if (!to) {
    return { sent: false, skipped: true, reason: "Telefone de destino do WhatsApp não configurado." };
  }

  const provider = String(process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase();

  if (provider === "meta" || process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return sendViaMetaCloud({ to, message });
  }

  if (provider === "zapi" || process.env.ZAPI_INSTANCE_ID) {
    return sendViaZApi({ to, message });
  }

  if (provider === "evolution" || process.env.EVOLUTION_API_URL) {
    return sendViaEvolution({ to, message });
  }

  if (provider === "custom" || process.env.WHATSAPP_API_URL) {
    return sendViaCustomEndpoint({ to, message });
  }

  console.warn("[SINDPOL] WhatsApp não enviado: configure WHATSAPP_PROVIDER e as credenciais do provedor.");
  return {
    sent: false,
    skipped: true,
    to,
    message,
    reason: "WhatsApp não configurado. Configure Meta Cloud, Z-API, Evolution API ou WHATSAPP_API_URL na Vercel.",
  };
}

async function sendViaMetaCloud({ to, message }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return { sent: false, skipped: true, reason: "Configure WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN." };
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: message },
    }),
  });

  return parseProviderResponse(response, "Meta WhatsApp Cloud API");
}

async function sendViaZApi({ to, message }) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;

  if (!instanceId || !token) {
    return { sent: false, skipped: true, reason: "Configure ZAPI_INSTANCE_ID e ZAPI_TOKEN." };
  }

  const headers = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: to, message }),
  });

  return parseProviderResponse(response, "Z-API");
}

async function sendViaEvolution({ to, message }) {
  const baseUrl = String(process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
  const instance = process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_ID;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl || !instance || !apiKey) {
    return { sent: false, skipped: true, reason: "Configure EVOLUTION_API_URL, EVOLUTION_INSTANCE_NAME e EVOLUTION_API_KEY." };
  }

  const response = await fetch(`${baseUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number: to, text: message }),
  });

  return parseProviderResponse(response, "Evolution API");
}

async function sendViaCustomEndpoint({ to, message }) {
  const url = process.env.WHATSAPP_API_URL;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!url) {
    return { sent: false, skipped: true, reason: "Configure WHATSAPP_API_URL." };
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: to, to, message, text: message }),
  });

  return parseProviderResponse(response, "endpoint customizado de WhatsApp");
}

async function parseProviderResponse(response, providerName) {
  const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `${providerName} retornou erro HTTP ${response.status}.`);
  }

  return { sent: true, provider: providerName, response: data };
}
