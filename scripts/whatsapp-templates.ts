/**
 * Crea en Meta las plantillas de WhatsApp que usan los avisos de citas.
 *
 *   npm run whatsapp:templates
 *
 * Requiere en backend/.env: WHATSAPP_TOKEN y WHATSAPP_BUSINESS_ACCOUNT_ID.
 * Es seguro ejecutarlo varias veces: omite las plantillas que ya existen.
 * Meta las revisa (normalmente en minutos); el estado se ve en
 * WhatsApp Manager → Plantillas de mensajes.
 */
import 'dotenv/config';
import { WHATSAPP_TEMPLATES } from '../src/whatsapp/whatsapp.templates';

const token = process.env.WHATSAPP_TOKEN;
const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const version = process.env.WHATSAPP_API_VERSION ?? 'v25.0';
const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'es';

interface GraphError {
  error?: { message?: string; error_user_msg?: string };
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const data = (await res.json()) as T & GraphError;
  if (!res.ok) {
    throw new Error(
      data.error?.error_user_msg ?? data.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return data;
}

async function main() {
  if (!token || !accountId) {
    console.error(
      'Faltan WHATSAPP_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID en backend/.env',
    );
    process.exit(1);
  }

  const existing = await graph<{
    data: { name: string; language: string; status: string }[];
  }>(`${accountId}/message_templates?fields=name,language,status&limit=200`);

  for (const template of Object.values(WHATSAPP_TEMPLATES)) {
    const found = existing.data.find(
      (t) => t.name === template.name && t.language === language,
    );
    if (found) {
      console.log(`• ${template.name}: ya existe (${found.status})`);
      continue;
    }
    try {
      const created = await graph<{ id: string; status: string }>(
        `${accountId}/message_templates`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: template.name,
            language,
            category: 'UTILITY',
            components: [
              {
                type: 'BODY',
                text: template.body,
                example: { body_text: [template.example] },
              },
            ],
          }),
        },
      );
      console.log(`✔ ${template.name}: creada (${created.status})`);
    } catch (error) {
      console.error(`✖ ${template.name}: ${(error as Error).message}`);
    }
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
