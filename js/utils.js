// Utility functions for RBC CSV Exporter

/**
 * Normalize date string to DD/MM/YYYY format
 * Handles various date formats including month names
 */
function normalizeDate(dateStr) {
  const trimmedDate = dateStr.trim();
  
  // Month name mapping
  const monthNames = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12'
  };

  // Pattern 1: "Oct 21, 2025" or "October 21, 2025"
  const monthNamePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i;
  let match = trimmedDate.match(monthNamePattern);
  if (match) {
    const [, monthName, day, year] = match;
    const month = monthNames[monthName.toLowerCase()];
    return `${day.padStart(2, '0')}/${month}/${year}`;
  }

  // Pattern 2: MM/DD/YYYY or M/D/YYYY
  const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  match = trimmedDate.match(mmddyyyyPattern);
  if (match) {
    const [, month, day, year] = match;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  // Pattern 3: MM-DD-YYYY or M-D-YYYY
  const mmddyyyyDashPattern = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
  match = trimmedDate.match(mmddyyyyDashPattern);
  if (match) {
    const [, month, day, year] = match;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  // Pattern 4: YYYY-MM-DD
  const yyyymmddPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  match = trimmedDate.match(yyyymmddPattern);
  if (match) {
    const [, year, month, day] = match;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  // If no pattern matches, return as-is
  return trimmedDate;
}

/**
 * Normalize amount string to consistent format
 */
function normalizeAmount(amountStr) {
  const cleanAmount = amountStr.replace(/[,$]/g, '');
  const num = parseFloat(cleanAmount);

  if (isNaN(num)) return amountStr;

  // Return as negative for withdrawals, positive for deposits
  return amountStr.startsWith('-') || amountStr.includes('(') ?
    num.toFixed(2) : num.toFixed(2);
}

/**
 * Check if text matches a date pattern
 */
function isDate(text) {
  const datePatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // MM/DD/YYYY
    /^\d{1,2}-\d{1,2}-\d{2,4}$/, // MM-DD-YYYY
    /^\d{4}-\d{1,2}-\d{1,2}$/, // YYYY-MM-DD
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i, // Month name formats
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{4}$/i // Month name formats without comma
  ];
  return datePatterns.some(pattern => pattern.test(text.trim()));
}

/**
 * Check if text matches an amount pattern
 */
function isAmount(text) {
  if (!text) return false;
  
  const cleanText = text.trim();
  const amountPatterns = [
    /^\$?-?[\d,]+\.\d{2}$/,           // $123.45, -$123.45
    /^-?\$[\d,]+\.\d{2}$/,           // -$123.45
    /^[\d,]+\.\d{2}$/,               // 123.45
    /^\$[\d,]+\.\d{2}$/,             // $123.45
    /^-[\d,]+\.\d{2}$/,              // -123.45
    /^\([\d,]+\.\d{2}\)$/,           // (123.45) - negative in parentheses
    /^\$\([\d,]+\.\d{2}\)$/          // $(123.45) - negative with $ and parentheses
  ];
  
  return amountPatterns.some(pattern => pattern.test(cleanText));
}

/**
 * Validate if a transaction object is valid
 */
function isValidTransaction(transaction) {
  if (!transaction) {
    return false;
  }

  // A transaction is valid if it has at least a description or an amount
  const hasDescription = transaction.description && transaction.description.trim().length > 2;
  const hasAmount = transaction.amount && transaction.amount.trim().length > 0;
  const hasDate = transaction.date && transaction.date.trim().length > 0;

  // Log for debugging (only log if all three are present for cleaner output)
  if (hasDate && hasDescription && hasAmount) {
    console.log('Valid transaction found:', {
      date: transaction.date,
      description: transaction.description?.substring(0, 30),
      amount: transaction.amount
    });
  }

  // Must have either description or amount, preferably both
  return hasDescription || hasAmount;
}

/**
 * Sleep utility function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract description from text by removing dates and amounts
 */
function extractDescription(text) {
  let description = text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '') // MM/DD/YYYY format
    .replace(/\b\d{1,2}-\d{1,2}-\d{2,4}\b/g, '') // MM-DD-YYYY format
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '') // YYYY-MM-DD format
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, '') // Month name formats
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{4}\b/gi, '') // Month name formats without comma
    .replace(/\$[\d,]+\.\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return description.substring(0, 100); // Limit length
}

/**
 * Check if a line looks like a transaction
 */
function looksLikeTransaction(line) {
  return isDate(line) ||
         (line.includes('$') && line.length > 10) ||
         /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b.*\$[\d,]+\.\d{2}/.test(line) ||
         /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b.*\$[\d,]+\.\d{2}/gi.test(line);
}
