/**
 * Normaliza un celular a formato E.164. Asume Colombia (+57) cuando no trae
 * indicativo: "300 123 4567" → "+573001234567". Devuelve null si no es válido.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  if (digits.length === 12 && digits.startsWith('573')) return `+${digits}`;
  return null;
}
