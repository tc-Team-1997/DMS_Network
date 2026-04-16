const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'nbe-dms.db'));
db.pragma('journal_mode = WAL');
module.exports = db;
