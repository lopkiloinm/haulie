/** Parse decimal user input without floating-point rounding or scientific notation. */
export function parseCoinAmount(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw new Error("Enter a positive decimal amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n || units > 18446744073709551615n)
    throw new Error("Amount is outside the supported range.");
  return units;
}
export function formatCoinAmount(value: string, decimals: number) {
  const units = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const fraction = (units % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${units / base}${fraction ? `.${fraction}` : ""}`;
}
