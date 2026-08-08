'use strict';

const path = require('path');
const { openDatabase } = require('../db');

function main() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lapause.db');
  
  console.log(`Loading analytics from database: ${dbPath}`);
  
  let db;
  try {
    db = openDatabase(dbPath);
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  try {
    const rows = db.prepare('SELECT date, guests, registered, puzzle_wins, free_wins FROM daily_analytics ORDER BY date').all();
    
    if (rows.length === 0) {
      console.log('No daily metrics recorded yet.');
      return;
    }

    console.log('\nDaily Analytics Report:');
    console.log('='.repeat(80));
    console.log('Date       | Guests (Visits) | Registered | Puzzle Wins | Free Wins');
    console.log('-'.repeat(72));
    
    let totalGuests = 0;
    let totalRegistered = 0;
    let totalPuzzleWins = 0;
    let totalFreeWins = 0;

    for (const r of rows) {
      totalGuests += r.guests;
      totalRegistered += r.registered;
      totalPuzzleWins += r.puzzle_wins;
      totalFreeWins += r.free_wins;

      console.log(
        `${r.date.padEnd(10)} | ` +
        `${String(r.guests).padStart(15)} | ` +
        `${String(r.registered).padStart(10)} | ` +
        `${String(r.puzzle_wins).padStart(11)} | ` +
        `${String(r.free_wins).padStart(9)}`
      );
    }
    
    console.log('-'.repeat(72));
    console.log(
      `TOTAL      | ` +
      `${String(totalGuests).padStart(15)} | ` +
      `${String(totalRegistered).padStart(10)} | ` +
      `${String(totalPuzzleWins).padStart(11)} | ` +
      `${String(totalFreeWins).padStart(9)}`
    );
    console.log('='.repeat(80));
  } catch (err) {
    console.error(`Error querying analytics metrics: ${err.message}`);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
