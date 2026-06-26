# SINDPOL + Assinafy — Fluxo com 2 signatários

## Fluxo implementado

1. O proponente preenche o formulário e clica em **Enviar formulário**.
2. O front gera o PDF usando `docs/ficha-sindpol.pdf` como modelo.
3. Os dados preenchidos são inseridos no PDF nas posições mapeadas em `js/script.js`.
4. O PDF preenchido é enviado para a Assinafy pela rota `/api/assinafy-upload`.
5. O front chama `/api/start-assignment` em retry até o documento chegar no status `metadata_ready`.
6. O backend cria/localiza 2 signatários na Assinafy:
   - **PROPONENTE**, usando o nome e o e-mail preenchidos no formulário;
   - **SINDICATO**, usando `ASSINAFY_SIGNER_NAME` e `ASSINAFY_SIGNER_EMAIL`.
7. A assinatura `collect` cria automaticamente 2 campos no PDF:
   - campo do **PROPONENTE** acima de `ASSINATURA DO(A) PROPONENTE`;
   - campo do **SINDICATO** acima de `ASSINATURA DO SINDICATO`.
8. O proponente recebe o convite no e-mail informado no formulário.
9. O sindicato recebe o convite no e-mail configurado na Vercel.
10. Após criar o documento, o backend dispara uma notificação de novo cadastro para o e-mail configurado em `FINAL_DOCUMENT_EMAIL_1`, contendo nome, CPF e data de nascimento do proponente.
11. Quando os 2 signatários assinarem, o webhook baixa o arquivo final assinado/certificado da Assinafy e envia para os 2 e-mails configurados em `FINAL_DOCUMENT_EMAIL_1` e `FINAL_DOCUMENT_EMAIL_2`.

## Alterações principais desta versão

- Removida a assinatura digital manual do formulário.
- Removidos canvas, botão de limpar assinatura, validação obrigatória de assinatura manual e gravação de imagem da assinatura no PDF.
- Mantido apenas o fluxo oficial da Assinafy para assinatura e autenticação.
- Implementado fluxo com 2 signatários obrigatórios: PROPONENTE e SINDICATO.
- Ajustado envio final para somente 2 destinatários configurados.
- Mantido download apenas de artefatos finais/certificados da Assinafy, evitando baixar o PDF original sem assinatura.
- Removidos os campos, coleta e cópia de dados de `estado civil`.
- Removida a integração de WhatsApp.
- Implementada notificação de novo proponente por e-mail para `FINAL_DOCUMENT_EMAIL_1`, mantendo esse mesmo e-mail também como destinatário do documento final.
- Redimensionamento automático do texto salvo no PDF para manter os dados dentro dos espaços em branco.
- PDF modelo `docs/ficha-sindpol.pdf` otimizado para reduzir o peso do envio e evitar erro de payload/timeout na Vercel e na Assinafy.
- Validado com `node --check` em `js/script.js`, rotas `api/` e bibliotecas `lib/`.

## Variáveis obrigatórias na Vercel

```env
ASSINAFY_API_KEY=sua_chave_assinafy
ASSINAFY_ACCOUNT_ID=id_do_workspace
ASSINAFY_BASE_URL=https://api.assinafy.com.br/v1

ASSINAFY_SIGNER_NAME=Nome do Representante do Sindicato
ASSINAFY_SIGNER_EMAIL=email_do_sindicato@dominio.com
ASSINAFY_SIGNATURE_METHOD=collect

FINAL_DOCUMENT_EMAIL_1=email_destino_1@dominio.com
FINAL_DOCUMENT_EMAIL_2=email_destino_2@dominio.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=senha_de_app_google
EMAIL_FROM=SINDPOL <seuemail@gmail.com>
```

## Variáveis opcionais

```env
# Use somente se a busca automática do campo de assinatura não funcionar na sua conta.
ASSINAFY_SIGNATURE_FIELD_ID=id_do_campo_signature

# Use somente se quiser sobrescrever manualmente a posição do campo do PROPONENTE.
ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON={"left":103,"top":1806,"width":351,"height":90,"fontSize":18,"fontFamily":"Arial","backgroundColor":"rgb(195, 230, 203)"}

# Use somente se quiser sobrescrever manualmente a posição do campo do SINDICATO.
ASSINAFY_SIGNATURE_FIELD_JSON={"left":819,"top":1806,"width":351,"height":90,"fontSize":18,"fontFamily":"Arial","backgroundColor":"rgb(195, 230, 203)"}
```

## Webhook na Assinafy

Configure a URL abaixo no painel da Assinafy:

```txt
https://SEU-DOMINIO.vercel.app/api/assinafy-webhook
```

## Rotas úteis

```txt
/api/test-email?email=seuemail@gmail.com
/api/debug-document?documentId=ID_DO_DOCUMENTO
/api/start-assignment?documentId=ID_DO_DOCUMENTO
/api/send-final-document?documentId=ID_DO_DOCUMENTO
```

## Deploy na Vercel

A raiz do projeto deve conter:

```txt
package.json
index.html
api/
css/
js/
lib/
docs/
img/
```

Na Vercel, deixe o **Root Directory** vazio ou como `./`.
