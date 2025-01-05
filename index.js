//index.js
import * as dotenv from 'dotenv';
import express from 'express';
import Stripe from 'stripe';
import pool from './db.js';
import { fileURLToPath } from 'url';
//for login (session management)
import session from 'express-session';
import rateLimit from 'express-rate-limit'; //Import rate limit package
// Secure File Upload Configuration
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Secure File Upload Configuration
// Allowed file types and size
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB


// Multer configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = 'public/Pictures/merchandise';
        try {
            await fs.access(uploadDir);
        } catch {
            await fs.mkdir(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate random filename with original extension
        const randomName = crypto.randomBytes(32).toString('hex');
        const fileExt = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomName}${fileExt}`);
    }
});

// File filter function
const fileFilter = (req, file, cb) => {
    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'), false);
        return;
    }

    // Check original filename for security
    const sanitizedFilename = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '');
    if (sanitizedFilename !== file.originalname) {
        cb(new Error('Invalid filename characters'), false);
        return;
    }

    cb(null, true);
};

// Configure multer with security settings
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

// Middleware for file validation
const validateImage = async (req, res, next) => {
    if (!req.file) {
        return next();
    }

    try {
        // Additional security checks can be added here
        const fileBuffer = await fs.readFile(req.file.path);
        const fileSignature = fileBuffer.toString('hex', 0, 4);

        // Check file signatures (magic numbers)
        const validSignatures = {
            'ffd8ffe0': 'image/jpeg', // JPEG
            '89504e47': 'image/png',  // PNG
            '52494646': 'image/webp'  // WebP
        };

        let isValidSignature = false;
        for (let [signature, mimeType] of Object.entries(validSignatures)) {
            if (fileBuffer.toString('hex', 0, 4).includes(signature)) {
                isValidSignature = true;
                break;
            }
        }

        if (!isValidSignature) {
            await fs.unlink(req.file.path);
            throw new Error('Invalid file content');
        }

        next();
    } catch (error) {
        next(error);
    }
};

// Login Rate Limiter
const loginLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 2, // 2 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many login attempts. Please try again after 1 minute',
            attemptsRemaining: 0
        });
    },
    skipSuccessfulRequests: true,
    keyGenerator: (req) => req.ip // Use IP address as key
});


const port = process.env.PORT;

const app = express();
//Used this for stripe payment gateway (it's from .env file)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

//Add these middleware before your routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware 
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,                    // Prevents client-side JS access
        // maxAge: 24 * 60 * 60 * 1000,       // Session expires in 24 hours
        maxAge: 1 * 60 * 1000,          // For testing, session expires in 1 minute
        sameSite: 'strict'                 // CSRF protection
    }
}));

const path = require('path');

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static('Public')); // Notice the capital 'P' to match your folder structure

// Admin Login and Logout

// Predefined admin credentials
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'admin123',
    email: 'admin@kalakshetra.com'
};


// Admin login page
app.get('/admin/login', (req, res) => {
    if (req.session.adminId) {
        return res.redirect('/admin/adminpage');
    }
    res.render('admin/login');
});

// Admin login route
app.post('/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    
    console.log('Login attempt:', { username }); // Log username but not password for security

    if (username === ADMIN_CREDENTIALS.username && 
        password === ADMIN_CREDENTIALS.password) {
        
        // Set session
        req.session.adminId = 1;
        req.session.username = username;

        res.json({
            success: true,
            redirect: '/admin/adminpage'
        });
    } else {
        // Calculate attempts remaining
        const attemptsRemaining = Math.max(
            0, 
            2 - (req.rateLimit ? req.rateLimit.current : 0)
        );

        res.status(401).json({
            success: false,
            message: 'Invalid credentials. Please try again.',
            attemptsRemaining: attemptsRemaining,
            retryAfter: attemptsRemaining === 0 ? 60 : null // 60 seconds if no attempts left
        });
    }
});

// Admin logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Middleware to protect admin routes
const requireAdmin = (req, res, next) => {
    if (!req.session.adminId) {
        return res.redirect('/admin/login');
    }
    next();
};

// Apply middleware to admin routes
app.use('/admin/adminpage', requireAdmin);
app.use('/admin/merchandise', requireAdmin);
app.use('/admin/audience', requireAdmin);

// Routes
app.get('/', (req, res) => {
    res.render('Home/landing', {
        galleryImages: 
        [
            { src: '/Pictures/Baratham_Picture1.jpg', alt: 'Dance Performance 1' },
            { src: '/Pictures/Baratham_Pic2.jpg', alt: 'Dance Performance 2' },
            { src: '/Pictures/Baratham_Pic3.jpg', alt: 'Dance Performance 3' }
        ],
        faqs: [
            { 
                question: 'Who can participate in the competition?',
                answer: 'Kalakshetra 6.0 is open to dance groups and individual performers of all skill levels.'
            },
            {
                question: 'What is the date and time of the event?',
                answer: 'The event will take place on May 5, 2024, starting at 7:00 p.m. at Dewan Budaya, USM.'
            },
            {
                question: 'Is there an age limit for participants?',
                answer: 'Yes, participants must be at least 18 years old to join the competition.'
            }
        ],
        socialLinks: [
            { platform: 'facebook', url: 'https://www.facebook.com/USMOfficial1969' },
            { platform: 'instagram', url: 'https://www.instagram.com/pki_usm_induk/' }
        ],
    });
});

// Participant routes
app.get('/registration', (req, res) => {
  res.render('participant/registration');
});

//Handle post request submisson for participant registration
app.post('/participant/register', async (req, res) => {
    try {
        console.log('Received registration data:', req.body);

        const { teamName, category, participants } = req.body;
        
        // Calculate total amount based on category
        const totalAmount = category === 'group' ? 50 : 10;
        
        // Generate transaction ID
        const transactionId = 'TXN' + Date.now();

        // Start database transaction
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Insert main registration record
            const registrationResult = await client.query(
                `INSERT INTO participant_registration 
                (team_name, category, transaction_id, total_amount) 
                VALUES ($1, $2, $3, $4) 
                RETURNING id`,
                [teamName, category, transactionId, totalAmount]
            );

            const registrationId = registrationResult.rows[0].id;

            // Insert participants
            for (let i = 0; i < participants.length; i++) {
                const p = participants[i];
                await client.query(
                    `INSERT INTO participant_details 
                    (registration_id, full_name, matric_number, email, gender, age, is_leader) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [registrationId, p.name, p.matric, p.email, p.gender, p.age, i === 0]
                );
            }

            await client.query('COMMIT');

            // Send success response with payment URL
            res.status(201).json({
                success: true,
                message: 'Registration successful',
                data: {
                    redirectUrl: `/participant/payment?registrationId=${registrationId}&amount=${totalAmount}`
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed. Please try again.',
            error: error.message
        });
    }
});

// Get participants registration details
app.get('/registration/:id', async (req, res) => {
    try {
        const registrationId = req.params.id;
        
        // Get registration details
        const registrationResult = await pool.query(
            `SELECT * FROM participant_registration WHERE id = $1`,
            [registrationId]
        );

        // Get participants details
        const participantsResult = await pool.query(
            `SELECT * FROM participant_details WHERE registration_id = $1 ORDER BY is_leader DESC`,
            [registrationId]
        );

        if (registrationResult.rows.length === 0) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        res.json({
            registration: registrationResult.rows[0],
            participants: participantsResult.rows
        });

    } catch (error) {
        console.error('Error fetching registration:', error);
        res.status(500).json({ message: 'Error fetching registration details' });
    }
});

// Participant payment route
app.get('/participant/payment', async (req, res) => {
    try {
        const { registrationId, amount } = req.query;

        // Get registration details from database
        const registrationResult = await pool.query(
            `SELECT pr.*, pd.full_name, pd.email 
             FROM participant_registration pr 
             JOIN participant_details pd ON pr.id = pd.registration_id 
             WHERE pr.id = $1 AND pd.is_leader = true`,
            [registrationId]
        );

        const registration = registrationResult.rows[0];

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'myr',
            metadata: {
                registrationId: registrationId,
                type: 'participant_registration'
            }
        });

        // Render payment page
        res.render('participant/payment', {
            registrationId,
            teamName: registration.team_name,
            leaderName: registration.full_name,
            email: registration.email,
            amount: amount,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
            clientSecret: paymentIntent.client_secret
        });

    } catch (error) {
        console.error('Payment setup error:', error);
        res.redirect('/participant/payment-failed?error=' + encodeURIComponent(error.message));
    }
});

// Handle successful payment for particiapnt registration
app.get('/participant/payment-success', async (req, res) => {
    try {
        console.log('Payment success query params:', req.query);
        
        const paymentIntentId = req.query.payment_intent;
        if (!paymentIntentId) {
            throw new Error('No payment intent ID provided');
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log('Retrieved payment intent:', paymentIntent);

        if (paymentIntent.status === 'succeeded') {
            const registrationId = paymentIntent.metadata.registrationId;

            // Update payment status
            await pool.query(
                'UPDATE participant_registration SET payment_stat = $1, transaction_id = $2 WHERE id = $3',
                ['completed', paymentIntentId, registrationId]
            );

            // Get registration details
            const registrationResult = await pool.query(
                `SELECT * FROM participant_registration WHERE id = $1`,
                [registrationId]
            );

            // Get participants details
            const participantsResult = await pool.query(
                `SELECT * FROM participant_details 
                 WHERE registration_id = $1 
                 ORDER BY is_leader DESC`,
                [registrationId]
            );

            // Render success page
            res.render('participant/p_payment_success', {
                registrationId,
                teamName: registrationResult.rows[0].team_name,
                category: registrationResult.rows[0].category,
                amount: registrationResult.rows[0].total_amount,
                transactionId: paymentIntentId,
                participants: participantsResult.rows
            });
        } else {
            throw new Error('Payment was not successful');
        }

    } catch (error) {
        console.error('Error processing success:', error);
        res.redirect('/participant/payment-failed?error=' + encodeURIComponent(error.message));
    }
});

app.get('/participant/payment-failed', (req, res) => {
    const errorMessage = req.query.error || 'An unexpected error occurred during payment processing.';
    res.render('participant/p_payment-failed', {
        error: errorMessage
    });
});


// Audience routes
app.get('/tickets', (req, res) => {
    res.render('Audience/a_registration', {
        title: 'Audience Registration - Kalakshetra 6.0'
    });
});

// Add new POST route for handling audience registration
app.post('/api/audience/register', async (req, res) => {
    try {
        const { name, email, phone, tickets } = req.body;
        
        // Generate transaction ID
        const transactionId = 'TXN' + Date.now();

        // Insert into database
        const query = `
            INSERT INTO audience_registration 
            (full_name, email, phone_number, number_of_tickets, transaction_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`;

        const values = [name, email, phone, tickets, transactionId];
        
        await pool.query(query, values);

        // Create URL for payment page with query parameters
        const paymentUrl = `/payment_ad?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}&numberOfTickets=${tickets}&transactionId=${transactionId}`;

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: {
                redirectUrl: paymentUrl
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message.includes('unique_email_transaction') 
                ? 'You have already registered with this email address.'
                : 'Registration failed. Please try again.',
            error: error.message
        });
    }
});

// Payment routes for audience
app.get('/payment_ad', async (req, res) => {
    try {
        const { name, email, phone, numberOfTickets } = req.query;
        const totalAmount = parseInt(numberOfTickets) * 5;

        console.log('Creating payment intent for:', { name, email, totalAmount });

        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100), // convert to cents
            currency: 'myr',
            payment_method_types: ['card'],
            metadata: {
                name,
                email,
                phone,
                numberOfTickets
            }
        });

        console.log('Payment intent created:', paymentIntent.id);
        console.log('Client secret:', paymentIntent.client_secret);

        // Render the payment page
        res.render('Audience/payment_ad', {
            name,
            email,
            phone,
            numberOfTickets,
            totalAmount,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
            clientSecret: paymentIntent.client_secret
        });

    } catch (error) {
        console.error('Payment setup error:', error);
        res.status(500).send('Error setting up payment: ' + error.message);
    }
});

// Handle successful payment for audience
app.get('/payment-success', async (req, res) => {
    try {
        console.log('Success page accessed with query params:', req.query);
        const { payment_intent, status } = req.query;

        if (!payment_intent) {
            throw new Error('No payment information provided');
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
        console.log('Retrieved payment intent:', paymentIntent);

        if (paymentIntent.status === 'succeeded') {
            // Update database
            try {
                await pool.query(
                    'UPDATE audience_registration SET payment_status = $1 WHERE email = $2',
                    ['completed', paymentIntent.metadata.email]
                );

                // Fetch updated user details
                const result = await pool.query(
                    'SELECT * FROM audience_registration WHERE email = $1 ORDER BY registration_date DESC LIMIT 1',
                    [paymentIntent.metadata.email]
                );

                const userDetails = result.rows[0];

                // Render success page
                res.render('Audience/payment-success', {
                    name: userDetails.full_name,
                    email: userDetails.email,
                    phone: userDetails.phone_number,
                    numberOfTickets: userDetails.number_of_tickets,
                    totalAmount: paymentIntent.amount / 100,
                    transactionId: payment_intent
                });
            } catch (dbError) {
                console.error('Database error:', dbError);
                throw new Error('Failed to update payment records');
            }
        } else {
            throw new Error('Payment was not successful');
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.redirect(`/payment-failed?error=${encodeURIComponent(error.message)}`);
    }
});

// Payment failed route for audience
app.get('/payment-failed', (req, res) => {
    res.render('Audience/payment-failed', {
        message: 'Payment was unsuccessful. Please try again.',
        error: req.query.error || 'An error occurred during payment processing.'
    });
});

//route for admin page
app.get('/admin/adminpage', async (req, res) => {
    try {
        // Get individual registrations
        const individualRegistrations = await pool.query(
            `SELECT pr.id, pr.category, pr.team_name, pr.payment_stat, pr.transaction_id, 
                    pr.total_amount, pr.registration_date, pd.full_name, pd.email 
             FROM participant_registration pr 
             JOIN participant_details pd ON pr.id = pd.registration_id 
             WHERE pd.is_leader = true AND pr.category = 'individual'
             ORDER BY pr.registration_date DESC`
        );

        // Get group registrations
        const groupRegistrations = await pool.query(
            `SELECT pr.id, pr.category, pr.team_name, pr.payment_stat, pr.transaction_id, 
                    pr.total_amount, pr.registration_date, pd.full_name, pd.email 
             FROM participant_registration pr 
             JOIN participant_details pd ON pr.id = pd.registration_id 
             WHERE pd.is_leader = true AND pr.category = 'group'
             ORDER BY pr.registration_date DESC`
        );

        res.render('admin/adminpage', {
            individualRegistrations: individualRegistrations.rows,
            groupRegistrations: groupRegistrations.rows
        });
    } catch (error) {
        console.error('Error loading admin page:', error);
        res.status(500).send('Error loading admin page');
    }
});

// Route to update participant status
app.post('/admin/update-status', async (req, res) => {
    try {
        const { registrationId, status } = req.body;
        
        await pool.query(
            'UPDATE participant_registration SET status = $1 WHERE id = $2',
            [status, registrationId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route to get participant details
app.get('/admin/participant-details/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get registration details
        const registrationResult = await pool.query(
            `SELECT * FROM participant_registration WHERE id = $1`,
            [id]
        );

        // Get all participants for this registration
        const participantsResult = await pool.query(
            `SELECT * FROM participant_details WHERE registration_id = $1 ORDER BY is_leader DESC`,
            [id]
        );

        res.json({
            registration: registrationResult.rows[0],
            participants: participantsResult.rows
        });
    } catch (error) {
        console.error('Error getting participant details:', error);
        res.status(500).json({ error: error.message });
    }
});

// route for admin's audience management
app.get('/admin/audience', async (req, res) => {
    try {
        // Get all audience registrations
        const audienceResult = await pool.query(
            `SELECT id, full_name, email, phone_number, number_of_tickets, 
                    payment_status, transaction_id, total_amount, registration_date
             FROM audience_registration 
             ORDER BY registration_date DESC`
        );

        // Change this line to match your file name
        res.render('admin/audience_management', {  // Changed from audience-management to audience_management
            audiences: audienceResult.rows
        });
    } catch (error) {
        console.error('Error loading audience management:', error);
        res.status(500).send('Error loading audience management page');
    }
});

// route to get audience details at admin page
app.get('/admin/audience/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT * FROM audience_registration WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Audience not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error getting audience details:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin merchandise management routes
app.get('/admin/merchandise', async (req, res) => {
    try {
        // Get merchandise items
        const merchandiseResult = await pool.query(
            'SELECT * FROM merchandise ORDER BY id DESC'
        );

        // Get all orders with their items
        const ordersResult = await pool.query(`
            SELECT 
                mo.*,
                json_agg(
                    json_build_object(
                        'name', m.name,
                        'quantity', mi.quantity,
                        'price', mi.price_per_unit,
                        'subtotal', mi.price_per_unit * mi.quantity
                    )
                ) as items
            FROM merch_orders mo
            LEFT JOIN merch_order_items mi ON mo.id = mi.order_id
            LEFT JOIN merchandise m ON mi.merchandise_id = m.id
            GROUP BY 
                mo.id, 
                mo.full_name, 
                mo.matric_number,
                mo.email,
                mo.phone,
                mo.total_amount,
                mo.created_at
            ORDER BY mo.created_at DESC
        `);

        // Check if orders exist and handle null values
        let orders = [];
        if (ordersResult.rows.length > 0) {
            orders = ordersResult.rows.map(order => ({
                ...order,
                items: order.items[0] === null ? [] : order.items
            }));
        }

        // Console log for debugging
        console.log('Orders data:', orders);

        // Render the template with both merchandise and orders data
        res.render('admin/admin_merchandise', {
            merchandise: merchandiseResult.rows,
            orders: orders,
            title: 'Merchandise Management'
        });

    } catch (error) {
        console.error('Error loading merchandise management:', error);
        res.status(500).render('error', { 
            message: 'Error loading merchandise page',
            error: error
        });
    }

});

// Get order details for admin view
app.get('/admin/merchandise/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const orderResult = await pool.query(
            `SELECT 
                mo.*,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'name', m.name,
                            'quantity', mi.quantity,
                            'price', mi.price_per_unit,
                            'subtotal', mi.quantity * mi.price_per_unit
                        )
                    ) FILTER (WHERE m.id IS NOT NULL), 
                    '[]'
                ) as items
            FROM merch_orders mo
            LEFT JOIN merch_order_items mi ON mo.id = mi.order_id
            LEFT JOIN merchandise m ON mi.merchandise_id = m.id
            WHERE mo.id = $1
            GROUP BY mo.id`,
            [id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const order = orderResult.rows[0];
        // Ensure items is never null
        order.items = order.items || [];

        res.json(order);
    } catch (error) {
        console.error('Error getting order details:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle merchandise image upload and creation
app.post('/admin/merchandise/add', upload.single('image'),  validateImage, async (req, res) => {
    try {
        const { name, price } = req.body;

        // Validate input
        if (!name || !price || !req.file) {
            throw new Error('Missing required fields');
        }

        // Sanitize inputs
        const sanitizedName = name.trim().replace(/[<>]/g, '');
        const sanitizedPrice = parseFloat(price);

        // Generate secure file path
        const imagePath = `/Pictures/merchandise/${req.file.filename}`;

        // Save to database using parameterized query
        await pool.query(
            'INSERT INTO merchandise (name, price, image_path) VALUES ($1, $2, $3)',
            [sanitizedName, sanitizedPrice, imagePath]
        );

        res.redirect('/admin/merchandise');
    } catch (error) {
        // Clean up uploaded file if database operation fails
        if (req.file) {
            await fs.unlink(req.file.path).catch(console.error);
        }
        res.status(500).render('error', {
            message: 'Error adding merchandise',
            error: error.message
        });
    }
}
);

// Get single merchandise details
app.get('/admin/merchandise/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM merchandise WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Merchandise not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error getting merchandise:', error);
        res.status(500).json({ error: error.message });
    }
});

// Edit merchandise item in admin page
app.post('/admin/merchandise/update', upload.single('image'), validateImage, async (req, res) => {
    try {
        const { id, name, price } = req.body;

        // Validate input
        if (!id || !name || !price) {
            throw new Error('Missing required fields');
        }

        // Sanitize inputs
        const sanitizedName = name.trim().replace(/[<>]/g, '');
        const sanitizedPrice = parseFloat(price);

        let query, values;

        if (req.file) {
            // Get old image path
            const oldImageResult = await pool.query(
                'SELECT image_path FROM merchandise WHERE id = $1',
                [id]
            );

            if (oldImageResult.rows.length > 0) {
                const oldImagePath = path.join('public', oldImageResult.rows[0].image_path);
                await fs.unlink(oldImagePath).catch(console.error);
            }

            // Update with new image
            const imagePath = `/Pictures/merchandise/${req.file.filename}`;
            query = 'UPDATE merchandise SET name = $1, price = $2, image_path = $3 WHERE id = $4';
            values = [sanitizedName, sanitizedPrice, imagePath, id];
        } else {
            query = 'UPDATE merchandise SET name = $1, price = $2 WHERE id = $3';
            values = [sanitizedName, sanitizedPrice, id];
        }

        await pool.query(query, values);
        res.json({ success: true });
    } catch (error) {
        if (req.file) {
            await fs.unlink(req.file.path).catch(console.error);
        }
        res.status(500).json({ error: error.message });
    }
});

// Delete merchandise item in admin page
app.delete('/admin/merchandise/delete/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM merchandise WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting merchandise:', error);
        res.status(500).json({ success: false });
    }
});


// Public merchandise page route
app.get('/merchandise', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM merchandise ORDER BY id DESC'
        );

        res.render('Merchandise/merchan', {
            merchandise: result.rows
        });
    } catch (error) {
        console.error('Error loading merchandise page:', error);
        res.status(500).send('Error loading merchandise page');
    }
});

// Cart route
app.get('/cart', async (req, res) => {
    try {
        // Get merchandise data for image mapping
        const merchandiseResult = await pool.query('SELECT * FROM merchandise');

        res.render('merchandise/cart', {
            merchandiseData: JSON.stringify(merchandiseResult.rows),
            title: 'Shopping Cart - Kalakshetra 6.0'
        });
    } catch (error) {
        console.error('Error loading cart page:', error);
        res.status(500).send('Error loading cart page');
    }
});


// Create order and redirect to payment
app.post('/api/merchandise/create-order', async (req, res) => {
    try {
        const { customerDetails, items, totalAmount } = req.body;
        
        // Start database transaction
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Create a PaymentIntent first
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(totalAmount * 100), // Convert to cents
                currency: 'myr',
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            // Insert order with payment intent ID as transaction_id
            const orderResult = await client.query(
                `INSERT INTO merch_orders 
                (full_name, matric_number, email, phone, total_amount, payment_status, transaction_id)
                VALUES ($1, $2, $3, $4, $5, 'pending', $6)
                RETURNING id`,
                [
                    customerDetails.fullName,
                    customerDetails.matricNumber,
                    customerDetails.email,
                    customerDetails.phone,
                    totalAmount,
                    paymentIntent.id
                ]
            );

            const orderId = orderResult.rows[0].id;

            // Update PaymentIntent with orderId in metadata
            await stripe.paymentIntents.update(paymentIntent.id, {
                metadata: { orderId: orderId.toString() }
            });

            // Insert order items
            for (const item of items) {
                await client.query(
                    `INSERT INTO merch_order_items 
                    (order_id, merchandise_id, quantity, price_per_unit, subtotal)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [
                        orderId,
                        item.id,
                        item.quantity,
                        item.price,
                        item.price * item.quantity
                    ]
                );
            }

            await client.query('COMMIT');

            // Send single response with both orderId and clientSecret
            res.status(200).json({
                success: true,
                orderId: orderId,
                clientSecret: paymentIntent.client_secret
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error: error.message
        });
    }
});

// Render payment page
app.get('/merchandise/payment/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        
        // Fetch order details from the database
        const orderResult = await pool.query(
            `SELECT mo.*, 
                    json_agg(json_build_object(
                        'name', m.name,
                        'quantity', mi.quantity,
                        'price', mi.price_per_unit,
                        'subtotal', mi.quantity * mi.price_per_unit,
                        'image_path', m.image_path
                    )) as items
             FROM merch_orders mo
             JOIN merch_order_items mi ON mo.id = mi.order_id
             JOIN merchandise m ON mi.merchandise_id = m.id
             WHERE mo.id = $1
             GROUP BY mo.id`,
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).send('Order not found');
        }

        const order = orderResult.rows[0];

        // Create new PaymentIntent if one doesn't exist
        let paymentIntent;
        if (!order.transaction_id) {
            paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(order.total_amount * 100),
                currency: 'myr',
                automatic_payment_methods: {
                    enabled: true,
                },
                metadata: {
                    orderId: orderId.toString()
                }
            });

            // Update the order with the new payment intent ID
            await pool.query(
                'UPDATE merch_orders SET transaction_id = $1 WHERE id = $2',
                [paymentIntent.id, orderId]
            );
        } else {
            // Retrieve existing PaymentIntent
            paymentIntent = await stripe.paymentIntents.retrieve(order.transaction_id);
        }

        // Render the payment page with order details
        res.render('merchandise/payment', {
            order: order,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
            clientSecret: paymentIntent.client_secret,
            title: 'Payment - Kalakshetra 6.0'
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            title: 'Payment Error - Kalakshetra 6.0',
            statusCode: 500,
            errorMessage: 'An error occurred while processing your payment. Please try again.'
        });
    }
});

// Handle successful payment
app.get('/merchandise/payment-success', async (req, res) => {
    try {
        const { payment_intent } = req.query;

        // Retrieve the payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
        
        if (paymentIntent.status === 'succeeded') {
            // Update order status in database
            await pool.query(
                `UPDATE merch_orders 
                SET payment_status = 'completed', 
                    created_at = CURRENT_TIMESTAMP 
                WHERE transaction_id = $1`,
                [payment_intent]
            );

            // Get complete order details for confirmation page
            const orderResult = await pool.query(
                `SELECT mo.*, 
                        json_agg(json_build_object(
                            'name', m.name,
                            'quantity', mi.quantity,
                            'price', mi.price_per_unit,
                            'subtotal', mi.subtotal,
                            'image_path', m.image_path
                        )) as items
                 FROM merch_orders mo
                 JOIN merch_order_items mi ON mo.id = mi.order_id
                 JOIN merchandise m ON mi.merchandise_id = m.id
                 WHERE mo.transaction_id = $1
                 GROUP BY mo.id`,
                [payment_intent]
            );

            if (orderResult.rows.length === 0) {
                throw new Error('Order not found');
            }

            const order = orderResult.rows[0];
            
            // Clear the cart after successful payment
            res.clearCookie('cart');
            
            res.render('merchandise/order_confirmation', {
                order: order,
                title: 'Order Confirmation - Kalakshetra 6.0'
            });
        } else {
            throw new Error('Payment was not successful');
        }
    } catch (error) {
        console.error('Error processing payment success:', error);
        res.redirect('/merchandise/payment-failed?error=' + encodeURIComponent(error.message));
    }
});

// Handle failed payment
app.get('/merchandise/payment-failed', (req, res) => {
    const errorMessage = req.query.error || 'An unexpected error occurred during payment.';
    res.render('error', {
        title: 'Payment Failed - Kalakshetra 6.0',
        statusCode: 400,
        errorTitle: 'Payment Failed',
        errorMessage: errorMessage
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    res.status(err.status || 500).render('error', {
        title: 'Error - Kalakshetra 6.0',
        statusCode: err.status || 500,
        errorMessage: err.message || 'An unexpected error occurred',
        errorTitle: err.title || 'Server Error',
        additionalInfo: process.env.NODE_ENV === 'development' ? err.stack : null
    });
});

// Add this route for handling 404 errors
app.use((req, res) => {
    res.status(404).render('error', {
        title: '404 Not Found - Kalakshetra 6.0',
        statusCode: 404,
        errorMessage: 'The page you are looking for could not be found.'
    });
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});