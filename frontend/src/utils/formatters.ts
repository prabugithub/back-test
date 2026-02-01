// No imports needed

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  const time = date.toTimeString().split(' ')[0];
  return `${d}-${m}-${y} ${time}`;
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
