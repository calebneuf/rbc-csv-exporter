// CSV Export functionality for RBC CSV Exporter

/**
 * Convert transactions array to CSV string
 */
function convertToCSV(transactions) {
  if (transactions.length === 0) return '';

  // Define column order to match standard bank exports
  const orderedHeaders = ['date', 'accountType', 'description', 'vendor', 'amount', 'balance', 'reference'];

  // Filter to only include headers that have data
  const headers = orderedHeaders.filter(header =>
    transactions.some(t => t[header] && t[header] !== '')
  );

  // Create CSV header with proper capitalization
  const csvHeaders = headers.map(h => {
    switch(h) {
      case 'date': return 'Date';
      case 'accountType': return 'Account Type';
      case 'description': return 'Description';
      case 'vendor': return 'Vendor/Payee';
      case 'amount': return 'Amount';
      case 'balance': return 'Balance';
      case 'reference': return 'Reference';
      default: return h.charAt(0).toUpperCase() + h.slice(1);
    }
  }).join(',');

  // Create CSV rows
  const csvRows = transactions.map(transaction => {
    return headers.map(header => {
      let value = String(transaction[header] || '');
      
      // For amount and balance fields, remove commas instead of quoting
      if (header === 'amount' || header === 'balance') {
        value = value.replace(/,/g, '');
        return value;
      }
      
      // Always wrap date field in quotes since it may contain commas (e.g., "Oct 21, 2025")
      if (header === 'date') {
        return `"${value.replace(/"/g, '""')}"`;
      }
      
      // Quote other fields only if they contain comma, quotes, or newlines
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      
      return value;
    }).join(',');
  });

  return [csvHeaders, ...csvRows].join('\n');
}

/**
 * Download transactions as CSV file
 */
function downloadCSV(transactions, source = 'web') {
  const csv = convertToCSV(transactions);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const sourceLabel = source === 'pdf' ? 'pdf' : 'web';
    link.setAttribute('download', `rbc_transactions_${sourceLabel}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
