// db.js
// import pkg from 'pg';
// const { Pool } = pkg;

const { Pool } = require('pg');

let pool;

if (process.env.NODE_ENV === 'production') {
    // Production configuration (for Neon)
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });
} else {
    // Local development configuration
    pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'kalakshetra_db',
        password: '#As011416#',
        port: 5432,
    });
}

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

module.exports = pool;