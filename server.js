const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 5000;

// Database configuration
console.log('🔍 Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL starts with:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'NOT SET');

if (!process.env.DATABASE_URL) {
  console.error('❌ BŁĄD: DATABASE_URL nie jest ustawiona!');
  console.error('📋 Instrukcje naprawy:');
  console.error('1. W Render.com utwórz PostgreSQL database');
  console.error('2. Skopiuj "External Database URL"');
  console.error('3. W Web Service dodaj zmienną środowiskową:');
  console.error('   DATABASE_URL = [skopiowany URL bazy]');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5, // maximum number of clients in the pool
  idleTimeoutMillis: 30000, // close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // return an error after 10 seconds if connection could not be established
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
async function initDatabase() {
  console.log('🔄 Attempting to connect to database...');
  
  let client;
  try {
    // Test connection first
    client = await pool.connect();
    console.log('✅ Database connection successful');
    
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
    console.log('✅ Machines table ready');

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
    console.log('✅ Production programs table ready');

    // Check if data exists, if not seed it
    const machineCount = await client.query('SELECT COUNT(*) FROM machines');
    if (parseInt(machineCount.rows[0].count) === 0) {
      console.log('🌱 Seeding database with sample data...');
      
      // Insert sample machines
      await client.query(`
        INSERT INTO machines (id, name, status, work_time, idle_time, emergency_time) VALUES
        ('machine-1', 'NEXT VECTOR-01', 'working', 452, 15, 0),
        ('machine-2', 'NEXT VECTOR-02', 'idle', 405, 62, 0),
        ('machine-3', 'NEXT VECTOR-03', 'emergency', 318, 125, 24)
      `);
      console.log('✅ Sample machines inserted');

      // Insert sample production programs
      await client.query(`
        INSERT INTO production_programs (id, program_name, machine_id, start_date, end_date, work_time, idle_time, status) VALUES
        ('prog-1', 'NESTING_KITCHEN_001', 'machine-1', '2024-01-15T08:30:00Z', '2024-01-15T12:45:30Z', 250, 5, 'zakończono_pomyślnie'),
        ('prog-2', 'FURNITURE_CUTTING_055', 'machine-2', '2024-01-15T13:15:00Z', '2024-01-15T16:22:15Z', 175, 12, 'zakończono_pomyślnie'),
        ('prog-3', 'DOOR_PANELS_089', 'machine-3', '2024-01-15T09:45:00Z', '2024-01-15T11:23:45Z', 75, 3, 'emergency'),
        ('prog-4', 'CABINET_PARTS_134', 'machine-1', '2024-01-14T14:20:00Z', '2024-01-14T18:35:30Z', 248, 7, 'zakończono_pomyślnie'),
        ('prog-5', 'SHELVING_NESTING_078', 'machine-2', '2024-01-14T10:15:00Z', '2024-01-14T13:42:15Z', 198, 9, 'zakończono_pomyślnie')
      `);
      console.log('✅ Sample production programs inserted');
    } else {
      console.log('✅ Database already contains data - skipping seed');
    }

    console.log('🎉 Database initialization completed successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:');
    console.error('Error details:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('🔧 Connection refused - troubleshooting steps:');
      console.error('1. Sprawdź czy DATABASE_URL jest poprawnie ustawiona');
      console.error('2. Upewnij się że PostgreSQL database jest utworzona w Render.com');
      console.error('3. Użyj "External Database URL" (nie Internal Database URL)');
      console.error('4. URL powinien zaczynać się od "postgresql://"');
    }
    
    throw error; // Re-throw to stop server startup
  } finally {
    if (client) {
      client.release();
    }
  }
}

// API Routes

// Get all machines
app.get('/api/machines', async (req, res) => {
  try {
    if (useFallbackData) {
      res.json(fallbackMachines);
      return;
    }
    
    const result = await pool.query('SELECT * FROM machines ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching machines:', error);
    // Fallback to sample data if database fails
    res.json(fallbackMachines);
  }
});

// Get production programs with optional filters
app.get('/api/production-programs', async (req, res) => {
  try {
    if (useFallbackData) {
      let filteredPrograms = [...fallbackPrograms];
      
      // Apply filters to fallback data
      if (req.query.startDate) {
        filteredPrograms = filteredPrograms.filter(p => p.start_date >= req.query.startDate);
      }
      if (req.query.endDate) {
        filteredPrograms = filteredPrograms.filter(p => p.start_date <= req.query.endDate);
      }
      if (req.query.machineId) {
        filteredPrograms = filteredPrograms.filter(p => p.machine_id === req.query.machineId);
      }
      
      res.json(filteredPrograms.sort((a, b) => new Date(b.start_date) - new Date(a.start_date)));
      return;
    }
    
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
    // Fallback to sample data
    res.json(fallbackPrograms);
  }
});

// Export production data as CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    let programs, machines;
    
    if (useFallbackData) {
      programs = [...fallbackPrograms];
      machines = fallbackMachines;
      
      // Apply filters to fallback data
      if (req.query.startDate) {
        programs = programs.filter(p => p.start_date >= req.query.startDate);
      }
      if (req.query.endDate) {
        programs = programs.filter(p => p.start_date <= req.query.endDate);
      }
      if (req.query.machineId) {
        programs = programs.filter(p => p.machine_id === req.query.machineId);
      }
    } else {
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
      programs = result.rows;
    }

    // Create machine name mapping for fallback mode
    const machineMap = {};
    if (useFallbackData) {
      machines.forEach(m => machineMap[m.id] = m.name);
    }

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
    const csvRows = programs.map(row => [
      row.program_name,
      row.start_date ? new Date(row.start_date).toISOString() : "",
      row.end_date ? new Date(row.end_date).toISOString() : "",
      row.work_time.toString(),
      row.idle_time.toString(),
      row.status,
      useFallbackData ? (machineMap[row.machine_id] || row.machine_id) : row.machine_name
    ]);

    const csvContent = [headers, ...csvRows]
      .map(row => row.map(field => `"${field}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="production-data.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting CSV:', error);
    // Fallback CSV export
    const headers = ["Nazwa Programu", "Data Rozpoczęcia", "Data Zakończenia", "Czas Pracy (minuty)", "Czas Postoju (minuty)", "Rodzaj Zakończenia", "Maszyna"];
    const machineMap = {};
    fallbackMachines.forEach(m => machineMap[m.id] = m.name);
    
    const csvRows = fallbackPrograms.map(row => [
      row.program_name,
      row.start_date ? new Date(row.start_date).toISOString() : "",
      row.end_date ? new Date(row.end_date).toISOString() : "",
      row.work_time.toString(),
      row.idle_time.toString(),
      row.status,
      machineMap[row.machine_id] || row.machine_id
    ]);

    const csvContent = [headers, ...csvRows]
      .map(row => row.map(field => `"${field}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="production-data-fallback.csv"');
    res.send(csvContent);
  }
});

// Get production statistics
app.get('/api/stats', async (req, res) => {
  try {
    let programs, machines;
    
    if (useFallbackData) {
      programs = fallbackPrograms;
      machines = fallbackMachines;
    } else {
      const programsResult = await pool.query('SELECT * FROM production_programs');
      const machinesResult = await pool.query('SELECT * FROM machines');
      programs = programsResult.rows;
      machines = machinesResult.rows;
    }

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
    // Fallback calculation
    const completedPrograms = fallbackPrograms.filter(p => p.status === "zakończono_pomyślnie").length;
    const totalWorkTime = fallbackPrograms.reduce((sum, p) => sum + p.work_time, 0);
    const avgWorkTime = fallbackPrograms.length > 0 ? totalWorkTime / fallbackPrograms.length : 0;
    const totalDowntime = fallbackPrograms.reduce((sum, p) => sum + p.idle_time, 0);
    const emergencyCount = fallbackPrograms.filter(p => p.status === "emergency").length;
    const workingMachines = fallbackMachines.filter(m => m.status === "working").length;
    const totalMachines = fallbackMachines.length;
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
  }
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback in-memory data (if database fails)
let fallbackMachines = [
  { id: 'machine-1', name: 'NEXT VECTOR-01', status: 'working', work_time: 452, idle_time: 15, emergency_time: 0 },
  { id: 'machine-2', name: 'NEXT VECTOR-02', status: 'idle', work_time: 405, idle_time: 62, emergency_time: 0 },
  { id: 'machine-3', name: 'NEXT VECTOR-03', status: 'emergency', work_time: 318, idle_time: 125, emergency_time: 24 }
];

let fallbackPrograms = [
  { id: 'prog-1', program_name: 'NESTING_KITCHEN_001', machine_id: 'machine-1', start_date: '2024-01-15T08:30:00Z', end_date: '2024-01-15T12:45:30Z', work_time: 250, idle_time: 5, status: 'zakończono_pomyślnie' },
  { id: 'prog-2', program_name: 'FURNITURE_CUTTING_055', machine_id: 'machine-2', start_date: '2024-01-15T13:15:00Z', end_date: '2024-01-15T16:22:15Z', work_time: 175, idle_time: 12, status: 'zakończono_pomyślnie' },
  { id: 'prog-3', program_name: 'DOOR_PANELS_089', machine_id: 'machine-3', start_date: '2024-01-15T09:45:00Z', end_date: '2024-01-15T11:23:45Z', work_time: 75, idle_time: 3, status: 'emergency' },
  { id: 'prog-4', program_name: 'CABINET_PARTS_134', machine_id: 'machine-1', start_date: '2024-01-14T14:20:00Z', end_date: '2024-01-14T18:35:30Z', work_time: 248, idle_time: 7, status: 'zakończono_pomyślnie' },
  { id: 'prog-5', program_name: 'SHELVING_NESTING_078', machine_id: 'machine-2', start_date: '2024-01-14T10:15:00Z', end_date: '2024-01-14T13:42:15Z', work_time: 198, idle_time: 9, status: 'zakończono_pomyślnie' }
];

let useFallbackData = false;

// Start server
async function startServer() {
  try {
    await initDatabase();
    console.log('💾 Using PostgreSQL database');
  } catch (error) {
    console.error('❌ Database connection failed, switching to fallback mode');
    console.log('⚠️  Application will run with sample data in memory');
    console.log('🔧 To fix: Set correct DATABASE_URL in environment variables');
    useFallbackData = true;
  }
  
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📊 Production monitoring dashboard available`);
    if (useFallbackData) {
      console.log('⚠️  Running in FALLBACK MODE - using sample data');
    }
  });
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
