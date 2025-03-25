const express = require('express');
const { ethers } = require('ethers');
const { Pool } = require('pg'); // Use node-postgres (pg) for NeonDB
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const fs = require('fs');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(cors({
  origin: ['http://localhost:3000', 'https://block-hunt-frontend.vercel.app/'], // Add your frontend URLs
  credentials: true, // If you're using tokens in headers
}));
app.use(express.json());

// Error handling middleware for JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON format in request body' });
  }
  next();
});

// Log the DATABASE_URL for debugging (remove in production)
console.log('DATABASE_URL:', process.env.DATABASE_URL);

// Connect to NeonDB (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Allow self-signed certificates
  },
});

// Test the database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
  console.log('Connected to NeonDB (PostgreSQL)');
  release();
});

// Smart contract setup (unchanged)
let contract;
let provider;
let signer;

try {
  const abiPath = './artifacts/contracts/HackathonFunding.sol/HackathonFunding.json';
  const contractData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const abi = contractData.abi;

  provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, signer);
  console.log('Smart contract initialized');
} catch (error) {
  console.log('ABI file not found, using mock ABI instead');
// Update the mockAbi to match your contract function names
const mockAbi = [
  "function fundHackathon(uint256 hackathonId) external payable",
  "function setWinners(uint256 hackathonId, address[] calldata winnerAddresses) external",
  "function distributePrizes(uint256 hackathonId) external",
  "function endHackathon(uint256 hackathonId) external",
  "function getBalance() external view returns (uint256)"
];
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, mockAbi, signer);
}

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Invalid token:', err);
      return res.status(403).json({ error: 'Invalid token' });
    }
    console.log('Authenticated user:', user);
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/signup', async (req, res) => {
  const { email, password, role } = req.body;

  console.log('Signup request:', { email, password, role });

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (!['user', 'organizer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Hashed password:', hashedPassword);
    const result = await pool.query(
      'INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id',
      [email, hashedPassword, role]
    );
    console.log('User created with ID:', result.rows[0].id);
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    if (error.code === '23505') { // Unique constraint violation (duplicate email)
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  console.log('Login request:', { email, password });

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      console.log('User not found for email:', email);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    console.log('User found:', user);
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password comparison result:', validPassword);

    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, wallet_address: user.wallet_address } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/connect-wallet', authenticateToken, async (req, res) => {
  const { wallet_address } = req.body;

  if (!wallet_address) {
    return res.status(400).json({ error: 'Wallet address is required' });
  }

  try {
    await pool.query(
      'UPDATE users SET wallet_address = $1 WHERE id = $2',
      [wallet_address, req.user.id]
    );
    res.json({ message: 'Wallet connected successfully' });
  } catch (error) {
    console.error('Connect wallet error:', error);
    res.status(500).json({ error: 'Failed to connect wallet' });
  }
});

app.post('/api/hackathons', authenticateToken, async (req, res) => {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can create hackathons' });
  }

  const { title, description, start_date, end_date, prize_pool } = req.body;

  if (!title || !description || !start_date || !end_date || !prize_pool) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  const now = new Date();

  if (startDate < now) {
    return res.status(400).json({ error: 'Start date must be in the future' });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ error: 'End date must be after start date' });
  }

  if (prize_pool <= 0) {
    return res.status(400).json({ error: 'Prize pool must be a positive number' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO hackathons (title, description, start_date, end_date, organizer_id, prize_pool) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [title, description, start_date, end_date, req.user.id, prize_pool]
    );
    res.status(201).json({ message: 'Hackathon created successfully', id: result.rows[0].id });
  } catch (error) {
    console.error('Create hackathon error:', error);
    res.status(500).json({ error: 'Failed to create hackathon' });
  }
});

app.get('/api/hackathons', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.*,
             (SELECT COUNT(*) FROM hackathon_participants p WHERE p.hackathon_id = h.id AND p.withdrawn = FALSE) as participant_count,
             (SELECT COUNT(*) FROM submissions s WHERE s.hackathon_id = h.id) as submission_count
      FROM hackathons h
    `);

    const now = new Date();
    const hackathons = result.rows.map(hackathon => {
      let status = hackathon.status;
      if (hackathon.manually_ended) {
        status = 'ended';
      } else {
        const startDate = new Date(hackathon.start_date);
        const endDate = new Date(hackathon.end_date);
        if (now < startDate) {
          status = 'upcoming';
        } else if (now >= startDate && now <= endDate) {
          status = 'active';
        } else {
          status = 'ended';
        }
      }
      return { ...hackathon, status };
    });

    res.json(hackathons);
  } catch (error) {
    console.error('Fetch hackathons error:', error);
    res.status(500).json({ error: 'Failed to fetch hackathons' });
  }
});

app.get('/api/hackathons/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT h.*,
             (SELECT COUNT(*) FROM hackathon_participants p WHERE p.hackathon_id = h.id AND p.withdrawn = FALSE) as participant_count,
             (SELECT COUNT(*) FROM submissions s WHERE s.hackathon_id = h.id) as submission_count
      FROM hackathons h
      WHERE h.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    const hackathon = result.rows[0];
    const now = new Date();
    let status = hackathon.status;
    if (hackathon.manually_ended) {
      status = 'ended';
    } else {
      const startDate = new Date(hackathon.start_date);
      const endDate = new Date(hackathon.end_date);
      if (now < startDate) {
        status = 'upcoming';
      } else if (now >= startDate && now <= endDate) {
        status = 'active';
      } else {
        status = 'ended';
      }
    }

    res.json({ ...hackathon, status });
  } catch (error) {
    console.error('Fetch hackathon error:', error);
    res.status(500).json({ error: 'Failed to fetch hackathon' });
  }
});

app.get('/api/hackathons/:id/participants', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT u.id, u.email
      FROM hackathon_participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.hackathon_id = $1 AND p.withdrawn = FALSE
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch participants error:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

app.post('/api/hackathons/:id/join', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'user') {
    return res.status(403).json({ error: 'Only users can join hackathons' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    const now = new Date();
    const endDate = new Date(hackathon.end_date);
    if (endDate < now) {
      return res.status(400).json({ error: 'Hackathon has ended' });
    }

    const participantResult = await pool.query(
      'SELECT * FROM hackathon_participants WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );

    if (participantResult.rows.length > 0) {
      const participant = participantResult.rows[0];
      if (participant.withdrawn) {
        await pool.query(
          'UPDATE hackathon_participants SET withdrawn = FALSE WHERE user_id = $1 AND hackathon_id = $2',
          [req.user.id, id]
        );
        return res.json({ message: 'Rejoined hackathon successfully' });
      }
      return res.status(400).json({ error: 'You have already joined this hackathon' });
    }

    await pool.query(
      'INSERT INTO hackathon_participants (hackathon_id, user_id) VALUES ($1, $2)',
      [id, req.user.id]
    );
    res.json({ message: 'Joined hackathon successfully' });
  } catch (error) {
    console.error('Join hackathon error:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'You have already joined this hackathon' });
    }
    res.status(500).json({ error: 'Failed to join hackathon' });
  }
});

app.post('/api/hackathons/:id/withdraw', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'user') {
    return res.status(403).json({ error: 'Only users can withdraw from hackathons' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    const now = new Date();
    const endDate = new Date(hackathon.end_date);
    if (endDate < now) {
      return res.status(400).json({ error: 'Hackathon has ended' });
    }

    const participantResult = await pool.query(
      'SELECT * FROM hackathon_participants WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );

    if (participantResult.rows.length === 0) {
      return res.status(400).json({ error: 'You are not a participant in this hackathon' });
    }

    const participant = participantResult.rows[0];
    if (participant.withdrawn) {
      return res.status(400).json({ error: 'You have already withdrawn from this hackathon' });
    }

    await pool.query(
      'UPDATE hackathon_participants SET withdrawn = TRUE WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );
    res.json({ message: 'Withdrawn from hackathon successfully' });
  } catch (error) {
    console.error('Withdraw hackathon error:', error);
    res.status(500).json({ error: 'Failed to withdraw from hackathon' });
  }
});

app.post('/api/hackathons/:id/submit', authenticateToken, async (req, res) => {
  console.log('Received submission request:', { params: req.params, body: req.body, user: req.user });
  const { id } = req.params;
  const { idea, description, public_key, teammate_names, github_link } = req.body;

  // Log individual fields for debugging
  console.log('Idea:', idea);
  console.log('Description:', description);
  console.log('Public Key:', public_key);
  console.log('Teammate Names:', teammate_names);
  console.log('GitHub Link:', github_link);

  // Validate required fields
  const missingFields = [];
  if (!idea || typeof idea !== 'string' || idea.trim() === '') missingFields.push('idea');
  if (!description || typeof description !== 'string' || description.trim() === '') missingFields.push('description');
  if (!public_key || typeof public_key !== 'string' || public_key.trim() === '') missingFields.push('public_key');

  if (missingFields.length > 0) {
    console.log('Validation failed: Missing or invalid fields:', missingFields);
    return res.status(400).json({ error: `The following fields are required: ${missingFields.join(', ')}` });
  }

  try {
    // Validate hackathon ID
    if (isNaN(id)) {
      console.log('Invalid hackathon ID:', id);
      return res.status(400).json({ error: 'Invalid hackathon ID' });
    }

    // Check if hackathon exists
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    console.log('Hackathon query result:', hackathonResult.rows);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      console.log('Hackathon not found:', id);
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    // Check if hackathon has ended
    const now = new Date();
    const endDate = new Date(hackathon.end_date);
    console.log('Current date:', now, 'End date:', endDate);
    if (endDate < now || hackathon.manually_ended) {
      console.log('Hackathon has ended');
      return res.status(400).json({ error: 'Hackathon has ended' });
    }

    // Check user role
    if (req.user.role !== 'user') {
      console.log('User is not a regular user:', req.user);
      return res.status(403).json({ error: 'Only users can submit projects' });
    }

    // Check if user has joined the hackathon
    const participantResult = await pool.query(
      'SELECT * FROM hackathon_participants WHERE user_id = $1 AND hackathon_id = $2 AND withdrawn = FALSE',
      [req.user.id, id]
    );
    console.log('Participant query result:', participantResult.rows);
    if (participantResult.rows.length === 0) {
      console.log('User not a participant');
      return res.status(400).json({ error: 'You must join the hackathon to submit a project' });
    }

    // Check for existing submission
    const submissionResult = await pool.query(
      'SELECT * FROM submissions WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );
    console.log('Existing submission query result:', submissionResult.rows);
    if (submissionResult.rows.length > 0) {
      console.log('User already submitted');
      return res.status(400).json({ error: 'You have already submitted a project for this hackathon' });
    }

    // Insert the submission
    await pool.query(
      'INSERT INTO submissions (hackathon_id, user_id, idea, description, public_key, teammate_names, github_link) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, req.user.id, idea, description, public_key, teammate_names || null, github_link || null]
    );
    console.log('Submission successful');
    res.json({ message: 'Project submitted successfully' });
  } catch (error) {
    console.error('Submit project error:', error);
    if (error.code === '23502') {
      return res.status(400).json({ error: `Missing required field: ${error.column}` });
    }
    res.status(500).json({ error: 'Failed to submit project: ' + error.message });
  }
});

app.put('/api/hackathons/:id/submission', authenticateToken, async (req, res) => {
  console.log('Received update submission request:', { params: req.params, body: req.body, user: req.user });
  const { id } = req.params;
  const { idea, description, public_key, teammate_names, github_link } = req.body;

  // Validate required fields
  const missingFields = [];
  if (!idea || typeof idea !== 'string' || idea.trim() === '') missingFields.push('idea');
  if (!description || typeof description !== 'string' || description.trim() === '') missingFields.push('description');
  if (!public_key || typeof public_key !== 'string' || public_key.trim() === '') missingFields.push('public_key');

  if (missingFields.length > 0) {
    console.log('Validation failed: Missing or invalid fields:', missingFields);
    return res.status(400).json({ error: `The following fields are required: ${missingFields.join(', ')}` });
  }

  try {
    // Validate hackathon ID
    if (isNaN(id)) {
      console.log('Invalid hackathon ID:', id);
      return res.status(400).json({ error: 'Invalid hackathon ID' });
    }

    // Check if hackathon exists
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      console.log('Hackathon not found:', id);
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    // Check if hackathon has ended
    const now = new Date();
    const endDate = new Date(hackathon.end_date);
    if (endDate < now || hackathon.manually_ended) {
      console.log('Hackathon has ended');
      return res.status(400).json({ error: 'Hackathon has ended' });
    }

    // Check user role
    if (req.user.role !== 'user') {
      console.log('User is not a regular user:', req.user);
      return res.status(403).json({ error: 'Only users can update submissions' });
    }

    // Check for existing submission
    const submissionResult = await pool.query(
      'SELECT * FROM submissions WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );

    if (submissionResult.rows.length === 0) {
      console.log('Submission not found for user:', req.user.id);
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Update the submission
    await pool.query(
      'UPDATE submissions SET idea = $1, description = $2, public_key = $3, teammate_names = $4, github_link = $5, updated_at = $6 WHERE user_id = $7 AND hackathon_id = $8',
      [idea, description, public_key, teammate_names || null, github_link || null, new Date().toISOString(), req.user.id, id]
    );
    console.log('Submission updated successfully');
    res.json({ message: 'Submission updated successfully' });
  } catch (error) {
    console.error('Update submission error:', error);
    if (error.code === '23502') {
      return res.status(400).json({ error: `Missing required field: ${error.column}` });
    }
    res.status(500).json({ error: 'Failed to update submission: ' + error.message });
  }
});

app.get('/api/hackathons/:id/submissions', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    if (req.user.role === 'organizer' && hackathon.organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the hackathon organizer can view submissions' });
    }

    const submissionsResult = await pool.query(`
      SELECT s.*, u.email
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.hackathon_id = $1
    `, [id]);
    res.json(submissionsResult.rows);
  } catch (error) {
    console.error('Fetch submissions error:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

app.get('/api/organizer/hackathons', authenticateToken, async (req, res) => {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can view their hackathons' });
  }

  try {
    const result = await pool.query(`
      SELECT h.*,
             (SELECT COUNT(*) FROM hackathon_participants p WHERE p.hackathon_id = h.id AND p.withdrawn = FALSE) as participant_count,
             (SELECT COUNT(*) FROM submissions s WHERE s.hackathon_id = h.id) as submission_count
      FROM hackathons h
      WHERE h.organizer_id = $1
    `, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch organizer hackathons error:', error);
    res.status(500).json({ error: 'Failed to fetch hackathons' });
  }
});

app.get('/api/organizer/stats', authenticateToken, async (req, res) => {
  if (req.user.role !== 'organizer') {
    console.log('User is not an organizer:', req.user);
    return res.status(403).json({ error: 'Only organizers can view stats' });
  }

  try {
    const stats = { hackathons: 0, participants: 0, submissions: 0 };

    const hackathonsResult = await pool.query(
      'SELECT COUNT(*) as count FROM hackathons WHERE organizer_id = $1',
      [req.user.id]
    );
    stats.hackathons = parseInt(hackathonsResult.rows[0].count);
    console.log('Hackathon count:', stats.hackathons);

    const participantsResult = await pool.query(
      `
      SELECT COUNT(*) as count
      FROM hackathon_participants p
      JOIN hackathons h ON p.hackathon_id = h.id
      WHERE h.organizer_id = $1 AND p.withdrawn = FALSE
      `,
      [req.user.id]
    );
    stats.participants = parseInt(participantsResult.rows[0].count);
    console.log('Participant count:', stats.participants);

    const submissionsResult = await pool.query(
      `
      SELECT COUNT(*) as count
      FROM submissions s
      JOIN hackathons h ON s.hackathon_id = h.id
      WHERE h.organizer_id = $1
      `,
      [req.user.id]
    );
    stats.submissions = parseInt(submissionsResult.rows[0].count);
    console.log('Submission count:', stats.submissions);

    res.json(stats);
  } catch (error) {
    console.error('Fetch stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/user/hackathons', authenticateToken, async (req, res) => {
  if (req.user.role !== 'user') {
    return res.status(403).json({ error: 'Only users can view their hackathons' });
  }

  try {
    const result = await pool.query(`
      SELECT h.*,
             p.withdrawn
      FROM hackathons h
      JOIN hackathon_participants p ON h.id = p.hackathon_id
      WHERE p.user_id = $1
    `, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch user hackathons error:', error);
    res.status(500).json({ error: 'Failed to fetch hackathons' });
  }
});

app.get('/api/user/hackathons/:id/submission', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'user') {
    return res.status(403).json({ error: 'Only users can view their submissions' });
  }

  try {
    const submissionResult = await pool.query(
      'SELECT * FROM submissions WHERE user_id = $1 AND hackathon_id = $2',
      [req.user.id, id]
    );

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    res.json(submissionResult.rows[0]);
  } catch (error) {
    console.error('Fetch user submission error:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// ... (rest of server.js remains unchanged)

// End Hackathon
app.post('/api/hackathons/:id/end', authenticateToken, async (req, res) => {
  console.log('End hackathon request:', { params: req.params, user: req.user });
  const { id } = req.params;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid hackathon ID' });
  }

  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can end hackathons' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    if (hackathon.organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the hackathon organizer can end it' });
    }

    if (hackathon.manually_ended) {
      return res.status(400).json({ error: 'Hackathon has already been ended' });
    }

    const endTx = await contract.endHackathon(id);
    await endTx.wait();
    console.log('Smart contract endHackathon called successfully');

    await pool.query(
      'UPDATE hackathons SET manually_ended = TRUE, manually_ended_at = $1, status = $2 WHERE id = $3',
      [new Date().toISOString(), 'ended', id]
    );

    res.json({ message: 'Hackathon ended successfully', transactionHash: endTx.hash });
  } catch (error) {
    console.error('End hackathon error:', error);
    res.status(500).json({ error: 'Failed to end hackathon: ' + error.message });
  }
});

// Fund Hackathon
app.post('/api/hackathons/:id/fund', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can fund hackathons' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    if (hackathon.organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the hackathon organizer can fund it' });
    }

    if (!hackathon.manually_ended) {
      return res.status(400).json({ error: 'Hackathon must be ended before funding' });
    }

    if (hackathon.funded_amount > 0) {
      return res.status(400).json({ error: 'Hackathon is already funded' });
    }

    const amountWei = ethers.parseEther(amount.toString());
    const tx = await contract.fundHackathon(id, { value: amountWei });
    await tx.wait();

    await pool.query(
      'UPDATE hackathons SET funded_amount = $1, funded_at = $2 WHERE id = $3',
      [parseFloat(amount), new Date().toISOString(), id]
    );

    res.json({ message: 'Hackathon funded successfully', transactionHash: tx.hash });
  } catch (error) {
    console.error('Fund hackathon error:', error);
    res.status(500).json({ error: 'Failed to fund hackathon: ' + error.message });
  }
});

// Set Winners
app.post('/api/hackathons/:id/set-winners', authenticateToken, async (req, res) => {
  console.log('Set winners request:', { params: req.params, body: req.body, user: req.user });
  const { id } = req.params;
  const { winners } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid hackathon ID' });
  }

  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can set winners' });
  }

  if (!winners || !Array.isArray(winners) || winners.length === 0) {
    return res.status(400).json({ error: 'Winners array is required' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    if (hackathon.organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the hackathon organizer can set winners' });
    }

    if (!hackathon.manually_ended) {
      return res.status(400).json({ error: 'Hackathon must be ended before setting winners' });
    }

    if (hackathon.funded_amount <= 0) {
      return res.status(400).json({ error: 'Hackathon must be funded before setting winners' });
    }

    const winnerAddresses = winners.map(w => {
      if (!ethers.isAddress(w)) throw new Error(`Invalid Ethereum address: ${w}`);
      return w;
    });

    const setWinnersTx = await contract.setWinners(id, winnerAddresses);
    await setWinnersTx.wait();
    console.log('Smart contract setWinners called successfully');

    const winnersData = winnerAddresses.map(address => ({ public_key: address }));
    await pool.query(
      'UPDATE hackathons SET winners = $1 WHERE id = $2',
      [JSON.stringify(winnersData), id]
    );

    res.json({ message: 'Winners set successfully', transactionHash: setWinnersTx.hash });
  } catch (error) {
    console.error('Set winners error:', error);
    res.status(500).json({ error: 'Failed to set winners: ' + error.message });
  }
});

// Distribute Prizes
app.post('/api/hackathons/:id/distribute', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Only organizers can distribute prizes' });
  }

  try {
    const hackathonResult = await pool.query('SELECT * FROM hackathons WHERE id = $1', [id]);
    const hackathon = hackathonResult.rows[0];

    if (!hackathon) {
      return res.status(404).json({ error: 'Hackathon not found' });
    }

    if (hackathon.organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the hackathon organizer can distribute prizes' });
    }

    if (!hackathon.manually_ended) {
      return res.status(400).json({ error: 'Hackathon must be ended before distributing prizes' });
    }

    if (!hackathon.funded_amount || hackathon.funded_amount <= 0) {
      return res.status(400).json({ error: 'Hackathon must be funded before distributing prizes' });
    }

    if (!hackathon.winners || !Array.isArray((hackathon.winners)) || (hackathon.winners).length === 0) {
      return res.status(400).json({ error: 'Winners must be selected before distributing prizes' });
    }

    console.log(`Calling distributePrizes for hackathon ${id}`);
    const tx = await contract.distributePrizes(id);
    console.log('Transaction sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('Prize distribution transaction receipt:', receipt);

    await pool.query(
      'UPDATE hackathons SET prizes_distributed = TRUE, prizes_distributed_at = $1 WHERE id = $2',
      [new Date().toISOString(), id]
    );

    res.json({ 
      message: 'Prizes distributed successfully', 
      transactionHash: tx.hash 
    });
  } catch (error) {
    console.error('Distribute prizes error:', error);
    res.status(500).json({ error: 'Failed to distribute prizes: ' + error.message });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});