const cred = require("./movebank-credentials");
const database = require("./data-manager.js");

const csv = require('csv-parser');
const { Readable } = require('stream');

movement_data = {}

async function get_auth_token() {
    const authHeader = "Basic " + Buffer.from(`${cred.MB_USERNAME}:${cred.MB_PASSWORD}`).toString("base64");

    const res = await fetch("https://www.movebank.org/movebank/service/direct-read?service=request-token", {
        headers: { Authorization: authHeader },
    });

    if (!res.ok) {
        console.error(res.status, res.statusText);
        throw new Error(`CRITICAL ERROR AUTHENTICATING WITH MOVEBANK: ${res.status} ${res.statusText}`);
    }

    return new Promise(resolve => {
        res.json().then(data => {
            resolve(data["api-token"]);
        });
    })
}

async function get_studies(api_token) {
    const res = await fetch(`https://www.movebank.org/movebank/service/direct-read?entity_type=study&i_can_see_data=true` +
    `&attributes=id,name,timestamp_last_deployed_location,number_of_individuals,contact_person_name,principal_investigator_name` +
    `&api-token=${api_token}`);

    if (!res.ok) {
        console.error(res.status, res.statusText);
        throw new Error(`COULD NOT FETCH STUDIES FROM MOVEBANK: ${res.status} ${res.statusText}`);
    }

    return new Promise(resolve => {
        res.text().then(data => {
            resolve(data);
        });
    })
}

async function get_movement_path(api_token, study_id) {
    const res = await fetch(`https://www.movebank.org/movebank/service/direct-read?entity_type=event&i_can_see_data=true&study_id=${study_id}&attributes=timestamp,location_long,location_lat&api-token=${api_token}`);

    if (!res.ok) {
        console.error(res.status, res.statusText);
        throw new Error(`COULD NOT FETCH MOVEMENT DATA FROM MOVEBANK for ${study_id}: ${res.status} ${res.statusText}`);
    }

    return new Promise(resolve => {
        res.text().then(data => {
            resolve(data);
        });
    })
}

async function parse_studies(data) {
    const readableStream = Readable.from(data);
    const parser = readableStream.pipe(csv());
    const records = [];

    try {
        for await (const row of parser) {
            // 'row' is a clean JavaScript object for each line.

            // --- Your per-line processing logic goes here ---
            // Example: Convert types and prepare for DB insertion
            const record = {
                id: row.id,
                species: row.name,
                last_deployed_time: parseInt(row.timestamp_last_deployed_location),
                number_of_animals: parseInt(row.number_of_individuals),
                contact_name: row.contact_person_name,
                principal_investigator: row.principal_investigator_name
            };

            records.push(record);
        }
        return records;

    } catch (error) {
        console.error('An error occurred during CSV parsing:', error.message);
        throw error; // Re-throw the error to be caught by the caller
    }
}

function download_new_movement(token) {
    const next_study_id = database.next_undownloaded_study();
    if (next_study_id !== -1) {
        console.log("Attempting download on:", next_study_id)
        get_movement_path(token, next_study_id).then(r => {
            if (!r.includes("<p>")) {
                parse_paths(r).then(result => {
                    database.add_new_path(next_study_id, result);
                });
            }
            database.mark_as_downloaded(next_study_id);
        });
    }
}

async function parse_paths(data) {
    const readableStream = Readable.from(data);
    const parser = readableStream.pipe(csv());
    const records = [];

    try {
        for await (const row of parser) {
            const record = {
                timestamp: row.timestamp,
                location_long: parseFloat(row.location_long),
                location_lat: parseFloat(row.location_lat)
            };

            records.push(record);
        }
        return records;

    } catch (error) {
        console.error('An error occurred during CSV parsing:', error.message);
        throw error; // Re-throw the error to be caught by the caller
    }
}

database.fetch_studies_from_db().then(() => {
    get_auth_token().then(token => {
        get_studies(token).then(data => {
            parse_studies(data).then(studies => {
                database.add_and_check_studies(studies).then(data => {
                    start_scheduled_downloads(token)
                })
            });
        });
    }).catch(error => {
        console.error(error.status, error.statusText);
    })
})

database.fetch_paths_from_db();

async function start_scheduled_downloads(api_token) {
    await download_new_movement(api_token);

    // Set a timer to call this function again after the interval duration
    //setTimeout(() => start_scheduled_downloads(api_token), 30000);
}

function get_all_downloaded_studies() {
    return database.get_all_downloaded_studies();
}

function get_all_movement_data(survey_id) {
    return database.get_all_movement_data(survey_id);
}


module.exports = {get_auth_token, get_studies, get_movement_path, get_all_downloaded_studies, get_all_movement_data};