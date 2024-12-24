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

// Handle successful payment
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