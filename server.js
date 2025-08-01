const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 5000;

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Create machines table
    await client.query(`
      CREATE TABLE IF NOT EXISTS machines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        work_time INTEGER DEFAULT 0,
        idle_time INTEGER DEFAULT 0,
        emergency_time INTEGER DEFAULT 0
      )
    `);

    // Create production_programs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_programs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        program_name TEXT NOT NULL,
        machine_id VARCHAR REFERENCES machines(id) NOT NULL,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP,
        work_time INTEGER DEFAULT 0,
        idle_time INTEGER DEFAULT 0,
        status TEXT NOT NULL
      )
    `);

    // Check if data exists, if not seed it
    const machineCount = await client.query('SELECT COUNT(*) FROM machines');
    if (parseInt(machineCount.rows[0].count) === 0) {
      // Insert sample machines
      await client.query(`
        INSERT INTO machines (id, name, status, work_time, idle_time, emergency_time) VALUES
        ('machine-1', 'NEXT VECTOR-01', 'working', 452, 15, 0),
        ('machine-2', 'NEXT VECTOR-02', 'idle', 405, 62, 0),
        ('machine-3', 'NEXT VECTOR-03', 'emergency', 318, 125, 24)
      `);

      // Insert sample production programs
      await client.query(`
        INSERT INTO production_programs (id, program_name, machine_id, start_date, end_date, work_time, idle_time, status) VALUES
        ('prog-1', 'NESTING_KITCHEN_001', 'machine-1', '2024-01-15T08:30:00Z', '2024-01-15T12:45:30Z', 250, 5, 'zakończono_pomyślnie'),
        ('prog-2', 'FURNITURE_CUTTING_055', 'machine-2', '2024-01-15T13:15:00Z', '2024-01-15T16:22:15Z', 175, 12, 'zakończono_pomyślnie'),
        ('prog-3', 'DOOR_PANELS_089', 'machine-3', '2024-01-15T09:45:00Z', '2024-01-15T11:23:45Z', 75, 3, 'emergency'),
        ('prog-4', 'CABINET_PARTS_134', 'machine-1', '2024-01-14T14:20:00Z', '2024-01-14T18:35:30Z', 248, 7, 'zakończono_pomyślnie'),
        ('prog-5', 'SHELVING_NESTING_078', 'machine-2', '2024-01-14T10:15:00Z', '2024-01-14T13:42:15Z', 198, 9, 'zakończono_pomyślnie')
      `);
      
      console.log('✅ Database seeded with sample data');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  } finally {
    client.release();
  }
}

// API Routes

// Get all machines
app.get('/api/machines', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM machines ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching machines:', error);
    res.status(500).json({ message: 'Failed to fetch machines' });
  }
});

// Get production programs with optional filters
app.get('/api/production-programs', async (req, res) => {
  try {
    let query = 'SELECT * FROM production_programs';
    const params = [];
    const conditions = [];

    if (req.query.startDate) {
      conditions.push(`start_date >= $${params.length + 1}`);
      params.push(req.query.startDate);
    }
    if (req.query.endDate) {
      conditions.push(`start_date <= $${params.length + 1}`);
      params.push(req.query.endDate);
    }
    if (req.query.machineId) {
      conditions.push(`machine_id = $${params.length + 1}`);
      params.push(req.query.machineId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY start_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching production programs:', error);
    res.status(500).json({ message: 'Failed to fetch production programs' });
  }
});

// Export production data as CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    let query = `
      SELECT 
        pp.program_name,
        pp.start_date,
        pp.end_date,
        pp.work_time,
        pp.idle_time,
        pp.status,
        m.name as machine_name
      FROM production_programs pp
      JOIN machines m ON pp.machine_id = m.id
    `;
    const params = [];
    const conditions = [];

    if (req.query.startDate) {
      conditions.push(`pp.start_date >= $${params.length + 1}`);
      params.push(req.query.startDate);
    }
    if (req.query.endDate) {
      conditions.push(`pp.start_date <= $${params.length + 1}`);
      params.push(req.query.endDate);
    }
    if (req.query.machineId) {
      conditions.push(`pp.machine_id = $${params.length + 1}`);
      params.push(req.query.machineId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY pp.start_date DESC';

    const result = await pool.query(query, params);

    // CSV headers
    const headers = [
      "Nazwa Programu",
      "Data Rozpoczęcia", 
      "Data Zakończenia",
      "Czas Pracy (minuty)",
      "Czas Postoju (minuty)",
      "Rodzaj Zakończenia",
      "Maszyna"
    ];

    // CSV rows
    const csvRows = result.rows.map(row => [
      row.program_name,
      row.start_date ? new Date(row.start_date).toISOString() : "",
      row.end_date ? new Date(row.end_date).toISOString() : "",
      row.work_time.toString(),
      row.idle_time.toString(),
      row.status,
      row.machine_name
    ]);

    const csvContent = [headers, ...csvRows]
      .map(row => row.map(field => `"${field}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="production-data.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ message: 'Failed to export CSV' });
  }
});

// Get production statistics
app.get('/api/stats', async (req, res) => {
  try {
    const programsResult = await pool.query('SELECT * FROM production_programs');
    const machinesResult = await pool.query('SELECT * FROM machines');
    
    const programs = programsResult.rows;
    const machines = machinesResult.rows;

    const completedPrograms = programs.filter(p => p.status === "zakończono_pomyślnie").length;
    const totalWorkTime = programs.reduce((sum, p) => sum + p.work_time, 0);
    const avgWorkTime = programs.length > 0 ? totalWorkTime / programs.length : 0;
    const totalDowntime = programs.reduce((sum, p) => sum + p.idle_time, 0);
    const emergencyCount = programs.filter(p => p.status === "emergency").length;

    const workingMachines = machines.filter(m => m.status === "working").length;
    const totalMachines = machines.length;
    const efficiency = totalMachines > 0 ? (workingMachines / totalMachines) * 100 : 0;

    res.json({
      totalProduction: completedPrograms,
      avgWorkTime: Math.round(avgWorkTime),
      totalDowntime: totalDowntime,
      emergencyCount: emergencyCount,
      workingMachines,
      totalMachines,
      efficiency: Math.round(efficiency)
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ message: 'Failed to fetch statistics' });
  }
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`📊 Production monitoring dashboard available at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  pool.end(() => {
    console.log('💾 Database pool closed');
    process.exit(0);
  });
});