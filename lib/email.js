import nodemailer from "nodemailer";

export function getFinalRecipients({ metadata = {} } = {}) {
  // Destinatários oficiais do documento concluído.
  // Regra do projeto: quando todos os signatários finalizarem, apenas 2 e-mails recebem
  // o PDF final assinado + documento/certificado de autenticidade da Assinafy.
  const configuredRecipients = [
    ...(Array.isArray(metadata.finalRecipients) ? metadata.finalRecipients : []),
    process.env.FINAL_DOCUMENT_EMAIL_1,
    process.env.FINAL_DOCUMENT_EMAIL_2,
  ];

  return [...new Set(
    configuredRecipients
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(isValidEmail)
  )].slice(0, 2);
}

export async function sendFinalDocumentEmail({ to, recipientName, filename, pdfBuffer, artifactName }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = String(process.env.SMTP_SECURE || "true") === "true";
  const emailFrom = process.env.EMAIL_FROM || smtpUser;

  if (!smtpUser || !smtpPass || !emailFrom) {
    throw new Error("Configure SMTP_USER, SMTP_PASS e EMAIL_FROM para enviar o e-mail final.");
  }

  const validRecipients = [...new Set(
    (Array.isArray(to) ? to : [to])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(isValidEmail)
  )];

  if (!validRecipients.length) {
    throw new Error("Nenhum destinatário válido para envio do documento final.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: emailFrom,
    to: validRecipients.join(","),
    subject: "Documento assinado e concluído",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2>Documento assinado concluído</h2>
        <p>Olá.</p>
        <p>O documento de ${escapeHtml(recipientName || "proponente")} foi assinado e concluído.</p>
        <p>O arquivo final está anexado neste e-mail.</p>
        <hr />
        <small>Arquivo final enviado pela integração com a Assinafy. Artefato: ${escapeHtml(artifactName || "final")}.</small>
      </div>
    `,
    attachments: [
      {
        filename: filename || "documento-assinado.pdf",
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}


export async function sendNewProponenteEmail({ nome, cpf, nascimento }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = String(process.env.SMTP_SECURE || "true") === "true";
  const emailFrom = process.env.EMAIL_FROM || smtpUser;
  const destinationEmail = String(process.env.FINAL_DOCUMENT_EMAIL_1 || "").trim().toLowerCase();

  if (!smtpUser || !smtpPass || !emailFrom) {
    throw new Error("Configure SMTP_USER, SMTP_PASS e EMAIL_FROM para enviar o e-mail de novo proponente.");
  }

  if (!isValidEmail(destinationEmail)) {
    throw new Error("Configure FINAL_DOCUMENT_EMAIL_1 com um e-mail válido para receber o aviso de novo cadastro.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: emailFrom,
    to: destinationEmail,
    subject: "Novo proponente cadastrado",
    text: buildNewProponenteMessage({ nome, cpf, nascimento }),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2>Novo proponente cadastrado!!!</h2>
        <p><strong>Nome:</strong> ${escapeHtml(nome || "Não informado")}</p>
        <p><strong>CPF:</strong> ${escapeHtml(cpf || "Não informado")}</p>
        <p><strong>Data de nascimento:</strong> ${escapeHtml(nascimento || "Não informada")}</p>
        <hr />
        <small>Mensagem automática enviada pelo formulário SINDPOL.</small>
      </div>
    `,
  });

  return {
    sent: true,
    to: destinationEmail,
  };
}

function buildNewProponenteMessage({ nome, cpf, nascimento }) {
  return [
    "Novo proponente cadastrado!!!",
    "",
    `Nome: ${nome || "Não informado"}`,
    `CPF: ${cpf || "Não informado"}`,
    `Data de nascimento: ${nascimento || "Não informada"}`,
  ].join("\n");
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


export async function sendSignerInvitationEmail({ to, signerName, documentName, signUrl }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = String(process.env.SMTP_SECURE || "true") === "true";
  const emailFrom = process.env.EMAIL_FROM || smtpUser;

  if (!smtpUser || !smtpPass || !emailFrom) {
    throw new Error("Configure SMTP_USER, SMTP_PASS e EMAIL_FROM para enviar o convite ao signatário.");
  }

  if (!isValidEmail(to)) {
    throw new Error("E-mail do signatário inválido para envio do convite.");
  }

  if (!signUrl) {
    throw new Error("A Assinafy criou a atribuição, mas não retornou link de assinatura para enviar ao signatário.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: emailFrom,
    to,
    subject: "Documento aguardando sua assinatura",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2>Documento aguardando sua assinatura</h2>
        <p>Olá, ${escapeHtml(signerName || "signatário")}.</p>
        <p>O documento <strong>${escapeHtml(documentName || "SINDPOL")}</strong> foi gerado e está aguardando sua assinatura.</p>
        <p>
          <a href="${escapeHtml(signUrl)}" target="_blank" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;">
            Assinar documento
          </a>
        </p>
        <p>Se o botão não abrir, copie e cole este link no navegador:</p>
        <p style="word-break: break-all;">${escapeHtml(signUrl)}</p>
      </div>
    `,
  });
}
