require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';
const DB_NAME = process.env.DB_NAME || 'bd_codeculinary';

async function runMigrations() {
  let connection;
  try {
    console.log(`Connecting to ${DB_HOST}:${DB_PORT} as ${DB_USER} to database ${DB_NAME}`);

    // Connect to the database
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      multipleStatements: true,
    });

    console.log('Connected to database');

    // Read all migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        console.log(`Running migration: ${file}`);
        await connection.query(sql);
        console.log(`✓ Migration completed: ${file}`);
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR' ||
            err.code === 'ER_DUP_KEYNAME' ||
            err.code === 'ER_DUPLICATE_COLUMN_NAME' ||
            err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
          console.log(`✓ Migration skipped (already applied): ${file}`);
        } else {
          console.error(`Error in migration ${file}:`, err.message);
          throw err;
        }
      }
    }

    console.log('\nAll migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
    if (err.errors) {
      console.error('Errors:', err.errors);
    }
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runMigrations();
