const express = require('express');
const path = require('path');
const axios = require('axios');
const { Pool } = require('pg');
const { Mutex } = require('async-mutex');
require('dotenv').config();

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Create a PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// Create the ticker_data table if it doesn't exist
async function createTable() {
    try {
        const client = await pool.connect();
        const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ticker_data (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255),
            last DECIMAL(10, 2),
            buy DECIMAL(10, 2),
            sell DECIMAL(10, 2),
            volume DECIMAL(10, 2),
            base_unit VARCHAR(255)
        );
    `;
        await client.query(createTableQuery);
        client.release();
        console.log('Ticker_data table created or already exists');
    } catch (error) {
        console.error('Failed to create ticker_data table:', error);
        throw error;
    }
}

// Fetch top 10 results from WazirX API
async function fetchTop10Results() {
    try {
        const response = await axios.get('https://api.wazirx.com/api/v2/tickers');
        console.log('Response:', response.data); // Log the response data
        if (typeof response.data !== 'object') {
            throw new Error('Invalid response data format');
        }
        const tickers = Object.values(response.data);
        const top10Results = tickers.slice(0, 10); // Get the first 10 results
        console.log('Top 10 results:', top10Results); // Log the top 10 results
        return top10Results;
    } catch (error) {
        console.error('Failed to fetch top 10 results:', error);
        throw error;
    }
}

// Store the top 10 results in the database
async function storeTop10Results(results) {
    try {
        const client = await pool.connect();

        // Delete all records from the ticker_data table
        await client.query('DELETE FROM ticker_data');

        const query = 'INSERT INTO ticker_data (name, last, buy, sell, volume, base_unit) VALUES ($1, $2, $3, $4, $5, $6)';

        for (const result of results) {
            const { name, last, buy, sell, volume, base_unit } = result;
            await client.query(query, [name, last, buy, sell, volume, base_unit]);
        }

        client.release();
        console.log('Top 10 results stored in the database.');
    } catch (error) {
        console.error('Failed to store top 10 results:', error);
        throw error;
    }
}

const mutex = new Mutex();
let isFetchingData = false;

// Fetch and store data while ensuring only one operation is in progress at a time
async function fetchDataAndStore() {
    if (isFetchingData) {
        // A fetch and store operation is already in progress, so return early
        return;
    }

    const release = await mutex.acquire();
    try {
        isFetchingData = true;
        await createTable();
        const top10Results = await fetchTop10Results();
        await storeTop10Results(top10Results);
        console.log('Data fetched and stored successfully.');
    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    } finally {
        isFetchingData = false;
        release();
    }
}

// Fetch and store data every 1 minute
setInterval(fetchDataAndStore, 60000);


// Create a route to retrieve data from the database
// Create a route to retrieve data from the database
app.get('/data', async (req, res) => {
    try {
        const release = await mutex.acquire(); // Acquire the mutex to prevent concurrent access
        const client = await pool.connect();
        const query = 'SELECT * FROM ticker_data';
        const result = await client.query(query);
        const data = result.rows;
        console.log('----------------------------------------------------------------------------------');
        // console.log(data);
        console.log('----------------------------------------------------------------------------------');
        client.release();
        release(); // Release the mutex after data retrieval is completed

        res.json(data);
    } catch (error) {
        console.error('Failed to retrieve data:', error);
        res.status(500).json({ error: 'Failed to retrieve data' });
    }
});



// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
