export function normalizeCpf(value: string): string | null {
  const cpf = value.replace(/\D/g, "");
  return cpf.length === 11 ? cpf : null;
}

export function normalizeBrazilianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return phone.length >= 12 && phone.length <= 13 ? phone : null;
}

export function normalizeRg(value: string): string | null {
  const rg = value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return rg.length >= 5 && rg.length <= 20 ? rg : null;
}
