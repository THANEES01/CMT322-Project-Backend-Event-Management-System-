// app.js or index.js
import * as dotenv from 'dotenv';
import express from 'express';
import Stripe from 'stripe';
import pool from './db.js';
import path from 'path';
import multer from 'multer';  // Import multer for handling file uploads.
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/Pictures')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ storage: storage });

const port = process.env.PORT;

const app = express();
//Used this for stripe payment gateway (it's from .env file)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

//Add these middleware before your routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static('Public')); // Notice the capital 'P' to match your folder structure

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
app.get('/admin', async (req, res) => {
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
        const result = await pool.query(
            'SELECT * FROM merchandise ORDER BY id DESC'
        );
        
        res.render('admin/admin_merchandise', {
            merchandise: result.rows
        });
    } catch (error) {
        console.error('Error loading merchandise management:', error);
        res.status(500).send('Error loading merchandise page');
    }
});

// Handle merchandise image upload and creation
app.post('/admin/merchandise/add', upload.single('image'), async (req, res) => {
    try {
        const { name, price } = req.body;
        const imagePath = `/Pictures/${req.file.filename}`;

        await pool.query(
            'INSERT INTO merchandise (name, price, image_path) VALUES ($1, $2, $3)',
            [name, price, imagePath]
        );

        res.redirect('/admin/merchandise');
    } catch (error) {
        console.error('Error adding merchandise:', error);
        res.status(500).send('Error adding merchandise');
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


// // Admin routes
// app.get('/admin/login', (req, res) => {
//   res.render('admin/adminlogin');
// });

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});