const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function initDB() {
    // This opens (or creates) a file called plur_network.db in your folder
    const db = await open({
        filename: './plur_network.db',
        driver: sqlite3.Database
    });

    // We tell the database to create our three core memory banks if they don't exist yet
    await db.exec(`
        -- Table 1: Remembers which channel is the "Global" feed for each server
        CREATE TABLE IF NOT EXISTS globals (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT
        );

        -- Table 2: Remembers who has opted in to vote in a specific plur
        CREATE TABLE IF NOT EXISTS plur_members (
            plur_channel_id TEXT,
            user_id TEXT,
            PRIMARY KEY (plur_channel_id, user_id)
        );

        -- Table 3: Remembers the "bridges" (which plur is listening to which target plur)
        CREATE TABLE IF NOT EXISTS plur_connections (
            listening_plur_id TEXT,
            target_plur_id TEXT,
            PRIMARY KEY (listening_plur_id, target_plur_id)
        );
    `);

    console.log("Database initialized: Plur memory is online.");
    return db;
}

// This allows us to use this setup function in our main index.js file
module.exports = { initDB };