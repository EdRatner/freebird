const sqlite = require("sqlite3");
const db = new sqlite.Database('./storage.db');

studies_stored = {}
paths = {}

function run_async(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}

function db_fetch(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

async function init_table() {
    // 1. Create a table
    const create_movement_table = 'CREATE TABLE IF NOT EXISTS movement_data (\n' +
        '    id INTEGER PRIMARY KEY,\n' +
        '    study_id INTEGER,\n' +
        '    epoch_time INTEGER NOT NULL,\n' +
        '    latitude REAL,\n' +
        '    longitude REAL,\n' +
        '    FOREIGN KEY (study_id) REFERENCES studies(id)\n' +
        ');';

    const create_study_table = 'CREATE TABLE IF NOT EXISTS studies (\n' +
        '    id INTEGER PRIMARY KEY,\n' +
        '    species TEXT NOT NULL,\n' +
        '    last_deployed_time INTEGER,\n' +
        '    number_of_animals INTEGER,\n' +
        '    contact_name TEXT,\n' +
        '    principal_investigator TEXT,\n' +
        '    downloaded INTEGER\n' +
        ');';

    await run_async(create_movement_table, []);
    await run_async(create_study_table, []);
}

async function init_paths() {

}

async function fetch_studies_from_db() {
    const statement = "SELECT * FROM studies";

    db_fetch(statement).then(records => {
        for (const record of records) {
            studies_stored[record.id] = {
                id: record.id,
                species: record.species,
                last_deployed_time: parseInt(record.last_deployed_time), // Convert to Integer
                number_of_animals: parseInt(record.number_of_animals),
                contact_name: record.contact_name,
                principal_investigator: record.principal_investigator
            };
        }
    }).catch(err => {
        console.error("Error fetching data from database:", err.message);
        return undefined;
    });
}

async function add_study(id, species, last_deployed_time, number_of_animals, contact_name, principal_investigator) {
    const statement = 'INSERT INTO studies (id, species, last_deployed_time, number_of_animals, contact_name, principal_investigator, downloaded)\n' +
        'VALUES (?, ?, ?, ?, ?, ?, 0)'

    await run_async(statement, [id, species, last_deployed_time, number_of_animals, contact_name, principal_investigator]);
}

async function add_and_check_studies(studies) {
    db.serialize(function() {
        db.run("begin transaction");
        for (const study_index in studies) {
            const study = studies[study_index];
            if (studies_stored[study.id] === undefined) {
                const statement = 'INSERT INTO studies (id, species, last_deployed_time, number_of_animals, contact_name, principal_investigator, downloaded)\n' +
                    'VALUES (?, ?, ?, ?, ?, ?, 0)';
                db.run(statement, study.id, study.species, study.last_deployed_time, study.number_of_animals, study.contact_name, study.principal_investigator);
            }
        }
        db.run("commit");
    });
}

function add_movement(study_id, epoch_time, lat, long) {

}

init_table();

module.exports = {add_movement, add_study, add_and_check_studies, fetch_studies_from_db};
