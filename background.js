// RBC CSV Exporter Background Script
class BackgroundService {
  constructor() {
    this.init();
  }

  init() {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstallation(details);
    });

    // Handle messages from content scripts and popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Handle tab updates to check for RBC pages
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Handle browser action click (if popup fails to load)
    chrome.action.onClicked.addListener((tab) => {
      this.handleActionClick(tab);
    });
  }

  handleInstallation(details) {
    console.log('RBC CSV Exporter installed:', details);

    if (details.reason === 'install') {
      // First time installation
      this.showWelcomeNotification();
    } else if (details.reason === 'update') {
      // Extension updated
      console.log('Extension updated to version:', chrome.runtime.getManifest().version);
    }
  }

  showWelcomeNotification() {
    // Create a welcome notification
    try {
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'RBC CSV Exporter Installed',
          message: 'Navigate to your RBC online banking to start exporting transactions!'
        });
      }
    } catch (error) {
      console.log('Notifications not available:', error);
    }
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'openPopup':
        // Note: Chrome extensions cannot programmatically open their own popup
        // This is a Chrome limitation for security reasons
        // We'll just acknowledge the request
        console.log('Popup open requested - user should click extension icon');
        sendResponse({ success: true, message: 'Please click the extension icon' });
        break;
      
      case 'downloadCSV':
        this.handleCSVDownload(request.data, sendResponse);
        break;
      
      case 'getTabInfo':
        this.getTabInfo(sender.tab.id, sendResponse);
        break;
      
      case 'logError':
        console.error('Content script error:', request.error);
        sendResponse({ success: true });
        break;
      
      default:
        console.log('Unknown message action:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  async handleCSVDownload(csvData, sendResponse) {
    try {
      const filename = `rbc_transactions_${new Date().toISOString().split('T')[0]}.csv`;
      
      // Use Chrome's downloads API
      const downloadId = await chrome.downloads.download({
        url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvData),
        filename: filename,
        saveAs: true
      });

      sendResponse({ success: true, downloadId });
    } catch (error) {
      console.error('Error downloading CSV:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async getTabInfo(tabId, sendResponse) {
    try {
      const tab = await chrome.tabs.get(tabId);
      sendResponse({
        success: true,
        tab: {
          url: tab.url,
          title: tab.title,
          isRBCPage: this.isRBCPage(tab.url)
        }
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    // Update extension icon based on whether we're on an RBC page
    if (changeInfo.status === 'complete' && tab.url) {
      const isRBCPage = this.isRBCPage(tab.url);
      this.updateExtensionIcon(tabId, isRBCPage);
    }
  }

  handleActionClick(tab) {
    // Fallback if popup doesn't work - inject content script manually
    if (this.isRBCPage(tab.url)) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } else {
      // Show notification that we need to be on RBC page
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'RBC CSV Exporter',
        message: 'Please navigate to your RBC online banking page first.'
      });
    }
  }

  isRBCPage(url) {
    if (!url) return false;
    return url.includes('rbcroyalbank.com') || url.includes('rbc.com');
  }

  updateExtensionIcon(tabId, isRBCPage) {
    // Update the extension icon to indicate if we're on an RBC page
    const iconPath = isRBCPage ? {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    } : {
      "16": "icons/icon16-gray.png",
      "32": "icons/icon32-gray.png", 
      "48": "icons/icon48-gray.png",
      "128": "icons/icon128-gray.png"
    };

    chrome.action.setIcon({
      tabId: tabId,
      path: iconPath
    });

    // Update the title
    chrome.action.setTitle({
      tabId: tabId,
      title: isRBCPage ? 'RBC CSV Exporter - Ready' : 'RBC CSV Exporter - Navigate to RBC'
    });
  }

  // Utility method to inject content script if needed
  async injectContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content.css']
      });

      return true;
    } catch (error) {
      console.error('Error injecting content script:', error);
      return false;
    }
  }
}

// Initialize the background service
new BackgroundService();
