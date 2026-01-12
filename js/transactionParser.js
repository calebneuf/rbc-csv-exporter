// Transaction parsing logic for RBC CSV Exporter

/**
 * Parse a single RBC transaction row from DOM
 */
function parseRBCTransactionRow(row) {
  const transaction = {
    date: '',
    description: '',
    vendor: '',
    amount: '',
    type: '',
    balance: '',
    reference: '',
    accountType: '' // debit or credit
  };

  // Determine if this is a debit or credit transaction based on headers attribute
  const firstCell = row.querySelector('td');
  const headersAttr = firstCell ? firstCell.getAttribute('headers') : '';
  const isCredit = headersAttr && headersAttr.includes('cc-date');
  const isDebit = headersAttr && headersAttr.includes('pda-date');
  
  transaction.accountType = isCredit ? 'credit' : isDebit ? 'debit' : 'unknown';

  // Look for date in the date-column-padding td element
  const dateElement = row.querySelector('td.date-column-padding, td[headers*="pda-date"], td[headers*="cc-date"], td[class*="date"]');
  if (dateElement) {
    transaction.date = normalizeDate(dateElement.textContent.trim());
  }

  // If no date found, try extracting from row's id or headers attribute
  if (!transaction.date) {
    const rowId = row.getAttribute('id') || '';
    const dateMatch = rowId.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      transaction.date = normalizeDate(dateMatch[1]);
    }
  }

  // If still no date, look in row text
  if (!transaction.date) {
    const rowText = row.textContent;
    const datePatterns = [
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{4}\b/i,
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
      /\b\d{1,2}-\d{1,2}-\d{4}\b/
    ];

    for (const pattern of datePatterns) {
      const match = rowText.match(pattern);
      if (match) {
        transaction.date = normalizeDate(match[0]);
        break;
      }
    }
  }

  // Look for description - can be in either th or td with rbc-transaction-list-desc class
  let descElement = row.querySelector('th.rbc-transaction-list-desc, td.rbc-transaction-list-desc, td.description-column-padding');
  if (descElement) {
    const descDivs = descElement.querySelectorAll('div');
    const descriptions = [];
    descDivs.forEach(div => {
      const text = div.textContent.trim();
      if (text) {
        descriptions.push(text);
      }
    });
    
    // Different parsing for credit vs debit transactions
    if (transaction.accountType === 'credit') {
      // Credit transactions: Usually just vendor name in one div
      if (descriptions.length >= 1) {
        const text = descriptions[0];
        transaction.vendor = text;
        
        // Determine transaction type based on the text
        if (text.toLowerCase().includes('payment')) {
          transaction.description = 'Payment';
        } else if (text.toLowerCase().includes('refund')) {
          transaction.description = 'Refund';
        } else {
          transaction.description = 'Purchase';
        }
      }
    } else {
      // Debit transactions: First div is transaction type/description, second div is vendor/payee
      if (descriptions.length >= 2) {
        transaction.description = descriptions[0];
        transaction.vendor = descriptions[1];
      } else if (descriptions.length === 1) {
        // If only one description, try to parse it
        const parsed = parseDescriptionAndVendor(descriptions[0]);
        transaction.description = parsed.description;
        transaction.vendor = parsed.vendor;
      }
    }
  } else {
    // Fallback: look for the longest text content in cells (excluding date and amount)
    const allCells = row.querySelectorAll('td, th');
    let longestText = '';
    
    for (const cell of allCells) {
      const text = cell.textContent.trim();
      // Skip if it's a date, amount, or very short
      if (text.length > longestText.length && 
          !isAmount(text) && 
          !isDate(text) &&
          text.length > 5) {
        longestText = text;
      }
    }
    
    if (longestText) {
      const parsed = parseDescriptionAndVendor(longestText);
      transaction.description = parsed.description;
      transaction.vendor = parsed.vendor;
    }
  }

  // Extract transaction type from description
  if (transaction.description) {
    const desc = transaction.description.toLowerCase();
    if (desc.includes('interac')) {
      transaction.type = 'Interac';
    } else if (desc.includes('contactless')) {
      transaction.type = 'Contactless';
    } else if (desc.includes('deposit')) {
      transaction.type = 'Deposit';
    } else if (desc.includes('withdrawal')) {
      transaction.type = 'Withdrawal';
    } else if (desc.includes('transfer')) {
      transaction.type = 'Transfer';
    } else if (desc.includes('payment')) {
      transaction.type = 'Payment';
    }
  }

  // Look for amount - different columns for debit vs credit
  if (transaction.accountType === 'credit') {
    // Credit transactions: purchases in withdraw column, payments/refunds in deposit column
    const withdrawElement = row.querySelector('td.rbc-transaction-list-withdraw span');
    const depositElement = row.querySelector('td.rbc-transaction-list-deposit span');
    
    if (withdrawElement && withdrawElement.textContent.trim()) {
      // Purchases/charges in withdraw column (shown as positive, are debits)
      const amountText = withdrawElement.textContent.trim();
      transaction.amount = amountText.startsWith('$') ? '-' + amountText : '-$' + amountText;
    } else if (depositElement && depositElement.textContent.trim()) {
      // Payments/refunds in deposit column - ensure they're always positive
      const amountText = depositElement.textContent.trim();
      // Remove negative sign if present (handles both -$777.57 and -777.57 formats)
      let cleanAmount = amountText.replace(/^-\$?/, '');
      // Ensure dollar sign is present
      if (!cleanAmount.startsWith('$')) {
        cleanAmount = '$' + cleanAmount;
      }
      transaction.amount = cleanAmount;
    }
  } else {
    // Debit transactions: look in withdraw/deposit columns
    const withdrawElement = row.querySelector('td.rbc-transaction-list-withdraw span, td[class*="withdraw"] span');
    if (withdrawElement) {
      transaction.amount = withdrawElement.textContent.trim();
    }

    // Look for amount in deposit column if not found in withdrawal
    if (!transaction.amount) {
      const depositElement = row.querySelector('td.rbc-transaction-list-deposit span, td[class*="deposit"] span');
      if (depositElement) {
        transaction.amount = depositElement.textContent.trim();
      }
    }
  }

  // If still no amount, look for any amount-like text in the row
  if (!transaction.amount) {
    const allCells = row.querySelectorAll('td, th');
    for (const cell of allCells) {
      const text = cell.textContent.trim();
      if (isAmount(text)) {
        transaction.amount = text;
        break;
      }
    }
  }

  // Look for balance in the specific balance column
  const balanceElement = row.querySelector('td.rbc-transaction-list-balance span, td[class*="balance"] span');
  if (balanceElement && balanceElement.textContent.trim()) {
    transaction.balance = balanceElement.textContent.trim();
  }

  // If no balance found, look for the last amount in the row (excluding the main amount)
  if (!transaction.balance) {
    const allCells = row.querySelectorAll('td, th');
    const amounts = [];
    for (const cell of allCells) {
      const text = cell.textContent.trim();
      if (isAmount(text) && text !== transaction.amount) {
        amounts.push(text);
      }
    }
    
    if (amounts.length > 0) {
      transaction.balance = amounts[amounts.length - 1];
    }
  }

  return transaction;
}

/**
 * Parse description and vendor from text
 */
function parseDescriptionAndVendor(text) {
  // Try to separate description from vendor/payee
  // Common patterns:
  // "Contactless Interac purchase - 5619 - VENDOR NAME"
  // "Interac e-Transfer From PERSON NAME"
  // "Bill Payment - PAYEE NAME"
  
  const result = {
    description: text,
    vendor: ''
  };

  // Pattern 1: Look for " - " separator (common in RBC format)
  if (text.includes(' - ')) {
    const parts = text.split(' - ');
    if (parts.length >= 2) {
      result.description = parts[0].trim();
      // Last part is usually the vendor
      result.vendor = parts[parts.length - 1].trim();
    }
  }
  // Pattern 2: "From" or "To" pattern (e-Transfers)
  else if (text.toLowerCase().includes(' from ')) {
    const parts = text.split(/\s+from\s+/i);
    result.description = parts[0].trim();
    if (parts.length > 1) {
      result.vendor = parts[1].trim();
    }
  }
  else if (text.toLowerCase().includes(' to ')) {
    const parts = text.split(/\s+to\s+/i);
    result.description = parts[0].trim();
    if (parts.length > 1) {
      result.vendor = parts[1].trim();
    }
  }
  
  return result;
}

/**
 * Parse a transaction line from text (for fallback extraction)
 */
function parseTransactionLine(line) {
  // Try to match different date formats used by RBC
  const datePatterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // MM/DD/YYYY
    /\b\d{1,2}-\d{1,2}-\d{2,4}\b/, // MM-DD-YYYY
    /\b\d{4}-\d{2}-\d{2}\b/, // YYYY-MM-DD
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{4}\b/gi
  ];

  let dateMatch = null;
  for (const pattern of datePatterns) {
    const match = line.match(pattern);
    if (match) {
      dateMatch = match;
      break;
    }
  }

  const amountMatches = line.match(/\$[\d,]+\.\d{2}/g);

  if (dateMatch && amountMatches) {
    return {
      date: normalizeDate(dateMatch[0]),
      description: extractDescription(line),
      amount: amountMatches[0],
      balance: amountMatches.length > 1 ? amountMatches[amountMatches.length - 1] : ''
    };
  }

  return null;
}

/**
 * Create transaction from table cells
 */
function createTransactionFromCells(cells, headers = []) {
  const cellTexts = Array.from(cells).map(cell => cell.textContent.trim());
  
  // Try to map cells to transaction fields
  const transaction = {
    date: '',
    description: '',
    amount: '',
    balance: '',
    type: '',
    reference: ''
  };

  for (let i = 0; i < cellTexts.length; i++) {
    const text = cellTexts[i];
    const header = headers[i] || '';

    if (isDate(text)) {
      transaction.date = normalizeDate(text);
    } else if (isAmount(text)) {
      if (!transaction.amount) {
        transaction.amount = text;
      } else if (!transaction.balance) {
        transaction.balance = text;
      }
    } else if (text.length > 3 && !transaction.description) {
      transaction.description = text;
    } else if (header.includes('type') || header.includes('category')) {
      transaction.type = text;
    } else if (header.includes('ref') || header.includes('number')) {
      transaction.reference = text;
    }
  }

  return transaction;
}
