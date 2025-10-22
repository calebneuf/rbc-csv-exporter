// RBC CSV Exporter Content Script
class PDFProcessor {
  constructor() {
    this.pdfjsLib = null;
    this.isProcessing = false;
  }

  async initializePDFJS() {
    if (this.pdfjsLib) return this.pdfjsLib;

    try {
      // Load PDF.js from CDN
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      document.head.appendChild(script);

      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      });

      this.pdfjsLib = window.pdfjsLib;
      if (this.pdfjsLib) {
        this.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      return this.pdfjsLib;
    } catch (error) {
      console.error('Failed to load PDF.js:', error);
      throw new Error('Could not load PDF processing library');
    }
  }

  async downloadAndProcessPDF(pdfUrl, filename = 'rbc_statement.pdf') {
    if (this.isProcessing) {
      throw new Error('PDF processing already in progress');
    }

    this.isProcessing = true;
    let downloadedFile = null;

    try {
      // Download the PDF file
      console.log('Downloading PDF:', pdfUrl);
      downloadedFile = await this.downloadPDFFile(pdfUrl, filename);

      if (!downloadedFile) {
        throw new Error('Failed to download PDF file');
      }

      // Process the PDF
      const transactions = await this.extractTransactionsFromPDF(downloadedFile);

      return {
        success: true,
        transactions: transactions,
        filename: filename
      };

    } catch (error) {
      console.error('Error in PDF processing:', error);
      throw error;
    } finally {
      this.isProcessing = false;

      // Clean up downloaded file
      if (downloadedFile) {
        try {
          URL.revokeObjectURL(downloadedFile);
        } catch (e) {
          console.warn('Could not revoke PDF URL:', e);
        }
      }
    }
  }

  async downloadPDFFile(url, filename) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      throw new Error(`Failed to download PDF: ${error.message}`);
    }
  }

  async extractTransactionsFromPDF(pdfFileUrl) {
    const pdfjsLib = await this.initializePDFJS();
    if (!pdfjsLib) {
      throw new Error('PDF.js not available');
    }

    try {
      console.log('Loading PDF for text extraction...');
      const pdf = await pdfjsLib.getDocument(pdfFileUrl).promise;
      const transactions = [];

      // Process each page of the PDF
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdf.numPages}`);
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        const pageTransactions = this.parsePDFPage(textContent, pageNum);
        transactions.push(...pageTransactions);
      }

      console.log(`Extracted ${transactions.length} transactions from PDF`);
      return transactions;

    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`PDF processing failed: ${error.message}`);
    }
  }

  parsePDFPage(textContent, pageNumber) {
    const transactions = [];
    const textItems = textContent.items;

    // Group text items into lines based on their Y position
    const lines = this.groupTextIntoLines(textItems);

    for (const line of lines) {
      const transaction = this.parseTransactionLine(line);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return transactions;
  }

  groupTextIntoLines(textItems) {
    const lines = [];
    const tolerance = 2; // Y position tolerance for grouping into lines

    for (const item of textItems) {
      const y = item.transform[5]; // Y coordinate of the text item
      let line = lines.find(l => Math.abs(l.y - y) <= tolerance);

      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }

      line.items.push(item);
    }

    // Sort lines by Y position (top to bottom)
    lines.sort((a, b) => b.y - a.y);

    return lines.map(line => ({
      text: line.items.map(item => item.str).join(' '),
      y: line.y
    }));
  }

  parseTransactionLine(line) {
    const text = line.text.trim();
    if (!text) return null;

    // RBC PDF statement patterns - adjust based on actual PDF format
    const patterns = [
      // Date Amount Description pattern
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+([+-]?\$\d+\.\d{2})\s+(.+)/,
      // Description Date Amount pattern
      /(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([+-]?\$\d+\.\d{2})/,
      // More flexible patterns for different RBC statement formats
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+([+-]?\d+\.\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const [, date, amount, description] = match;

        return {
          date: this.normalizeDate(date),
          amount: this.normalizeAmount(amount),
          description: description.trim(),
          source: 'PDF',
          page: line.y // Store page/line info for debugging
        };
      }
    }

    return null;
  }

  normalizeDate(dateStr) {
    // Convert various date formats to consistent format
    const formats = [
      /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY
      /^\d{4}-\d{1,2}-\d{1,2}$/, // YYYY-MM-DD
    ];

    if (formats[0].test(dateStr)) {
      const [month, day, year] = dateStr.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return dateStr;
  }

  normalizeAmount(amountStr) {
    // Convert various amount formats to consistent format
    const cleanAmount = amountStr.replace(/[,$]/g, '');
    const num = parseFloat(cleanAmount);

    if (isNaN(num)) return amountStr;

    // Return as negative for withdrawals, positive for deposits
    return amountStr.startsWith('-') || amountStr.includes('(') ?
      num.toFixed(2) : num.toFixed(2);
  }
}

class RBCTransactionExtractor {
  constructor() {
    this.transactions = [];
    this.isExtracting = false;
    this.observer = null;
    this.pdfProcessor = new PDFProcessor();
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
      this.addExtractionButton();
    }
  }

  isRBCPage() {
    const hostname = window.location.hostname;
    return hostname.includes('rbcroyalbank.com') || 
           hostname.includes('royalbank.com') || 
           hostname.includes('rbc.com');
  }

  addExtractionButton() {
    // Wait for page to load
    setTimeout(() => {
      // Create button container
      const container = document.createElement('div');
      container.id = 'rbc-csv-extractor-container';
      container.className = 'rbc-csv-extractor-container';
      
      // Create the button
      const button = document.createElement('button');
      button.id = 'rbc-csv-extractor-btn';
      button.innerHTML = '📊 Export Transactions';
      button.className = 'rbc-csv-extractor-button';
      button.onclick = () => this.openExtensionPopup();
      
      // Create transaction counter badge
      const badge = document.createElement('span');
      badge.id = 'rbc-csv-extractor-count';
      badge.className = 'rbc-csv-extractor-count';
      badge.textContent = '0';
      
      // Add button and badge to container
      container.appendChild(button);
      container.appendChild(badge);

      // Try to find a good location to place the container
      const targetSelectors = [
        '.account-summary-header',
        '.transaction-list-header',
        '.account-details-header',
        'h1',
        'header'
      ];

      for (const selector of targetSelectors) {
        const target = document.querySelector(selector);
        if (target) {
          target.appendChild(container);
          break;
        }
      }

      // If no good location found, add to body
      if (!document.getElementById('rbc-csv-extractor-container')) {
        document.body.appendChild(container);
      }
      
      // Update the count
      this.updateFloatingCount();
      
      // Update count periodically (every 2 seconds)
      this.countInterval = setInterval(() => this.updateFloatingCount(), 2000);
    }, 2000);
  }

  async updateFloatingCount() {
    const badge = document.getElementById('rbc-csv-extractor-count');
    if (!badge) return;

    try {
      // Use the same logic as the main counter
      const count = this.getCurrentTransactionCount();
      badge.textContent = count.toString();
      console.log(`Floating badge updated: ${count} transactions`);
    } catch (error) {
      console.error('Error updating floating count:', error);
    }
  }

  openExtensionPopup() {
    // Toggle the inline popup
    const existingPopup = document.getElementById('rbc-csv-extractor-popup');
    
    if (existingPopup) {
      // Close the popup
      existingPopup.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (existingPopup.parentNode) {
          existingPopup.parentNode.removeChild(existingPopup);
        }
      }, 300);
    } else {
      // Open the popup
      this.showInlinePopup();
    }
  }

  showInlinePopup() {
    // Create the inline popup
    const popup = document.createElement('div');
    popup.id = 'rbc-csv-extractor-popup';
    popup.className = 'rbc-csv-extractor-popup';
    
    // Get button position
    const container = document.getElementById('rbc-csv-extractor-container');
    const containerRect = container ? container.getBoundingClientRect() : null;
    
    popup.innerHTML = `
      <div class="rbc-popup-header">
        <span class="rbc-popup-title">RBC CSV Exporter</span>
        <button class="rbc-popup-close" id="rbc-popup-close">×</button>
      </div>
      <div class="rbc-popup-content">
        <div class="rbc-popup-status">
          <span class="rbc-status-indicator" id="rbc-status-indicator">●</span>
          <span id="rbc-status-text">Ready to export</span>
        </div>
        
        <div class="rbc-popup-info">
          <p>Transactions visible: <strong><span id="rbc-popup-count">0</span></strong></p>
          <p id="rbc-total-count" class="rbc-total-count" style="display: none;">
            RBC total: <strong><span id="rbc-total-count-number">0</span></strong>
          </p>
        </div>

        <!-- Progress bar for extraction -->
        <div id="rbc-progress-container" class="rbc-progress-container" style="display: none;">
          <div class="rbc-progress-info">
            <span id="rbc-progress-text">Loading transactions...</span>
            <span id="rbc-progress-percent">0%</span>
          </div>
          <div class="rbc-progress-bar">
            <div id="rbc-progress-fill" class="rbc-progress-fill"></div>
          </div>
          <div class="rbc-progress-details">
            <span id="rbc-progress-current">0</span> / <span id="rbc-progress-total">0</span> transactions
          </div>
        </div>

        <div class="rbc-popup-actions">
          <button id="rbc-popup-extract-btn" class="rbc-popup-btn rbc-popup-btn-primary">
            <span>📊 Extract Transactions</span>
          </button>
          <button id="rbc-popup-download-btn" class="rbc-popup-btn rbc-popup-btn-secondary" style="display: none;">
            <span>💾 Download CSV</span>
          </button>
        </div>

        <div class="rbc-popup-help">
          <details>
            <summary>How to use</summary>
            <ol>
              <li>Set date filter in RBC (up to 7 years)</li>
              <li>Wait for all transactions to load</li>
              <li>Click "Extract Transactions"</li>
              <li>Click "Download CSV" when ready</li>
            </ol>
          </details>
        </div>
      </div>
    `;
    
    // Position the popup
    popup.style.cssText = `
      position: fixed;
      top: ${containerRect ? containerRect.bottom + 10 : 80}px;
      right: 20px;
      width: 320px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      z-index: 999997;
      animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(popup);
    
    // Add animation styles
    this.addPopupStyles();
    
    // Update count
    this.updatePopupCount();
    
    // Add event listeners
    this.setupPopupListeners();
  }

  addPopupStyles() {
    if (document.getElementById('rbc-popup-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'rbc-popup-styles';
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-10px);
        }
      }
      
      .rbc-csv-extractor-popup {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .rbc-popup-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
        border-radius: 12px 12px 0 0;
        color: white;
      }
      
      .rbc-popup-title {
        font-size: 16px;
        font-weight: 600;
      }
      
      .rbc-popup-close {
        background: none;
        border: none;
        color: white;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.2s;
      }
      
      .rbc-popup-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      
      .rbc-popup-content {
        padding: 20px;
      }
      
      .rbc-popup-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #f8fafc;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 14px;
        color: #475569;
      }
      
      .rbc-status-indicator {
        color: #10b981;
        font-size: 12px;
      }
      
      .rbc-popup-info {
        margin-bottom: 16px;
        font-size: 14px;
        color: #64748b;
      }
      
      .rbc-popup-info strong {
        color: #1e293b;
        font-size: 18px;
      }

      .rbc-total-count {
        color: #059669;
        font-size: 13px;
        margin-top: 4px;
      }

      .rbc-total-count strong {
        color: #047857;
        font-size: 16px;
      }

      .rbc-progress-container {
        margin: 16px 0;
        padding: 16px;
        background: #f0f9ff;
        border: 1px solid #0ea5e9;
        border-radius: 8px;
      }

      .rbc-progress-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 500;
      }

      .rbc-progress-info #rbc-progress-text {
        color: #0369a1;
      }

      .rbc-progress-info #rbc-progress-percent {
        color: #0c4a6e;
        font-weight: 600;
      }

      .rbc-progress-bar {
        width: 100%;
        height: 8px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
      }

      .rbc-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6 0%, #1e40af 100%);
        border-radius: 4px;
        width: 0%;
        transition: width 0.3s ease;
      }

      .rbc-progress-details {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #64748b;
      }

      .rbc-popup-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }
      
      .rbc-popup-btn {
        padding: 12px 16px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      
      .rbc-popup-btn-primary {
        background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
        color: white;
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
      }
      
      .rbc-popup-btn-primary:hover {
        background: linear-gradient(135deg, #1e40af 0%, #2563eb 100%);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
      }
      
      .rbc-popup-btn-primary:disabled {
        background: #9ca3af;
        cursor: not-allowed;
        transform: none;
      }
      
      .rbc-popup-btn-secondary {
        background: #10b981;
        color: white;
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
      }
      
      .rbc-popup-btn-secondary:hover {
        background: #059669;
        transform: translateY(-1px);
      }
      
      .rbc-popup-help {
        border-top: 1px solid #e2e8f0;
        padding-top: 16px;
      }
      
      .rbc-popup-help details {
        background: #f8fafc;
        padding: 12px;
        border-radius: 6px;
      }
      
      .rbc-popup-help summary {
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        color: #475569;
      }
      
      .rbc-popup-help ol {
        margin-top: 8px;
        margin-left: 16px;
        font-size: 12px;
        color: #64748b;
        line-height: 1.5;
      }
      
      .rbc-popup-help li {
        margin-bottom: 4px;
      }
      
      .rbc-status-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #e2e8f0;
        border-top: 2px solid #3b82f6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-right: 4px;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  updatePopupCount() {
    const countElement = document.getElementById('rbc-popup-count');
    if (!countElement) return;

    const count = this.getCurrentTransactionCount();
    countElement.textContent = count.toString();

    // Also update the floating badge
    this.updateFloatingCount();
  }

  setupPopupListeners() {
    // Close button
    const closeBtn = document.getElementById('rbc-popup-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.openExtensionPopup();
    }
    
    // Extract button
    const extractBtn = document.getElementById('rbc-popup-extract-btn');
    if (extractBtn) {
      extractBtn.onclick = async () => {
        await this.handlePopupExtract();
      };
    }
    
    // Download button
    const downloadBtn = document.getElementById('rbc-popup-download-btn');
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        if (this.transactions && this.transactions.length > 0) {
          this.downloadCSV(this.transactions);
          this.updatePopupStatus('success', `✅ Downloaded ${this.transactions.length} transactions`);
        }
      };
    }
  }

  async handlePopupExtract() {
    const extractBtn = document.getElementById('rbc-popup-extract-btn');
    const downloadBtn = document.getElementById('rbc-popup-download-btn');
    
    if (extractBtn) {
      extractBtn.disabled = true;
      extractBtn.innerHTML = '<span>⏳ Extracting...</span>';
    }
    
    this.updatePopupStatus('loading', 'Extracting transactions...');
    
    // Add spinner to status
    this.addSpinnerToStatus();
    
    try {
      const result = await this.extractTransactionsWithProgress();
      
      // Remove spinner and hide progress bar
      this.removeSpinnerFromStatus();
      this.hideProgressBar();

      if (result.success && result.transactions.length > 0) {
        this.updatePopupStatus('success', `Found ${result.count} transactions!`);

        if (downloadBtn) {
          downloadBtn.style.display = 'flex';
        }

        if (extractBtn) {
          extractBtn.innerHTML = '<span>✅ Extraction Complete</span>';
        }
      } else {
        this.updatePopupStatus('error', 'No transactions found');
        if (extractBtn) {
          extractBtn.innerHTML = '<span>❌ No Transactions</span>';
        }
      }
    } catch (error) {
      console.error('Error:', error);
      this.removeSpinnerFromStatus();
      this.hideProgressBar();
      this.updatePopupStatus('error', 'Extraction failed');
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
      await this.sleep(1000);

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
      this.showTotalCount(totalExpected);
      this.showProgressBar(0, totalExpected);
    }

    while (clickCount < maxAttempts) {
      // Look for "Show More" button
      const showMoreButton = this.findShowMoreButton();

      if (!showMoreButton) {
        console.log(`No more "Show More" buttons found. Clicked ${clickCount} time(s).`);
        this.updatePopupStatus('loading', 'Processing transactions...');
        break;
      }

      try {
        // Update status to show loading
        this.updatePopupStatus('loading', `Loading all transactions... (${clickCount + 1})`);

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
          await this.sleep(500);
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
        this.animateCounter(beforeCount, afterCount);

        // Update the popup count as well
        this.updatePopupCount();

        // Update progress bar if we have a total
        if (totalExpected > 0) {
          const progress = Math.min((afterCount / totalExpected) * 100, 100);
          this.updateProgressBar(progress, totalExpected, afterCount);
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

  animateCounter(fromValue, toValue) {
    const countElement = document.getElementById('rbc-popup-count');
    if (!countElement || fromValue === toValue) return;
    
    const duration = 800; // Animation duration in ms
    const steps = 30; // Number of animation steps
    const stepDuration = duration / steps;
    const increment = (toValue - fromValue) / steps;
    
    let currentValue = fromValue;
    let step = 0;
    
    const animate = () => {
      if (step < steps) {
        currentValue += increment;
        countElement.textContent = Math.round(currentValue).toString();
        step++;
        setTimeout(animate, stepDuration);
      } else {
        countElement.textContent = toValue.toString();
      }
    };
    
    animate();
  }

  addSpinnerToStatus() {
    const statusDiv = document.querySelector('.rbc-popup-status');
    if (!statusDiv) return;
    
    // Check if spinner already exists
    if (document.getElementById('rbc-status-spinner')) return;
    
    const spinner = document.createElement('div');
    spinner.id = 'rbc-status-spinner';
    spinner.className = 'rbc-status-spinner';
    
    statusDiv.insertBefore(spinner, statusDiv.firstChild);
  }

  removeSpinnerFromStatus() {
    const spinner = document.getElementById('rbc-status-spinner');
    if (spinner && spinner.parentNode) {
      spinner.parentNode.removeChild(spinner);
    }
  }

  showTotalCount(totalCount) {
    const totalCountElement = document.getElementById('rbc-total-count');
    const totalCountNumber = document.getElementById('rbc-total-count-number');

    if (totalCountElement && totalCountNumber) {
      totalCountNumber.textContent = totalCount.toLocaleString();
      totalCountElement.style.display = 'block';
    }
  }

  showProgressBar(current, total) {
    const progressContainer = document.getElementById('rbc-progress-container');
    const progressText = document.getElementById('rbc-progress-text');
    const progressPercent = document.getElementById('rbc-progress-percent');
    const progressFill = document.getElementById('rbc-progress-fill');
    const progressCurrent = document.getElementById('rbc-progress-current');
    const progressTotal = document.getElementById('rbc-progress-total');

    if (progressContainer) {
      progressContainer.style.display = 'block';
    }

    if (progressText) {
      progressText.textContent = 'Loading transactions...';
    }

    if (progressPercent) {
      progressPercent.textContent = '0%';
    }

    if (progressFill) {
      progressFill.style.width = '0%';
    }

    if (progressCurrent) {
      progressCurrent.textContent = '0';
    }

    if (progressTotal) {
      progressTotal.textContent = total.toLocaleString();
    }
  }

  updateProgressBar(progress, total, current) {
    const progressText = document.getElementById('rbc-progress-text');
    const progressPercent = document.getElementById('rbc-progress-percent');
    const progressFill = document.getElementById('rbc-progress-fill');
    const progressCurrent = document.getElementById('rbc-progress-current');

    if (progressText) {
      const status = progress < 100 ? 'Loading transactions...' : 'Processing transactions...';
      progressText.textContent = status;
    }

    if (progressPercent) {
      progressPercent.textContent = Math.round(progress) + '%';
    }

    if (progressFill) {
      progressFill.style.width = progress + '%';
    }

    if (progressCurrent) {
      progressCurrent.textContent = current.toLocaleString();
    }
  }

  hideProgressBar() {
    const progressContainer = document.getElementById('rbc-progress-container');
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }
  }

  updatePopupStatus(type, message) {
    const indicator = document.getElementById('rbc-status-indicator');
    const text = document.getElementById('rbc-status-text');
    
    if (indicator) {
      const colors = {
        loading: '#fbbf24',
        success: '#10b981',
        error: '#ef4444',
        ready: '#10b981'
      };
      indicator.style.color = colors[type] || colors.ready;
    }
    
    if (text) {
      text.textContent = message;
    }
  }

  async extractTransactions() {
    this.isExtracting = true;
    this.transactions = [];

    try {
      // Check for RBC's result count message
      const resultCount = this.getRBCResultCount();
      if (resultCount > 0) {
        this.updatePopupStatus('loading', `Found ${resultCount} transactions - loading...`);
        console.log(`RBC reports ${resultCount} total transactions`);
      }

      // Keep clicking "Show More" buttons until they're all gone
      await this.clickAllShowMoreButtons();

      // Wait a bit for final content to load
      await this.sleep(1000);

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
        await this.sleep(2000);
        
        // Get new transaction count after clicking
        const afterCount = this.getCurrentTransactionCount();
        
        // If no new transactions loaded, we're done
        if (afterCount === beforeCount) {
          console.log('No new transactions loaded, stopping...');
          this.updatePopupStatus('loading', 'All transactions loaded - processing...');
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

    // If we found a best table, use it
    if (bestTable) {
      const rows = bestTable.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
      console.log(`🎯 SUCCESS: Found ${rows.length} transactions in best table - using this count!`);
      return rows.length;
    }

    // Fallback: count all transaction rows globally
    const allTransactionRows = document.querySelectorAll('tr[data-role="transaction-list-table-transaction"]');
    console.log(`Found ${allTransactionRows.length} transactions globally as fallback`);
    return allTransactionRows.length;
  }

  extractFromRBCTransactionRows(transactionRows) {
    for (const row of transactionRows) {
      try {
        const transaction = this.parseRBCTransactionRow(row);
        if (transaction && this.isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      } catch (error) {
        console.error('Error parsing RBC transaction row:', error);
      }
    }

    console.log(`Extracted ${this.transactions.length} transactions from ${transactionRows.length} rows`);
  }

  parseRBCTransactionRow(row) {
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
      transaction.date = dateElement.textContent.trim();
    }

    // If no date found, try extracting from row's id or headers attribute
    if (!transaction.date) {
      const rowId = row.getAttribute('id') || '';
      const dateMatch = rowId.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        transaction.date = dateMatch[1];
      }
    }

    // If still no date, look in row text
    if (!transaction.date) {
      const rowText = row.textContent;
      const datePatterns = [
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/i,
        /\b\d{4}-\d{2}-\d{2}\b/,
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
        /\b\d{1,2}-\d{1,2}-\d{4}\b/
      ];
      
      for (const pattern of datePatterns) {
        const match = rowText.match(pattern);
        if (match) {
          transaction.date = match[0];
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
          const parsed = this.parseDescriptionAndVendor(descriptions[0]);
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
            !this.isAmount(text) && 
            !this.isDate(text) &&
            text.length > 5) {
          longestText = text;
        }
      }
      
      if (longestText) {
        const parsed = this.parseDescriptionAndVendor(longestText);
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
        // Payments/refunds in deposit column (shown as negative, are credits)
        const amountText = depositElement.textContent.trim();
        // Keep the negative sign as-is since these reduce the balance
        transaction.amount = amountText;
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
        if (this.isAmount(text)) {
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
        if (this.isAmount(text) && text !== transaction.amount) {
          amounts.push(text);
        }
      }
      
      if (amounts.length > 0) {
        transaction.balance = amounts[amounts.length - 1];
      }
    }

    return transaction;
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
            const transaction = this.parseRBCTransactionRow(row);
            if (transaction && this.isValidTransaction(transaction)) {
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

  parseDescriptionAndVendor(text) {
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        const transaction = this.createTransactionFromCells(cells, headers);
        if (transaction && this.isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      }
    }
  }

  extractFromRow(row) {
    const cells = row.querySelectorAll('td, th, .cell, .column');
    if (cells.length > 0) {
      const transaction = this.createTransactionFromCells(cells);
      if (transaction && this.isValidTransaction(transaction)) {
        this.transactions.push(transaction);
      }
    }
  }

  extractFromGenericElement(element) {
    // Look for transaction-like patterns in the element
    const text = element.textContent;
    const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
    const amountPattern = /\$[\d,]+\.\d{2}/g;

    const dates = text.match(datePattern) || [];
    const amounts = text.match(amountPattern) || [];

    if (dates.length > 0 && amounts.length > 0) {
      // Try to extract transaction info
      const transaction = {
        date: dates[0],
        description: this.extractDescription(text),
        amount: amounts[0],
        balance: amounts[amounts.length - 1] !== amounts[0] ? amounts[amounts.length - 1] : ''
      };

      if (this.isValidTransaction(transaction)) {
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
      if (this.looksLikeTransaction(trimmedLine)) {
        const transaction = this.parseTransactionLine(trimmedLine);
        if (transaction && this.isValidTransaction(transaction)) {
          this.transactions.push(transaction);
        }
      }
    }
  }

  createTransactionFromCells(cells, headers = []) {
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

      if (this.isDate(text)) {
        transaction.date = text;
      } else if (this.isAmount(text)) {
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

  isDate(text) {
    const datePatterns = [
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
      /^\d{1,2}-\d{1,2}-\d{2,4}$/,
      /^\d{4}-\d{1,2}-\d{1,2}$/,
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i
    ];
    return datePatterns.some(pattern => pattern.test(text.trim()));
  }

  isAmount(text) {
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

  looksLikeTransaction(line) {
    return this.isDate(line) || 
           (line.includes('$') && line.length > 10) ||
           /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b.*\$[\d,]+\.\d{2}/.test(line);
  }

  parseTransactionLine(line) {
    const dateMatch = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    const amountMatches = line.match(/\$[\d,]+\.\d{2}/g);

    if (dateMatch && amountMatches) {
      return {
        date: dateMatch[0],
        description: this.extractDescription(line),
        amount: amountMatches[0],
        balance: amountMatches.length > 1 ? amountMatches[amountMatches.length - 1] : ''
      };
    }

    return null;
  }

  extractDescription(text) {
    // Remove dates and amounts to get description
    let description = text
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '')
      .replace(/\$[\d,]+\.\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return description.substring(0, 100); // Limit length
  }

  isValidTransaction(transaction) {
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


  downloadCSV(transactions) {
    const csv = this.convertToCSV(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `rbc_transactions_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  convertToCSV(transactions) {
    if (transactions.length === 0) return '';

    // Define column order to match standard bank exports
    const orderedHeaders = ['date', 'accountType', 'description', 'vendor', 'type', 'amount', 'balance', 'reference'];

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
        case 'type': return 'Type';
        case 'amount': return 'Amount';
        case 'balance': return 'Balance';
        case 'reference': return 'Reference';
        default: return h.charAt(0).toUpperCase() + h.slice(1);
      }
    }).join(',');

    // Create CSV rows
    const csvRows = transactions.map(transaction => {
      return headers.map(header => {
        const value = transaction[header] || '';
        // Escape quotes and wrap in quotes if contains comma, quotes, or newlines
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  // PDF Processing Methods
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

  downloadCSV(transactions, source = 'web') {
    const csv = this.convertToCSV(transactions);
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
}

// Initialize the extractor
new RBCTransactionExtractor();
