const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3002;

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

const GAME_SERVICE_URL = process.env.GAME_SERVICE_URL || 'http://localhost:3001';

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
  res.status(200).json({ status: 'OK', service: 'Order Service' });
});

// Get all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT o.*, 
             json_agg(
               json_build_object(
                 'id', oi.id,
                 'game_id', oi.game_id,
                 'game_name', oi.game_name,
                 'quantity', oi.quantity,
                 'price', oi.price
               )
             ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE 1=1
    `;
    
    let params = [];
    let paramCount = 0;
    
    if (status) {
      paramCount++;
      query += ` AND o.status = $${paramCount}`;
      params.push(status);
    }
    
    query += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM orders WHERE 1=1';
    let countParams = [];
    paramCount = 0;
    
    if (status) {
      paramCount++;
      countQuery += ` AND status = $${paramCount}`;
      countParams.push(status);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalOrders = parseInt(countResult.rows[0].count);
    
    res.json({
      orders: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalOrders,
        totalPages: Math.ceil(totalOrders / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
    
    const order = {
      ...orderResult.rows[0],
      items: itemsResult.rows
    };
    
    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new order
app.post('/api/orders', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { customer_name, customer_email, items } = req.body;
    
    if (!customer_name || !customer_email || !items || items.length === 0) {
      return res.status(400).json({ error: 'Customer name, email, and items are required' });
    }
    
    // Validate games exist and calculate total
    let total_price = 0;
    const validatedItems = [];
    
    for (const item of items) {
      try {
        const gameResponse = await axios.get(`${GAME_SERVICE_URL}/api/games/${item.game_id}`);
        const game = gameResponse.data;
        
        const itemTotal = game.price * (item.quantity || 1);
        total_price += itemTotal;
        
        validatedItems.push({
          game_id: game.id,
          game_name: game.name,
          quantity: item.quantity || 1,
          price: game.price
        });
      } catch (error) {
        if (error.response && error.response.status === 404) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Game with ID ${item.game_id} not found` });
        }
        throw error;
      }
    }
    
    // Create order
    const orderResult = await client.query(
      'INSERT INTO orders (customer_name, customer_email, total_price) VALUES ($1, $2, $3) RETURNING *',
      [customer_name, customer_email, total_price]
    );
    
    const order = orderResult.rows[0];
    
    // Create order items
    const orderItems = [];
    for (const item of validatedItems) {
      const itemResult = await client.query(
        'INSERT INTO order_items (order_id, game_id, game_name, quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [order.id, item.game_id, item.game_name, item.quantity, item.price]
      );
      orderItems.push(itemResult.rows[0]);
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({
      ...order,
      items: orderItems
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update order status
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Valid status is required',
        validStatuses 
      });
    }
    
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete order
app.delete('/api/orders/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Delete order items first (due to foreign key constraint)
    await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
    
    // Delete order
    const result = await client.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting order:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get order statistics
app.get('/api/orders/stats/summary', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped_orders,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COALESCE(SUM(total_price), 0) as total_revenue,
        COALESCE(AVG(total_price), 0) as average_order_value
      FROM orders
    `);
    
    res.json(stats.rows[0]);
  } catch (error) {
    console.error('Error fetching order statistics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Order Service running on port ${port}`);
});
