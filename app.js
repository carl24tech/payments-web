import mongoose from 'mongoose';
import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pdfMake from 'pdfmake/build/pdfmake.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const BASE_API_URL = process.env.BASE_API_URL;
const API_KEY = process.env.API_KEY;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas DataBase'))
  .catch(err => console.error('Error Connecting to MongoDB Atlas:', err));

// Define Transaction schema
const txnSchema = new mongoose.Schema({
  Amount: { type: String, required: true },
  Phone: { type: String, required: true },
  TxnID: { type: String, required: true, unique: true },
  CheckoutID: { type: String, required: true, unique: true }
});
const Txn = mongoose.model('Txn', txnSchema);

// Load vfs_fonts.js from a CDN
const loadVfsFonts = async () => {
    try {
        const response = await fetch('https://cdn.jsdelivr.net/npm/pdfmake/build/vfs_fonts.js');
        const vfsFonts = await response.text();
        eval(vfsFonts); // Execute the script to set pdfMake.vfs
        console.log('vfs_fonts.js loaded successfully');
    } catch (error) {
        console.error('Failed to load vfs_fonts.js:', error);
        throw error;
    }
};

// Initialize pdfMake with fonts
const initializePdfMake = async () => {
    await loadVfsFonts();

    const fonts = {
        Roboto: {
            normal: 'Roboto-Regular.ttf',
            bold: 'Roboto-Medium.ttf',
            italics: 'Roboto-Italic.ttf',
            bolditalics: 'Roboto-MediumItalic.ttf'
        }
    };

    pdfMake.fonts = fonts;
    console.log('pdfMake initialized successfully');
};

// Start the server after initializing pdfMake
initializePdfMake().then(() => {
    // Serve static files from the "public" folder
    app.use(express.static(path.join(process.cwd(), 'public')));

    // Route to serve the index.html file
    app.get('/', (req, res) => {
        res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    // Route to serve the admin.html file
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
    });

    // Endpoint to handle payment requests
   app.post('/api/pay.php', async (req, res) => {
    const { phone, amount } = req.body;

    try {
        const response = await axios.post(BASE_API_URL, { phone, amount }, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: API_KEY,
            }
        });

        const result = response.data;
        console.log('Response from external API:', result);

        if (!result.data || !result.data.amount || !result.data.phone || !result.data.refference || !result.data.CheckoutRequestID) {
            throw new Error('Invalid response data from external API');
        }

      /*  const newTransaction = new Txn({
            Amount: `Ksh ${result.data.amount}`,
            Phone: result.data.phone,
            TxnID: result.data.refference,
            CheckoutID: result.data.CheckoutRequestID
        });

        await newTransaction.save();
        console.log('Transaction saved to MongoDB:', newTransaction); */

       res.status(200).json(result);
    } catch (error) {
        console.error('Error in /api/pay.php:', error);

        if (error.code === 11000) {
            return res.status(400).json({ message: 'Transaction already exists.' });
        }

        res.status(500).json({ 
            message: 'Server error. Please try again later.', 
            error: error.message 
        });
    }
});

    // Endpoint to fetch all transactions
    app.post('/callback-data', async (req, res) => {
        try {
            const transactions = await Txn.find({});
            res.json(transactions);
        } catch (error) {
            console.error('Error fetching transactions:', error);
            res.status(500).json({ message: 'Error fetching transactions', error: error.message });
        }
    });

    // Endpoint to search for a transaction by Txn ID or Checkout ID
    app.post('/search-transaction', async (req, res) => {
        const { id } = req.query;
        try {
            const transaction = await Txn.findOne({ $or: [{ TxnID: id }, { CheckoutID: id }]});
            if (transaction) {
                res.json(transaction);
            } else {
                res.status(404).json({ message: 'Transaction not found' });
            }
        } catch (error) {
            console.error('Error searching transaction:', error);
            res.status(500).json({ message: 'Error searching transaction', error: error.message });
        }
    });

    // Endpoint to search for transactions by phone number
    app.post('/search-by-phone', async (req, res) => {
        const { phone } = req.query;
        try {
            const transactions = await Txn.find({ Phone: phone });
            res.json(transactions);
        } catch (error) {
            console.error('Error searching transactions by phone:', error);
            res.status(500).json({ message: 'Error searching transactions by phone', error: error.message });
        }
    });

    
   // Endpoint to update a transaction by TxnID
app.put('/update-transaction/:id', async (req, res) => {
    const { id } = req.params; // This is the TxnID, not _id
    const updateData = req.body;
    try {
        const updatedTransaction = await Txn.findOneAndUpdate(
            { TxnID: id }, // Query by TxnID
            updateData, 
            { new: true } // Return the updated document
        );
        if (updatedTransaction) {
            res.json(updatedTransaction);
        } else {
            res.status(404).json({ message: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.status(500).json({ message: 'Error updating transaction', error: error.message });
    }
});

// Endpoint to delete a transaction by TxnID
app.delete('/delete-transaction/:id', async (req, res) => {
    const { id } = req.params; // This is the TxnID, not _id
    try {
        const deletedTransaction = await Txn.findOneAndDelete({ TxnID: id }); // Query by TxnID
        if (deletedTransaction) {
            res.json({ message: 'Transaction deleted successfully' });
        } else {
            res.status(404).json({ message: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({ message: 'Error deleting transaction', error: error.message });
    }
});
    
    // Endpoint to export transactions as PDF
app.all('/export-transactions', async (req, res) => {
    const { phone, id } = req.query;

    try {
        let transactions;
        let headerText = 'ALL TRANSACTIONS REPORT'; // Default header

        if (phone) {
            transactions = await Txn.find({ Phone: phone });
            headerText = `TRANSACTIONS REPORT FOR ${phone}`;
        } else if (id) {
            transactions = await Txn.findOne({ $or: [{ TxnID: id }, { CheckoutID: id }] });
            if (transactions) {
                transactions = [transactions];
                headerText = transactions[0].TxnID 
                    ? `TRANSACTION RECEIPT FOR TXN ID: ${transactions[0].TxnID}` 
                    : `TRANSACTION RECEIPT FOR CHECKOUT ID: ${transactions[0].CheckoutID}`;
            } else {
                transactions = [];
            }
        } else {
            transactions = await Txn.find({});
        }

        if (transactions.length === 0) {
            return res.status(404).json({ message: 'No transactions found.' });
        }

        // Download the logo image and convert it to base64
        const logoUrl = 'https://github.com/boitech.png'; // Make sure the image is already circular
        const logoResponse = await axios.get(logoUrl, { responseType: 'arraybuffer' });
        const logoBase64 = Buffer.from(logoResponse.data, 'binary').toString('base64');
        const logoDataUri = `data:image/jpeg;base64,${logoBase64}`;

        const docDefinition = {
            content: [
                // Dotted Border
                {
                    canvas: [
                        {
                            type: 'rect',
                            x: 10,
                            y: 10,
                            w: 575,
                            h: 821,
                            lineWidth: 1,
                            lineColor: '#000000',
                            dash: { length: 5 }
                        }
                    ],
                    absolutePosition: { x: 0, y: 0 }
                },
                // Logo (Make sure the logo image is already circular)
                {
                    image: logoDataUri,
                    width: 100,
                    height: 100,
                    alignment: 'center',
                    margin: [0, 20, 0, 10]
                },
                // Company Address
                {
                    text: [
                        { text: 'IBRAHIM TECH\n', bold: true, fontSize: 14 },
                        { text: 'P O BOX 30409, KAKAMEGA', bold: true, fontSize: 12 }
                    ],
                    alignment: 'center',
                    margin: [0, 0, 0, 10]
                },
                // Current Date and Time
                {
                    text: [
                        { text: `DATE: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n`, bold: true, fontSize: 12 },
                        { text: `TIME: ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`, bold: true, fontSize: 12 }
                    ],
                    alignment: 'center',
                    margin: [0, 0, 0, 10]
                },
                // Header (Reduced Font Size)
                {
                    text: headerText,
                    style: 'header',
                    alignment: 'center',
                    margin: [0, 0, 0, 10]
                },
                // List Transactions
                ...transactions.map(txn => ({
                    stack: [
                        { text: `Transaction ID: ${txn.TxnID || 'N/A'}`, style: 'subheader' },
                        { text: `Amount: ${txn.Amount || 'N/A'}` },
                        { text: `Phone: ${txn.Phone || 'N/A'}` },
                        { text: `Checkout ID: ${txn.CheckoutID || 'N/A'}` },
                        { text: '\n' }
                    ]
                }))
            ],
            styles: {
                header: {
                    fontSize: 14, // Reduced font size
                    bold: true,
                    decoration: 'underline',
                    decorationStyle: 'double',
                    margin: [0, 10, 0, 10]
                },
                subheader: {
                    fontSize: 12,
                    bold: true,
                    margin: [0, 5, 0, 5]
                }
            },
            pageMargins: [40, 60, 40, 60],
            defaultStyle: {
                font: 'Roboto'
            }
        };

        const pdfDoc = pdfMake.createPdf(docDefinition);

        pdfDoc.getBuffer((buffer) => {
            // Set headers for PDF response
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=transactions.pdf');
            res.end(buffer);
        });
    } catch (error) {
        console.error('Error exporting transactions:', error);
        res.status(500).json({ message: 'Error exporting transactions', error: error.message });
    }
});


    
    // Start the server
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch((error) => {
    console.error('Failed to initialize pdfMake:', error);
    process.exit(1); // Exit the process if pdfMake initialization fails
});


