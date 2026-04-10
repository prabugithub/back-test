"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkDateRange = chunkDateRange;
exports.formatTimestamp = formatTimestamp;
const date_fns_1 = require("date-fns");
/**
 * Split a date range into chunks of maximum 90 days (Dhan API limit)
 */
function chunkDateRange(fromDate, toDate) {
    const chunks = [];
    const start = (0, date_fns_1.parseISO)(fromDate);
    const end = (0, date_fns_1.parseISO)(toDate);
    const totalDays = (0, date_fns_1.differenceInDays)(end, start);
    if (totalDays <= 90) {
        return [{ from: fromDate, to: toDate }];
    }
    let currentStart = start;
    while (currentStart < end) {
        const currentEnd = (0, date_fns_1.addDays)(currentStart, 89); // 90 days inclusive
        const chunkEnd = currentEnd > end ? end : currentEnd;
        chunks.push({
            from: (0, date_fns_1.format)(currentStart, 'yyyy-MM-dd'),
            to: (0, date_fns_1.format)(chunkEnd, 'yyyy-MM-dd'),
        });
        currentStart = (0, date_fns_1.addDays)(chunkEnd, 1);
    }
    return chunks;
}
/**
 * Format timestamp to ISO date string
 */
function formatTimestamp(timestamp) {
    return (0, date_fns_1.format)(new Date(timestamp * 1000), 'yyyy-MM-dd HH:mm:ss');
}
