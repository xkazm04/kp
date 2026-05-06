export function formatCzk(value: number) {
  return new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 0
  }).format(value);
}

export function labelize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
