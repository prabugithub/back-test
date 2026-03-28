// No imports needed

/**
 * Format timestamp to readable date/time
 * Uses UTC methods to avoid double-conversion when data is already offset to IST
 */
export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'N/A';
  
  // Handle both seconds (Unix) and milliseconds
  // 1e11 is a cutoff: everything above is likely milliseconds
  const tsMs = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const date = new Date(tsMs);
  
  const d = date.getUTCDate().toString().padStart(2, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const y = date.getUTCFullYear();
  
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  
  return `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
}

/**
 * Format time only (UTC)
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toISOString().substring(11, 19);
}

/**
 * Format date only (UTC)
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toISOString().substring(0, 10);
}

/**
 * Format currency (INR)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format percentage
 */
export function formatPercentage(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Format large numbers
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}
