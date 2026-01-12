// Core transaction extraction orchestration for RBC CSV Exporter

class RBCTransactionExtractor {
  constructor() {
    this.transactions = [];
    this.isExtracting = false;
    this.observer = null;
    this.pdfProcessor = new PDFProcessor();
    this.uiManager = new UIManager(this);
    this.init();
  }

  init() {
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'extractTransactions') {
        this.extractTransactions().then(sendResponse);
        return true; // Keep message channel open for async response
      } else if (request.action === 'checkRBCPage') {
        sendResponse({ isRBCPage: this.isRBCPage() });
      } else if (request.action === 'countTransactions') {
        this.countTransactionsOnPage().then(sendResponse);
        return true; // Keep message channel open for async response
      } else if (request.action === 'processPDF') {
        this.processPDF(request.pdfUrl, request.filename).then(sendResponse);
        return true; // Keep message channel open for async response
      } else if (request.action === 'detectPDFs') {
        sendResponse({ pdfs: this.detectAvailablePDFs() });
      }
    });

    // Add extraction button to RBC pages
    if (this.isRBCPage()) {
      this.uiManager.addExtractionButton();
    }
  }

  isRBCPage() {
    const hostname = window.location.hostname;
    return hostname.includes('rbcroyalbank.com') || 
           hostname.includes('royalbank.com') || 
           hostname.includes('rbc.com');
  }

  async handlePopupExtract() {
    const extractBtn = document.getElementById('rbc-popup-extract-btn');
    const downloadBtn = document.getElementById('rbc-popup-download-btn');
    
    if (extractBtn) {
      extractBtn.disabled = true;
      extractBtn.innerHTML = '<span>⏳ Extracting...</span>';
    }
    
    this.uiManager.updatePopupStatus('loading', 'Extracting transactions...');
    
    // Add spinner to status
    this.uiManager.addSpinnerToStatus();
    
    try {
      const result = await this.extractTransactionsWithProgress();
      
      // Remove spinner and hide progress bar
      this.uiManager.removeSpinnerFromStatus();
      this.uiManager.hideProgressBar();

      if (result.success && result.transactions.length > 0) {
        this.uiManager.updatePopupStatus('success', `Found ${result.count} transactions!`);

        if (downloadBtn) {
          downloadBtn.style.display = 'flex';
        }

        if (extractBtn) {
          extractBtn.innerHTML = '<span>✅ Extraction Complete</span>';
        }
      } else {
        this.uiManager.updatePopupStatus('error', 'No transactions found');
        if (extractBtn) {
          extractBtn.innerHTML = '<span>❌ No Transactions</span>';
        }
      }
    } catch (error) {
      console.error('Error:', error);
      this.uiManager.removeSpinnerFromStatus();
      this.uiManager.hideProgressBar();
      this.uiManager.updatePopupStatus('error', 'Extraction failed');
      if (extractBtn) {
        extractBtn.innerHTML = '<span>❌ Error</span>';
      }
    }
    
    // Reset button after 3 seconds
    setTimeout(() => {
      if (extractBtn) {
        extractBtn.disabled = false;
        extractBtn.innerHTML = '<span>📊 Extract Transactions</span>';
      }
    }, 3000);
  }

  async extractTransactionsWithProgress() {
    this.isExtracting = true;
    this.transactions = [];

    try {
      // Keep clicking "Show More" buttons with progress updates
      await this.clickAllShowMoreButtonsWithProgress();

      // Wait a bit for final content to load
      await sleep(1000);

      // Find the table that contains the most transaction rows (avoid duplicates)
      const allTables = document.querySelectorAll('table');
      let bestTable = null;
      let maxRows = 0;

      for (const table of allTables) {
        if (table.className.includes('rbc-transaction-list')) {
          const rows = table.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
          console.log(`Checking table "${table.className}" - contains ${rows.length} transaction rows`);

          if (rows.length > maxRows) {
            maxRows = rows.length;
            bestTable = table;
            console.log(`  -> This is the best table so far!`);
          }
        }
      }

      let rbcTransactionRows = [];

      if (bestTable) {
        rbcTransactionRows = bestTable.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        console.log(`🎯 SUCCESS: Found ${rbcTransactionRows.length} RBC transaction rows from best table`);
        this.extractFromRBCTransactionRows(rbcTransactionRows);
      } else {
        // Fallback: try to find transactions without the table constraint
        rbcTransactionRows = document.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');

        if (rbcTransactionRows.length > 0) {
          console.log(`Found ${rbcTransactionRows.length} RBC transaction rows globally as fallback`);
          this.extractFromRBCTransactionRows(rbcTransactionRows);
        } else {
          console.log('No transaction rows found, trying fallback extraction');
          await this.fallbackExtraction();
        }
      }

      // Debug: Log page structure
      console.log('Page structure analysis:');
      console.log('Tables found:', document.querySelectorAll('table').length);
      console.log('Rows found:', document.querySelectorAll('tr').length);
      console.log('Elements with "transaction" in class:', document.querySelectorAll('[class*="transaction"]').length);
      console.log('Elements with dollar signs:', document.querySelectorAll('*').length > 0 ? 
        Array.from(document.querySelectorAll('*')).filter(el => el.textContent.includes('$')).length : 0);

      // Try to get account information and date range
      const accountInfo = this.extractAccountInfo();

      return {
        success: true,
        count: this.transactions.length,
        transactions: this.transactions,
        accountInfo: accountInfo
      };

    } catch (error) {
      console.error('Error extracting transactions:', error);
      return {
        success: false,
        error: error.message,
        count: 0,
        transactions: []
      };
    } finally {
      this.isExtracting = false;
    }
  }

  async clickAllShowMoreButtonsWithProgress() {
    console.log('Looking for "Show More" buttons...');
    let clickCount = 0;
    let maxAttempts = 100; // Safety limit to prevent infinite loops
    let totalExpected = 0;
    let loadTimes = []; // Track how long each load actually takes

    // Check for RBC's total count first
    totalExpected = this.getRBCResultCount();
    if (totalExpected > 0) {
      console.log(`RBC reports ${totalExpected} total transactions`);
      this.uiManager.showTotalCount(totalExpected);
      this.uiManager.showProgressBar(0, totalExpected);
    }

    while (clickCount < maxAttempts) {
      // Look for "Show More" button
      const showMoreButton = this.findShowMoreButton();

      if (!showMoreButton) {
        console.log(`No more "Show More" buttons found. Clicked ${clickCount} time(s).`);
        this.uiManager.updatePopupStatus('loading', 'Processing transactions...');
        break;
      }

      try {
        // Update status to show loading
        this.uiManager.updatePopupStatus('loading', `Loading all transactions... (${clickCount + 1})`);

        console.log(`Clicking "Show More" button (${clickCount + 1})...`);

        // Get current transaction count before clicking
        const beforeCount = this.getCurrentTransactionCount();
        const startTime = Date.now();

        // Click the button
        showMoreButton.click();
        clickCount++;

        // Wait longer for credit cards (up to 15 seconds)
        const maxWaitTime = 15000; // 15 seconds
        let waitTime = 0;
        let afterCount = beforeCount;

        // Check every 500ms if new data loaded
        while (waitTime < maxWaitTime) {
          await sleep(500);
          waitTime += 500;

          afterCount = this.getCurrentTransactionCount();

          if (afterCount > beforeCount) {
            // New data loaded!
            const actualLoadTime = Date.now() - startTime;
            loadTimes.push(actualLoadTime);
            console.log(`✅ New data loaded after ${actualLoadTime}ms (${waitTime}ms total wait)`);

            // Calculate average load time for estimation
            if (loadTimes.length > 0) {
              const avgLoadTime = loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length;
              const remainingClicks = Math.max(0, Math.ceil((totalExpected - afterCount) / (afterCount - beforeCount)));
              const estimatedTimeLeft = remainingClicks * avgLoadTime;
              console.log(`📊 Avg load time: ${Math.round(avgLoadTime)}ms, Est. time left: ${Math.round(estimatedTimeLeft/1000)}s`);
            }
            break;
          }
        }

        // If we timed out without new data, stop
        if (afterCount === beforeCount) {
          console.log(`❌ No new data after ${maxWaitTime}ms - stopping`);
          break;
        }

        // Animate the counter
        this.uiManager.animateCounter(beforeCount, afterCount);

        // Update the popup count as well
        this.uiManager.updatePopupCount();

        // Update progress bar if we have a total
        if (totalExpected > 0) {
          const progress = Math.min((afterCount / totalExpected) * 100, 100);
          this.uiManager.updateProgressBar(progress, totalExpected, afterCount);
        }

        console.log(`Loaded ${afterCount - beforeCount} more transactions (total: ${afterCount})`);

      } catch (error) {
        console.error('Error clicking Show More button:', error);
        break;
      }
    }

    if (clickCount >= maxAttempts) {
      console.log(`Reached maximum attempts (${maxAttempts}), stopping...`);
    }

    console.log(`Finished loading all transactions. Total clicks: ${clickCount}, Average load time: ${loadTimes.length > 0 ? Math.round(loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length) : 'N/A'}ms`);
  }

  async extractTransactions() {
    this.isExtracting = true;
    this.transactions = [];

    try {
      // Check for RBC's result count message
      const resultCount = this.getRBCResultCount();
      if (resultCount > 0) {
        this.uiManager.updatePopupStatus('loading', `Found ${resultCount} transactions - loading...`);
        console.log(`RBC reports ${resultCount} total transactions`);
      }

      // Keep clicking "Show More" buttons until they're all gone
      await this.clickAllShowMoreButtons();

      // Wait a bit for final content to load
      await sleep(1000);

      // Debug: Show all tables and find transaction ones
      const allTables = document.querySelectorAll('table');
      console.log('=== EXTRACTION: TABLES ON PAGE ===');
      allTables.forEach((table, index) => {
        console.log(`Table ${index}:`, table.className, table.classList);
        const rows = table.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        if (rows.length > 0) {
          console.log(`  -> Contains ${rows.length} transaction rows`);
        }
      });

      // Find the table that contains the most transaction rows (avoid duplicates)
      let bestTable = null;
      let maxRows = 0;

      for (const table of allTables) {
        if (table.className.includes('rbc-transaction-list')) {
          const rows = table.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
          console.log(`Checking table "${table.className}" - contains ${rows.length} transaction rows`);

          if (rows.length > maxRows) {
            maxRows = rows.length;
            bestTable = table;
            console.log(`  -> This is the best table so far!`);
          }
        }
      }

      let rbcTransactionRows = [];

      if (bestTable) {
        rbcTransactionRows = bestTable.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        console.log(`🎯 SUCCESS: Found ${rbcTransactionRows.length} RBC transaction rows from best table`);
        this.extractFromRBCTransactionRows(rbcTransactionRows);
      } else {
        // Fallback: try to find transactions without the table constraint
        rbcTransactionRows = document.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');

        if (rbcTransactionRows.length > 0) {
          console.log(`Found ${rbcTransactionRows.length} RBC transaction rows globally as fallback`);
          this.extractFromRBCTransactionRows(rbcTransactionRows);
        } else {
          console.log('No transaction rows found, trying fallback extraction');
          await this.fallbackExtraction();
        }
      }

      // Debug: Log page structure
      console.log('Page structure analysis:');
      console.log('Tables found:', document.querySelectorAll('table').length);
      console.log('Rows found:', document.querySelectorAll('tr').length);
      console.log('Elements with "transaction" in class:', document.querySelectorAll('[class*="transaction"]').length);
      console.log('Elements with dollar signs:', document.querySelectorAll('*').length > 0 ? 
        Array.from(document.querySelectorAll('*')).filter(el => el.textContent.includes('$')).length : 0);

      // Try to get account information and date range
      const accountInfo = this.extractAccountInfo();

      return {
        success: true,
        count: this.transactions.length,
        transactions: this.transactions,
        accountInfo: accountInfo
      };

    } catch (error) {
      console.error('Error extracting transactions:', error);
      return {
        success: false,
        error: error.message,
        count: 0,
        transactions: []
      };
    } finally {
      this.isExtracting = false;
    }
  }

  async clickAllShowMoreButtons() {
    console.log('Looking for "Show More" buttons...');
    let clickCount = 0;
    let maxAttempts = 100; // Safety limit to prevent infinite loops
    
    while (clickCount < maxAttempts) {
      // Look for "Show More" button
      const showMoreButton = this.findShowMoreButton();
      
      if (!showMoreButton) {
        console.log(`No more "Show More" buttons found. Clicked ${clickCount} time(s).`);
        break;
      }

      try {
        console.log(`Clicking "Show More" button (${clickCount + 1})...`);
        
        // Get current transaction count before clicking
        const beforeCount = this.getCurrentTransactionCount();
        
        // Click the button
        showMoreButton.click();
        clickCount++;
        
        // Wait for new transactions to load
        await sleep(2000);
        
        // Get new transaction count after clicking
        const afterCount = this.getCurrentTransactionCount();
        
        // If no new transactions loaded, we're done
        if (afterCount === beforeCount) {
          console.log('No new transactions loaded, stopping...');
          this.uiManager.updatePopupStatus('loading', 'All transactions loaded - processing...');
          break;
        }

        console.log(`Loaded ${afterCount - beforeCount} more transactions (total: ${afterCount})`);

      } catch (error) {
        console.error('Error clicking Show More button:', error);
        break;
      }
    }

    if (clickCount >= maxAttempts) {
      console.log(`Reached maximum attempts (${maxAttempts}), stopping...`);
    }

    console.log(`Finished loading all transactions. Total clicks: ${clickCount}`);
  }

  findShowMoreButton() {
    // Look for RBC's "Show More" buttons - find all buttons and filter by text content
    const allButtons = document.querySelectorAll('button');
    
    for (const button of allButtons) {
      // Skip if button is hidden or disabled
      if (button.disabled || button.offsetParent === null) {
        continue;
      }
      
      const buttonText = button.textContent.toLowerCase().trim();
      
      if (buttonText.includes('show more') || 
          buttonText.includes('view more') || 
          buttonText.includes('load more') ||
          button.classList.contains('pda-view-more-button')) {
        return button;
      }
    }
    
    return null;
  }

  getRBCResultCount() {
    // Look for RBC's result count messages like "We found 1,287 results"
    const resultSelectors = [
      '[class*="result"]',
      '[class*="count"]',
      '.rbc-result-count',
      'span:contains("results")',
      'span:contains("found")',
      'div:contains("found")',
      'p:contains("found")'
    ];

    for (const selector of resultSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent;
        // Look for patterns like "1,287 results" or "Found 1287 transactions"
        const countMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
        if (countMatch) {
          const count = parseInt(countMatch[1].replace(/,/g, ''));
          if (count > 0) {
            console.log(`Found RBC result count: ${count} from text: "${text}"`);
            return count;
          }
        }
      }
    }

    // Fallback: look for any element with numbers and "result", "found", "transactions"
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      const text = element.textContent;
      const countMatch = text.match(/found\s+(\d{1,3}(?:,\d{3})*)/i) ||
                        text.match(/(\d{1,3}(?:,\d{3})*)\s+results?/i) ||
                        text.match(/(\d{1,3}(?:,\d{3})*)\s+transactions?/i);
      if (countMatch) {
        const count = parseInt(countMatch[1].replace(/,/g, ''));
        if (count > 0) {
          console.log(`Found RBC result count: ${count} from text: "${text}"`);
          return count;
        }
      }
    }

    return 0;
  }

  getCurrentTransactionCount() {
    // Debug: Log all tables and their classes
    const allTables = document.querySelectorAll('table');
    console.log('=== TABLES ON PAGE ===');
    allTables.forEach((table, index) => {
      const rows = table.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
      console.log(`Table ${index}:`, table.className, table.classList);
      if (rows.length > 0) {
        console.log(`  -> Contains ${rows.length} transaction rows`);
      }
    });

    // Find the table that contains the most transaction rows (avoid duplicates)
    let bestTable = null;
    let maxRows = 0;

    for (const table of allTables) {
      if (table.className.includes('rbc-transaction-list')) {
        const rows = table.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        console.log(`Checking table "${table.className}" - contains ${rows.length} transaction rows`);

        if (rows.length > maxRows) {
          maxRows = rows.length;
          bestTable = table;
          console.log(`  -> This is the best table so far!`);
        }
      }
    }

    if (bestTable) {
      console.log(`🎯 Using table with ${maxRows} transactions:`, bestTable.className);
      return maxRows;
    }

    // Fallback: count all transaction rows globally
    const allTransactionRows = document.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
    console.log(`Found ${allTransactionRows.length} transactions globally as fallback`);
    return allTransactionRows.length;
  }

  extractFromRBCTransactionRows(transactionRows) {
    for (const row of transactionRows) {
      try {
        const transaction = parseRBCTransactionRow(row);
        if (transaction && isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      } catch (error) {
        console.error('Error parsing RBC transaction row:', error);
      }
    }

    console.log(`Extracted ${this.transactions.length} transactions from ${transactionRows.length} rows`);
  }

  async fallbackExtraction() {
    // First, try to find transaction tables or lists
    const transactionSelectors = [
      'table[class*="transaction"]',
      'table[class*="account"]',
      '.transaction-list',
      '.transaction-row',
      '[data-testid*="transaction"]',
      'tbody tr',
      '.account-activity table',
      '.statement-table'
    ];

    let transactionElements = [];
    
    for (const selector of transactionSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        transactionElements = Array.from(elements);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        break;
      }
    }

    if (transactionElements.length === 0) {
      // Try to find any table on the page
      const tables = document.querySelectorAll('table');
      if (tables.length > 0) {
        transactionElements = Array.from(tables);
      }
    }

    // Extract data from found elements
    for (const element of transactionElements) {
      if (element.tagName === 'TABLE') {
        this.extractFromTable(element);
      } else if (element.classList.contains('transaction-row') || element.tagName === 'TR') {
        this.extractFromRow(element);
      } else {
        this.extractFromGenericElement(element);
      }
    }

    // If still no transactions found, try a more aggressive approach
    if (this.transactions.length === 0) {
      this.extractFromPageText();
    }
  }

  extractAccountInfo() {
    const accountInfo = {
      accountName: '',
      accountNumber: '',
      dateRange: '',
      balance: ''
    };

    // Try to find account name and number
    const accountSelectors = [
      '.account-name',
      '.account-title',
      'h1',
      'h2',
      '[class*="account"]'
    ];

    for (const selector of accountSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        accountInfo.accountName = element.textContent.trim();
        break;
      }
    }

    // Try to find account number
    const accountNumberPattern = /\b\d{4}[\s-]*\d{4}[\s-]*\d{4}[\s-]*\d{4}\b/;
    const pageText = document.body.textContent;
    const accountNumberMatch = pageText.match(accountNumberPattern);
    if (accountNumberMatch) {
      accountInfo.accountNumber = accountNumberMatch[0];
    }

    // Try to find current balance
    const balanceSelectors = [
      '.current-balance',
      '.account-balance',
      '[class*="balance"]'
    ];

    for (const selector of balanceSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const amountMatch = text.match(/\$[\d,]+\.\d{2}/);
        if (amountMatch) {
          accountInfo.balance = amountMatch[0];
          break;
        }
      }
    }

    return accountInfo;
  }

  async countTransactionsOnPage() {
    try {
      // Use the same logic as extraction but just count
      let transactionCount = 0;
      let foundWithSelector = '';

      // Look for RBC-specific transaction rows - from both debit and credit tables
      const transactionTable = document.querySelector('table.rbc-transaction-list-table, table[class*="rbc-transaction-list"]');
      let rbcTransactionRows = [];
      
      if (transactionTable) {
        rbcTransactionRows = transactionTable.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        foundWithSelector = 'table.rbc-transaction-list-table tr[data-role="transaction-list-table-transaction"]';
      } else {
        // Fallback: try without table constraint
        rbcTransactionRows = document.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
        foundWithSelector = 'tr[data-role="transaction-list-table-transaction"]';
      }

      // Count valid transaction rows
      if (rbcTransactionRows.length > 0) {
        for (const row of rbcTransactionRows) {
          try {
            const transaction = parseRBCTransactionRow(row);
            if (transaction && isValidTransaction(transaction)) {
              transactionCount++;
            }
          } catch (error) {
            // Skip invalid rows
          }
        }
      }

      // If no specific transaction rows found, try fallback counting
      if (transactionCount === 0) {
        transactionCount = this.fallbackTransactionCount();
        foundWithSelector = 'fallback method';
      }

      console.log(`Live count: Found ${transactionCount} valid transactions on page using ${foundWithSelector}`);

      return {
        success: true,
        count: transactionCount,
        method: foundWithSelector
      };

    } catch (error) {
      console.error('Error counting transactions:', error);
      return {
        success: false,
        count: 0,
        error: error.message
      };
    }
  }

  fallbackTransactionCount() {
    let count = 0;
    
    // Count elements that look like transactions, but avoid duplicates
    const potentialTransactions = document.querySelectorAll('tr');
    const processedElements = new Set();
    
    for (const element of potentialTransactions) {
      // Skip if we've already processed this element
      if (processedElements.has(element)) continue;
      processedElements.add(element);
      
      const text = element.textContent;
      // Check if element contains both a date pattern and an amount pattern
      const hasDate = /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(text);
      const hasAmount = /\$[\d,]+\.\d{2}/.test(text);
      
      // Make sure it's not a header row and has substantial content
      if (hasDate && hasAmount && text.length > 20 && !text.toLowerCase().includes('date') && !text.toLowerCase().includes('description')) {
        count++;
      }
    }

    return count;
  }

  extractFromTable(table) {
    const rows = table.querySelectorAll('tr');
    let headers = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('td, th');

      if (i === 0 || (headers.length === 0 && cells.length > 0)) {
        // Try to identify headers
        headers = Array.from(cells).map(cell => 
          cell.textContent.trim().toLowerCase()
        );
        continue;
      }

      if (cells.length > 0) {
        const transaction = createTransactionFromCells(cells, headers);
        if (transaction && isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      }
    }
  }

  extractFromRow(row) {
    const cells = row.querySelectorAll('td, th, .cell, .column');
    if (cells.length > 0) {
      const transaction = createTransactionFromCells(cells);
      if (transaction && isValidTransaction(transaction)) {
        this.transactions.push(transaction);
      }
    }
  }

  extractFromGenericElement(element) {
    // Look for transaction-like patterns in the element
    const text = element.textContent;
    const datePatterns = [
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // MM/DD/YYYY
      /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g, // MM-DD-YYYY
      /\b\d{4}-\d{2}-\d{2}\b/g, // YYYY-MM-DD
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{4}\b/gi
    ];
    const amountPattern = /\$[\d,]+\.\d{2}/g;

    let dateMatch = null;
    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        dateMatch = matches[0];
        break;
      }
    }

    const amounts = text.match(amountPattern) || [];

    if (dateMatch && amounts.length > 0) {
      // Try to extract transaction info
      const transaction = {
        date: normalizeDate(dateMatch),
        description: extractDescription(text),
        amount: amounts[0],
        balance: amounts[amounts.length - 1] !== amounts[0] ? amounts[amounts.length - 1] : ''
      };

      if (isValidTransaction(transaction)) {
        this.transactions.push(transaction);
      }
    }
  }

  extractFromPageText() {
    // Last resort: scan entire page for transaction patterns
    const bodyText = document.body.textContent;
    const lines = bodyText.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (looksLikeTransaction(trimmedLine)) {
        const transaction = parseTransactionLine(trimmedLine);
        if (transaction && isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      }
    }
  }

  async processPDF(pdfUrl, filename) {
    try {
      console.log('Processing PDF:', pdfUrl);
      const result = await this.pdfProcessor.downloadAndProcessPDF(pdfUrl, filename);

      if (result.success && result.transactions.length > 0) {
        this.transactions = result.transactions;
        console.log(`Successfully processed PDF with ${result.transactions.length} transactions`);

        return {
          success: true,
          count: result.transactions.length,
          transactions: result.transactions,
          filename: result.filename
        };
      } else {
        return {
          success: false,
          error: 'No transactions found in PDF',
          count: 0,
          transactions: []
        };
      }
    } catch (error) {
      console.error('Error processing PDF:', error);
      return {
        success: false,
        error: error.message,
        count: 0,
        transactions: []
      };
    }
  }

  detectAvailablePDFs() {
    const pdfs = [];

    // Look for PDF download links on RBC pages
    const pdfSelectors = [
      'a[href*=".pdf"]',
      'a[href*="statement"]',
      'a[href*="download"]',
      'button[href*=".pdf"]',
      '[class*="pdf"]',
      '[class*="statement"] a',
      '.download-link',
      '.statement-download'
    ];

    pdfSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        const href = element.href || element.getAttribute('data-url') || element.getAttribute('data-href');
        const text = element.textContent.trim();

        if (href && (href.includes('.pdf') || href.includes('statement'))) {
          pdfs.push({
            url: href,
            text: text || 'Download Statement',
            element: element
          });
        }
      });
    });

    // Also check for any links that might lead to PDFs
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(link => {
      const href = link.href;
      const text = link.textContent.trim();

      if (href && (href.includes('statement') || href.includes('download')) && !href.includes('.pdf')) {
        // This might be a link that leads to a PDF download page
        pdfs.push({
          url: href,
          text: text || 'Statement Link',
          element: link,
          isIndirect: true
        });
      }
    });

    // Remove duplicates
    const uniquePDFs = pdfs.filter((pdf, index, self) =>
      index === self.findIndex(p => p.url === pdf.url)
    );

    console.log(`Found ${uniquePDFs.length} potential PDF sources`);
    return uniquePDFs;
  }
}
