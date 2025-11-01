const cred = require("./movebank-credentials");

async function get_auth_token() {
    const authHeader = "Basic " + Buffer.from(`${cred.MB_USERNAME}:${cred.MB_PASSWORD}`).toString("base64");

    const res = await fetch("https://www.movebank.org/movebank/service/direct-read?service=request-token", {
        headers: { Authorization: authHeader },
    });

    if (!res.ok) {
        throw new Error(`CRITICAL ERROR AUTHENTICATING WITH MOVEBANK: ${res.status} ${res.statusText}`);
    }

    return new Promise(resolve => {
        res.json().then(data => {
            resolve(data["api-token"]);
        });
    })
}

async function get_studies(api_token) {
    const res = await fetch(`https://www.movebank.org/movebank/service/direct-read?entity_type=study&i_can_see_data=true&attributes=id&api-token=${api_token}`);

    if (!res.ok) {
        throw new Error(`COULD NOT FETCH STUDIES FROM MOVEBANK: ${res.status} ${res.statusText}`);
    }

    return new Promise(resolve => {
        res.text().then(data => {
            resolve(data);
        });
    })
}

get_auth_token().then(token => {
    get_studies(token).then(data => {
        console.log(data);
    });
})

module.exports = {fetch_all_studies: get_auth_token};