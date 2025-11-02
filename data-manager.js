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
        '    id INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
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

async function add_new_path(survey_id, path_data) {
    paths[survey_id] = path_data;
    db.serialize(function() {
        db.run("begin transaction");
        for (let i = 0; i < path_data.length; i++) {
            const statement = "INSERT INTO movement_data (study_id, epoch_time, latitude, longitude) VALUES (?, ?, ?, ?);"
            db.run(statement, survey_id, path_data[i].timestamp, path_data[i].location_lat, path_data[i].location_long);
        }
        db.run("commit");
    });
    console.log("Successfully added", path_data.length, "new paths to", survey_id);
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
                principal_investigator: record.principal_investigator,
                downloaded: record.downloaded
            };
        }
    }).catch(err => {
        console.error("Error fetching data from database:", err.message);
        return undefined;
    });
}

async function fetch_paths_from_db() {
    const statement = "SELECT * FROM movement_data";

    db_fetch(statement).then(records => {
        for (const record of records) {
            const new_record = {
                id: record.id,
                epoch_time: parseInt(record.epoch_time),
                latitude: parseFloat(record.latitude),
                longitude: parseFloat(record.longitude)
            };
            if (paths[record.study_id] === undefined) {
                paths[record.study_id] = [new_record]
            } else {
                paths[record.study_id].push(new_record)
            }
        }
    })
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

async function mark_as_downloaded(study_id) {
    studies_stored[study_id].downloaded = 1;
    await run_async("UPDATE studies SET downloaded = 1 WHERE id = ?;", [study_id]);
}

function next_undownloaded_study() {
    for (const study_id in studies_stored) {
        if (studies_stored[study_id].downloaded === 0) {
            return study_id;
        } else {
            console.log(studies_stored[study_id]);
        }
    }
    return -1;
}

function get_all_downloaded_studies() {
    const studies = []
    Object.entries(studies_stored).forEach(
        ([key, value]) => {
            if (value.downloaded === 1) studies.push(key);
        }
    );
    return studies;
}

function get_all_movement_data(survey_id) {
    console.log(paths)
    return paths[survey_id];
}

init_table();

module.exports = {add_study, add_and_check_studies, fetch_studies_from_db, next_undownloaded_study, mark_as_downloaded,
    add_new_path, fetch_paths_from_db, get_all_downloaded_studies, get_all_movement_data};
