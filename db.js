// db.js
import pkg from 'pg';
const { Pool } = pkg;

// const pool = new Pool({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'kalakshetra_db',
//     password: '#As011416#',
//     port: 5432,
// });

// // Test database connection
// pool.query('SELECT NOW()', (err, res) => {
//     if (err) {
//         console.error('Error connecting to the database:', err);
//     } else {
//         console.log('Successfully connected to PostgreSQL database');
//     }
// });

// export default pool;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  // Test connection
  const testConnection = async () => {
    try {
      const client = await pool.connect();
      console.log('Database connected successfully.');
      client.release();
    } catch (err) {
      console.error('Database connection error:', err);
    }
  };
  
  testConnection();
  
  module.exports = pool;