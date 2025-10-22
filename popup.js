// RBC CSV Exporter Popup Script
class PopupController {
  constructor() {
    this.currentTab = null;
    this.extractedTransactions = [];
    this.init();
  }

  async init() {
    // Get current active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
    } catch (error) {
      console.error('Error getting active tab:', error);
    }

    // Set up event listeners
    this.setupEventListeners();

    // Check if we're on an RBC page
    await this.checkRBCPage();
  }

  setupEventListeners() {
    const extractBtn = document.getElementById('extract-btn');
    const downloadBtn = document.getElementById('download-btn');
    const refreshCountBtn = document.getElementById('refresh-count-btn');
    const detectPdfsBtn = document.getElementById('detect-pdfs-btn');

    if (extractBtn) {
      extractBtn.addEventListener('click', () => this.extractTransactions());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.downloadCSV());
    }

    if (refreshCountBtn) {
      refreshCountBtn.addEventListener('click', () => this.refreshTransactionCount());
    }

    if (detectPdfsBtn) {
      detectPdfsBtn.addEventListener('click', () => this.detectAndShowPDFs());
    }
  }

  async checkRBCPage() {
    if (!this.currentTab) {
      this.showNonRBCContent();
      return;
    }

    // First check if we're on an RBC page by URL
    const isRBCURL = this.isRBCURL(this.currentTab.url);
    
    if (!isRBCURL) {
      this.showNonRBCContent();
      this.updateStatus('disconnected', 'Not on RBC page');
      return;
    }

    try {
      // Try to communicate with content script
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'checkRBCPage'
      });

      if (response && response.isRBCPage) {
        this.showRBCContent();
        this.updateStatus('connected', 'Connected to RBC page');
      } else {
        this.showRBCContent(); // Still show RBC content since URL is correct
        this.updateStatus('connected', 'RBC page detected');
      }
    } catch (error) {
      console.log('Content script not loaded, attempting to inject...');
      
      // Try to inject the content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          files: ['content.js']
        });

        await chrome.scripting.insertCSS({
          target: { tabId: this.currentTab.id },
          files: ['content.css']
        });

        // Wait a moment for script to initialize
        await this.sleep(500);

        // Try communication again
        try {
          const response = await chrome.tabs.sendMessage(this.currentTab.id, {
            action: 'checkRBCPage'
          });
          
          this.showRBCContent();
          this.updateStatus('connected', 'Connected to RBC page');
        } catch (retryError) {
          // Even if communication fails, we know it's an RBC page by URL
          this.showRBCContent();
          this.updateStatus('connected', 'RBC page detected (manual injection)');
        }
      } catch (injectionError) {
        console.error('Failed to inject content script:', injectionError);
        this.showRBCContent(); // Still show RBC content since URL is correct
        this.updateStatus('disconnected', 'RBC page - script injection failed');
      }
    }
  }

  isRBCURL(url) {
    if (!url) return false;
    return url.includes('rbcroyalbank.com') || 
           url.includes('royalbank.com') || 
           url.includes('rbc.com');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  showRBCContent() {
    document.getElementById('loading-content').style.display = 'none';
    document.getElementById('non-rbc-page-content').style.display = 'none';
    document.getElementById('rbc-page-content').style.display = 'block';
    
    // Show the live counter and start counting
    document.getElementById('live-counter-section').style.display = 'block';
    this.refreshTransactionCount();
  }

  showNonRBCContent() {
    document.getElementById('loading-content').style.display = 'none';
    document.getElementById('rbc-page-content').style.display = 'none';
    document.getElementById('non-rbc-page-content').style.display = 'block';
  }

  updateStatus(type, message) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('status-text');

    if (statusDot) {
      statusDot.className = `status-dot ${type}`;
    }

    if (statusText) {
      statusText.textContent = message;
    }
  }

  async extractTransactions() {
    if (!this.currentTab) {
      this.showError('No active tab found');
      return;
    }

    const extractBtn = document.getElementById('extract-btn');
    const resultsSection = document.getElementById('results-section');

    try {
      // Update button state
      extractBtn.disabled = true;
      extractBtn.classList.add('loading');
      extractBtn.innerHTML = '<span class="btn-icon">⏳</span> Extracting...';

      // Hide previous results
      resultsSection.style.display = 'none';

      // Send message to content script
      let response;
      try {
        response = await chrome.tabs.sendMessage(this.currentTab.id, {
          action: 'extractTransactions'
        });
      } catch (connectionError) {
        // If content script isn't loaded, try to inject it first
        console.log('Content script not available, injecting...');
        
        try {
          await chrome.scripting.executeScript({
            target: { tabId: this.currentTab.id },
            files: ['content.js']
          });

          await chrome.scripting.insertCSS({
            target: { tabId: this.currentTab.id },
            files: ['content.css']
          });

          // Wait for script to initialize
          await this.sleep(1000);

          // Try extraction again
          response = await chrome.tabs.sendMessage(this.currentTab.id, {
            action: 'extractTransactions'
          });
        } catch (injectionError) {
          throw new Error('Unable to load extension on this page. Please refresh the page and try again.');
        }
      }

      if (response && response.success) {
        this.extractedTransactions = response.transactions;
        this.showResults(response.count);
        
        if (response.count > 0) {
          extractBtn.innerHTML = '<span class="btn-icon">✅</span> Extraction Complete';
        } else {
          extractBtn.innerHTML = '<span class="btn-icon">❌</span> No Transactions Found';
        }
      } else {
        throw new Error(response?.error || 'Failed to extract transactions');
      }

    } catch (error) {
      console.error('Error extracting transactions:', error);
      this.showError('Failed to extract transactions. Make sure you\'re on a page with transaction data.');
      extractBtn.innerHTML = '<span class="btn-icon">❌</span> Extraction Failed';
    } finally {
      extractBtn.disabled = false;
      extractBtn.classList.remove('loading');
      
      // Reset button after 3 seconds
      setTimeout(() => {
        extractBtn.innerHTML = '<span class="btn-icon">📊</span> Extract Transactions';
      }, 3000);
    }
  }

  showResults(count) {
    const resultsSection = document.getElementById('results-section');
    const transactionCount = document.getElementById('transaction-count');
    const downloadBtn = document.getElementById('download-btn');

    if (transactionCount) {
      transactionCount.textContent = count;
    }

    if (count > 0 && downloadBtn) {
      downloadBtn.style.display = 'block';
    }

    resultsSection.style.display = 'block';
  }

  downloadCSV() {
    if (this.extractedTransactions.length === 0) {
      this.showError('No transactions to download');
      return;
    }

    try {
      const csv = this.convertToCSV(this.extractedTransactions);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      // Create download link
      const link = document.createElement('a');
      link.href = url;
      link.download = `rbc_transactions_${new Date().toISOString().split('T')[0]}.csv`;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      URL.revokeObjectURL(url);

      // Update button to show success
      const downloadBtn = document.getElementById('download-btn');
      if (downloadBtn) {
        const originalText = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '<span class="btn-icon">✅</span> Downloaded!';
        setTimeout(() => {
          downloadBtn.innerHTML = originalText;
        }, 2000);
      }

    } catch (error) {
      console.error('Error downloading CSV:', error);
      this.showError('Failed to download CSV file');
    }
  }

  convertToCSV(transactions) {
    if (transactions.length === 0) return '';

    // Get all unique keys from transactions
    const headers = [...new Set(transactions.flatMap(t => Object.keys(t)))];
    
    // Create CSV header
    const csvHeaders = headers.join(',');
    
    // Create CSV rows
    const csvRows = transactions.map(transaction => {
      return headers.map(header => {
        const value = transaction[header] || '';
        // Escape quotes and wrap in quotes if contains comma or quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  async refreshTransactionCount() {
    if (!this.currentTab) return;

    const refreshBtn = document.getElementById('refresh-count-btn');
    const countElement = document.getElementById('live-transaction-count');

    try {
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="btn-icon">⏳</span> Counting...';
      }

      // Try to get transaction count from content script
      let response;
      try {
        response = await chrome.tabs.sendMessage(this.currentTab.id, {
          action: 'countTransactions'
        });
      } catch (connectionError) {
        // If content script isn't loaded, try to inject it first
        try {
          await chrome.scripting.executeScript({
            target: { tabId: this.currentTab.id },
            files: ['content.js']
          });

          await chrome.scripting.insertCSS({
            target: { tabId: this.currentTab.id },
            files: ['content.css']
          });

          await this.sleep(500);

          response = await chrome.tabs.sendMessage(this.currentTab.id, {
            action: 'countTransactions'
          });
        } catch (injectionError) {
          throw new Error('Unable to count transactions on this page');
        }
      }

      if (response && typeof response.count === 'number') {
        if (countElement) {
          countElement.textContent = response.count;
        }
      } else {
        if (countElement) {
          countElement.textContent = '0';
        }
      }

    } catch (error) {
      console.error('Error counting transactions:', error);
      if (countElement) {
        countElement.textContent = '?';
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<span class="btn-icon">🔄</span> Refresh Count';
      }
    }
  }

  async detectAndShowPDFs() {
    if (!this.currentTab) {
      this.showError('No active tab found');
      return;
    }

    const detectBtn = document.getElementById('detect-pdfs-btn');
    const pdfSection = document.getElementById('pdf-section');

    try {
      // Update button state
      detectBtn.disabled = true;
      detectBtn.innerHTML = '<span class="btn-icon">🔍</span> Detecting PDFs...';

      // Send message to content script to detect PDFs
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'detectPDFs'
      });

      if (response && response.pdfs && response.pdfs.length > 0) {
        this.showPDFSection(response.pdfs);
        detectBtn.innerHTML = '<span class="btn-icon">✅</span> PDFs Found';
      } else {
        this.showPDFSection([]);
        detectBtn.innerHTML = '<span class="btn-icon">❌</span> No PDFs Found';
      }

    } catch (error) {
      console.error('Error detecting PDFs:', error);
      this.showError('Failed to detect PDFs');
      detectBtn.innerHTML = '<span class="btn-icon">❌</span> Detection Failed';
    } finally {
      detectBtn.disabled = false;

      // Reset button after 3 seconds
      setTimeout(() => {
        detectBtn.innerHTML = '<span class="btn-icon">📄</span> Detect PDFs';
      }, 3000);
    }
  }

  showPDFSection(pdfs) {
    const pdfSection = document.getElementById('pdf-section');
    const pdfList = document.getElementById('pdf-list');

    if (pdfs.length === 0) {
      pdfList.innerHTML = '<p class="no-pdfs">No PDF statements found on this page.</p>';
    } else {
      pdfList.innerHTML = pdfs.map((pdf, index) => `
        <div class="pdf-item" data-index="${index}">
          <div class="pdf-info">
            <span class="pdf-name">${pdf.text}</span>
            <span class="pdf-url">${pdf.url}</span>
          </div>
          <button class="process-pdf-btn" onclick="popupController.processPDF(${index})">
            <span class="btn-icon">📄</span>
            Process PDF
          </button>
        </div>
      `).join('');
    }

    pdfSection.style.display = 'block';
  }

  async processPDF(pdfIndex) {
    if (!this.currentTab) {
      this.showError('No active tab found');
      return;
    }

    // Get PDF info from the list
    const pdfItems = document.querySelectorAll('.pdf-item');
    const pdfItem = pdfItems[pdfIndex];
    if (!pdfItem) {
      this.showError('PDF not found');
      return;
    }

    const pdfName = pdfItem.querySelector('.pdf-name').textContent;
    const pdfUrl = pdfItem.querySelector('.pdf-url').textContent;

    const processBtn = pdfItem.querySelector('.process-pdf-btn');
    const statusDiv = document.getElementById('pdf-processing-status');
    const statusText = document.getElementById('pdf-status-text');

    try {
      // Update UI to show processing
      processBtn.disabled = true;
      processBtn.innerHTML = '<span class="btn-icon">⏳</span> Processing...';
      statusDiv.style.display = 'block';
      statusText.textContent = `Processing ${pdfName}...`;

      // Send message to content script to process PDF
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'processPDF',
        pdfUrl: pdfUrl,
        filename: `${pdfName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      });

      if (response && response.success) {
        this.extractedTransactions = response.transactions;
        this.showResults(response.count);

        statusText.textContent = `✅ Processed ${response.count} transactions from ${pdfName}`;
        processBtn.innerHTML = '<span class="btn-icon">✅</span> Processed';

        // Update the download button to indicate PDF source
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
          downloadBtn.setAttribute('data-source', 'pdf');
        }
      } else {
        throw new Error(response?.error || 'Failed to process PDF');
      }

    } catch (error) {
      console.error('Error processing PDF:', error);
      statusText.textContent = `❌ Error: ${error.message}`;
      processBtn.innerHTML = '<span class="btn-icon">❌</span> Failed';

      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    } finally {
      processBtn.disabled = false;
    }
  }

  downloadCSV() {
    if (this.extractedTransactions.length === 0) {
      this.showError('No transactions to download');
      return;
    }

    try {
      const source = document.getElementById('download-btn')?.getAttribute('data-source') || 'web';
      const csv = this.convertToCSV(this.extractedTransactions);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      // Create download link
      const link = document.createElement('a');
      link.href = url;
      link.download = `rbc_transactions_${source}_${new Date().toISOString().split('T')[0]}.csv`;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(url);

      // Update button to show success
      const downloadBtn = document.getElementById('download-btn');
      if (downloadBtn) {
        const originalText = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '<span class="btn-icon">✅</span> Downloaded!';
        setTimeout(() => {
          downloadBtn.innerHTML = originalText;
        }, 2000);
      }

    } catch (error) {
      console.error('Error downloading CSV:', error);
      this.showError('Failed to download CSV file');
    }
  }

  showError(message) {
    // You could implement a toast notification or update the UI to show errors
    console.error(message);

    // For now, just update the status
    this.updateStatus('disconnected', message);

    // Show alert as fallback
    setTimeout(() => {
      alert(message);
    }, 100);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
