// PDF Processing for RBC CSV Exporter

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
      // Month name format patterns
      /((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\s+([+-]?\$\d+\.\d{2})\s+(.+)/i,
      /(.+?)\s+((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\s+([+-]?\$\d+\.\d{2})/i,
      /((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\s+(.+?)\s+([+-]?\d+\.\d{2})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const [, date, amount, description] = match;

        return {
          date: normalizeDate(date),
          amount: normalizeAmount(amount),
          description: description.trim(),
          source: 'PDF',
          page: line.y // Store page/line info for debugging
        };
      }
    }

    return null;
  }
}
