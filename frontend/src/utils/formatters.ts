import { format } from 'date-fns';

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  return format(new Date(timestamp * 1000), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Format time only
 */
export function formatTime(timestamp: number): string {
  return format(new Date(timestamp * 1000), 'HH:mm:ss');
}

/**
 * Format date only
 */
export function formatDate(timestamp: number): string {
  return format(new Date(timestamp * 1000), 'yyyy-MM-dd');
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
