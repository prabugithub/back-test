// No imports needed

/**
 * Format timestamp to readable date/time
 * Uses local methods to show time in user's timezone (e.g. IST)
 */
export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'N/A';
  
  // Handle both seconds (Unix) and milliseconds
  // 1e11 is a cutoff: everything above is likely milliseconds
  const tsMs = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const date = new Date(tsMs);
  
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  const ss = date.getSeconds().toString().padStart(2, '0');
  
  return `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
}

/**
 * Format timestamp as DD/MM/YYYY (local time, slash-separated).
 * Used for the `formattedDate` field added to trades on JSON export.
 */
export function formatDDMMYYYY(timestamp: number): string {
  if (!timestamp) return 'N/A';

  // Handle both seconds (Unix) and milliseconds — same 1e11 cutoff as formatTimestamp
  const tsMs = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const date = new Date(tsMs);

  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();

  return `${d}/${m}/${y}`;
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
