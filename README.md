# RBC CSV Exporter

A Chrome extension that allows you to extract and download your RBC (Royal Bank of Canada) transaction data as CSV files directly from your online banking interface.

## Features

- 🏦 **RBC Integration**: Works specifically with RBC's online banking interface
- 📊 **CSV Export**: Download transaction data in CSV format for easy analysis
- 📄 **PDF Processing**: Extract transactions from RBC PDF statements
- 🔄 **Auto-Load**: Automatically clicks "Show More" buttons to load all available transactions
- 💡 **Smart Detection**: Intelligently identifies transaction data on RBC pages and PDFs
- 🎨 **Clean UI**: Modern popup interface with status indicators
- 🔒 **Privacy First**: All processing happens locally in your browser

## Installation

### Option 1: Load as Unpacked Extension (Recommended for Development)

1. **Download or Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right corner
4. **Click "Load unpacked"** and select the folder containing this extension
5. The RBC CSV Exporter icon should now appear in your Chrome toolbar

### Option 2: Manual Installation

1. Download the extension files
2. Open Chrome Extensions page (`chrome://extensions/`)
3. Enable Developer mode
4. Click "Load unpacked" and select the extension folder

## Usage

### Step 1: Navigate to RBC Online Banking
1. Go to your RBC online banking website
2. Log in to your account
3. Navigate to your account transaction history or statement page

### Step 2: Use the Extension
You have three ways to export your transactions:

#### Method 1: Extract from Web Interface
1. Click the RBC CSV Exporter icon in your Chrome toolbar
2. The popup will show if you're on a compatible RBC page
3. Click "Extract Transactions" to scan the page
4. Once extraction is complete, click "Download CSV" to save the file

#### Method 2: Using the On-Page Button
1. Look for the "📊 Export CSV" button that appears on RBC transaction pages
2. Click the button to automatically extract and download transactions

#### Method 3: Extract from PDF Statements
1. Navigate to any RBC page that contains PDF statement links
2. Click the RBC CSV Exporter icon in your Chrome toolbar
3. Click "Detect PDFs" to find available PDF statements
4. Click "Process PDF" on any detected PDF to extract transactions
5. Once processing is complete, click "Download CSV" to save the file

### Step 3: Access Your Data
- The CSV file will be saved to your default Downloads folder
- Filename format: `rbc_transactions_YYYY-MM-DD.csv`
- Open with Excel, Google Sheets, or any spreadsheet application

## CSV Format

The exported CSV includes the following columns:
- **Date**: Transaction date
- **Description**: Transaction description and merchant info
- **Amount**: Transaction amount (negative for debits, positive for credits)
- **Type**: Transaction type (Interac, Contactless, Deposit, etc.)
- **Balance**: Account balance (when available)
- **Reference**: Transaction reference number (when available)

*Note: PDF-extracted transactions may have slightly different formatting depending on the original PDF layout.*

## Troubleshooting

### Extension Not Working?
- Make sure you're on an RBC banking page (rbcroyalbank.com or rbc.com)
- Check that the extension is enabled in Chrome Extensions
- Try refreshing the page and clicking the extension icon again

### No Transactions Found?
- Ensure you're on a page that displays transaction history
- Try clicking "Show More" or "Load More" buttons manually first
- Make sure transactions are visible on the page before running the extension

### CSV File Issues?
- Check your Downloads folder for the CSV file
- If the file is empty, try extracting from a different RBC page
- Ensure your browser allows downloads from the extension

### PDF Processing Issues?
- Make sure you're on a page with PDF statement download links
- PDF processing may take several seconds - wait for completion
- Only text-based PDF statements are supported (not scanned images)
- If PDF extraction fails, try using the web interface method instead

## Technical Details

### Files Structure
```
rbc-csv-exporter/
├── manifest.json          # Extension configuration
├── content.js             # Main extraction logic
├── content.css            # Styling for on-page elements
├── popup.html             # Extension popup interface
├── popup.js               # Popup functionality
├── popup.css              # Popup styling
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

### Browser Compatibility
- **Chrome**: Fully supported (Manifest V3)
- **Edge**: Should work (Chromium-based)
- **Firefox**: Not supported (uses Chrome extension format)

### Permissions
The extension requires the following permissions:
- `activeTab`: To interact with the current RBC page
- `storage`: To save extension settings
- `downloads`: To download CSV files
- Host permissions for `*.rbcroyalbank.com` and `*.rbc.com`

## Privacy & Security

- **No Data Collection**: This extension does not collect, store, or transmit any personal data
- **Local Processing**: All transaction extraction happens locally in your browser
- **No External Servers**: No data is sent to external servers or third parties
- **Open Source**: All code is available for review in this repository

## Development

### Building from Source
1. Clone this repository
2. No build process required - it's a pure JavaScript extension
3. Load as unpacked extension in Chrome for testing

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with RBC's website
5. Submit a pull request

## Limitations

- Only works with RBC's online banking interface
- Requires manual navigation to transaction pages
- Limited by what's visible on the current page
- May need updates if RBC changes their website structure

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This extension is not affiliated with, endorsed by, or sponsored by the Royal Bank of Canada (RBC). It is an independent tool created to help RBC customers export their transaction data. Use at your own discretion and always verify exported data for accuracy.

## Support

If you encounter issues or have suggestions:
1. Check the troubleshooting section above
2. Review existing issues in the GitHub repository
3. Create a new issue with detailed information about the problem

---

**Note**: This extension is designed to work with RBC's current website structure. If RBC updates their interface, the extension may need to be updated accordingly.
