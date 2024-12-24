// app.js or index.js
import * as dotenv from 'dotenv';
import express from 'express';
import Stripe from 'stripe';
import pool from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Payment routes
app.get('/payment_ad', async (req, res) => {
    const { name, email, phone, numberOfTickets } = req.query;
    const totalAmount = numberOfTickets * 5;

    try {
        // Create a payment intent with Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmount * 100, // Convert to cents
            currency: 'myr',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                name,
                email,
                phone,
                numberOfTickets
            }
        });

        // Render payment page with client secret
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
        console.error('Error:', error);
        res.status(500).send('Error initializing payment');
    }
});

// Handle successful payment
app.get('/payment-success', async (req, res) => {
    try {
        const { payment_intent, payment_intent_client_secret } = req.query;

        // Verify the payment with Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
        
        if (paymentIntent.status === 'succeeded') {
            // Update payment status in database
            await pool.query(
                'UPDATE audience_registration SET payment_status = $1 WHERE transaction_id = $2',
                ['completed', paymentIntent.metadata.transactionId]
            );

            // Get user details from database
            const result = await pool.query(
                'SELECT * FROM audience_registration WHERE transaction_id = $1',
                [paymentIntent.metadata.transactionId]
            );

            const userDetails = result.rows[0];

            // Render success page with all necessary details
            res.render('Audience/payment-success', {
                name: userDetails.full_name,
                email: userDetails.email,
                phone: userDetails.phone_number,
                numberOfTickets: userDetails.number_of_tickets,
                totalAmount: paymentIntent.amount / 100,
                transactionId: userDetails.transaction_id
            });
        } else {
            res.redirect('/payment-failed');
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.redirect('/payment-failed');
    }
});

// Payment failed route
app.get('/payment-failed', (req, res) => {
    res.render('Audience/payment-failed', {
        message: 'Payment was unsuccessful. Please try again.',
        error: req.query.error || 'An error occurred during payment processing.'
    });
});

// // Merchandise routes
// app.get('/merchandise', (req, res) => {
//   res.render('merchandise/merchan');
// });

// // Admin routes
// app.get('/admin/login', (req, res) => {
//   res.render('admin/adminlogin');
// });

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});