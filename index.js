// app.js or index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.render('Home/landing', {
        title: 'Kalakshetra 6.0 - Dance Showdown',
        eventName: 'Kalakshetra 6.0',
        eventDate: 'May 5th, 2024',
        eventVenue: 'Dewan Budaya, USM',
        prizePool: 'RM37,500',
        ticketPrice: 'RM5',
        galleryImages: [
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
        sponsors: [
            { logo: '/Pictures/usm_logo(updated).jpg', name: 'USM APEX Logo' },
            { logo: '/Pictures/persatuan_baratham_logo.jpg', name: 'Persatuan Baratham Logo' }
        ],
        socialLinks: [
            { platform: 'facebook', url: 'https://www.facebook.com/USMOfficial1969' },
            { platform: 'instagram', url: 'https://www.instagram.com/pki_usm_induk/' }
        ],
        email: 'kalakshetra@usm.my',
        phone: '+60 12-345 6789 (Mr Yogan)'
    });
});

// Participant routes
// app.get('/registration', (req, res) => {
//   res.render('participant/registration');
// });

// // Merchandise routes
// app.get('/merchandise', (req, res) => {
//   res.render('merchandise/merchandise');
// });

// // Audience routes
// app.get('/tickets', (req, res) => {
//   res.render('audience/audience_regis');
// });

// // Admin routes
// app.get('/admin/login', (req, res) => {
//   res.render('admin/adminlogin');
// });

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});