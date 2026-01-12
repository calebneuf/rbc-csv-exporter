// UI Management for RBC CSV Exporter

class UIManager {
  constructor(extractor) {
    this.extractor = extractor;
    this.countInterval = null;
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
      const count = this.extractor.getCurrentTransactionCount();
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

    const count = this.extractor.getCurrentTransactionCount();
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
        await this.extractor.handlePopupExtract();
      };
    }
    
    // Download button
    const downloadBtn = document.getElementById('rbc-popup-download-btn');
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        if (this.extractor.transactions && this.extractor.transactions.length > 0) {
          downloadCSV(this.extractor.transactions);
          this.updatePopupStatus('success', `✅ Downloaded ${this.extractor.transactions.length} transactions`);
        }
      };
    }
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
}
