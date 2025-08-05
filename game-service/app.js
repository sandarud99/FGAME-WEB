const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'gamestore',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password123'
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client', err.stack);
    return;
  }
  console.log('Connected to PostgreSQL database');
  release();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Game Service' });
});

// Get all games
app.get('/api/games', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM games WHERE 1=1';
    let params = [];
    let paramCount = 0;
    
    if (category) {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }
    
    if (search) {
      paramCount++;
      query += ` AND name ILIKE $${paramCount}`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM games WHERE 1=1';
    let countParams = [];
    paramCount = 0;
    
    if (category) {
      paramCount++;
      countQuery += ` AND category = $${paramCount}`;
      countParams.push(category);
    }
    
    if (search) {
      paramCount++;
      countQuery += ` AND name ILIKE $${paramCount}`;
      countParams.push(`%${search}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalGames = parseInt(countResult.rows[0].count);
    
    res.json({
      games: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalGames,
        totalPages: Math.ceil(totalGames / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game by ID
app.get('/api/games/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new game
app.post('/api/games', async (req, res) => {
  try {
    const { name, category, released_date, price } = req.body;
    
    if (!name || !category || !price) {
      return res.status(400).json({ error: 'Name, category, and price are required' });
    }
    
    const result = await pool.query(
      'INSERT INTO games (name, category, released_date, price) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, released_date, price]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update game
app.put('/api/games/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, released_date, price } = req.body;
    
    const result = await pool.query(
      'UPDATE games SET name = $1, category = $2, released_date = $3, price = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, category, released_date, price, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete game
app.delete('/api/games/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM games WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game categories
app.get('/api/games/categories/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT category FROM games ORDER BY category');
    const categories = result.rows.map(row => row.category);
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Game Service running on port ${port}`);
});

// Triggering the first CI/CD pipeline run
// Final trigger for the correct CI workflow