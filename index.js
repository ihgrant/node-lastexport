require("dotenv").config();
const got = require("got");
const Database = require("better-sqlite3");

//#region setup
const API_URL = "http://ws.audioscrobbler.com/2.0";
const nodeEnv = process.env;
let _pageSize = 200;
let _totalPages = -1;

if (!nodeEnv.USER) {
    console.error("USER env variable must be defined.");
    process.exit(1);
}

if (!nodeEnv.API_KEY) {
    console.error("API_KEY env variable must be defined.");
    process.exit(1);
}
//#endregion

class LastfmApiService {
    constructor(url, apiKey) {
        this.url = url;
        this.apiKey = apiKey;
    }
    getInfo(username) {
        return got(this.url, {
            json: true,
            query: {
                api_key: this.apiKey,
                format: "json",
                method: "user.getinfo",
                user: username
            }
        }).then(response => ({ playcount: response.body.user.playcount }));
    }
    getPage(username, page, options = { from: null, to: null }) {
        console.info("getPage", page, new Date(Number(options.to)), options.to);
        return got(this.url, {
            json: true,
            query: {
                api_key: this.apiKey,
                format: "json",
                // from: options.from,
                limit: 200,
                method: "user.getrecenttracks",
                page: page,
                to: (options.to / 1000).toFixed(0),
                user: username
            }
        }).then(response => response.body);
    }
}

class DatabaseService {
    constructor(filename) {
        this.db = new Database(filename, {});
        this.db.exec(`CREATE TABLE IF NOT EXISTS scrobbles (
    id INTEGER PRIMARY KEY AUTOINCREMENT
    , artist TEXT
    , album TEXT
    , albumartist TEXT
    , title TEXT
    , dateMs TEXT
    , dateCreatedMs NUMBER
);`);
        this._insertTrack = this.db.prepare(
            `INSERT INTO scrobbles (artist, album, albumartist, title, dateMs, dateCreatedMs)
SELECT :artist, :album, :albumartist, :title, :date, strftime('%s','now') * 1000
WHERE NOT EXISTS (
    SELECT NULL FROM scrobbles WHERE artist = :artist AND album = :album AND title = :title AND dateMs = :date
)`
        );
        this._getLastSync = this.db.prepare(
            `SELECT MAX(dateCreatedMs) AS dateCreated FROM scrobbles;`
        );
        this._getMostRecent = this.db.prepare(
            `SELECT MIN(dateMs) AS date FROM scrobbles;`
        );
    }
    getLastSync() {
        return this._getLastSync.get();
    }
    getMostRecent() {
        return this._getMostRecent.get();
    }
    insertPage(tracks) {
        if (tracks.length) console.log(tracks[tracks.length - 1].date["#text"]);

        tracks
            .filter(track => {
                if (
                    track["@attr"] &&
                    track["@attr"].nowplaying &&
                    track["@attr"].nowplaying === "true"
                ) {
                    return false;
                }
                return true;
            })
            .forEach((track, i) => {
                this._insertTrack.run({
                    artist: track.artist["#text"],
                    album: track.album["#text"],
                    albumartist: "",
                    title: track.name,
                    date: Date.parse(track.date["#text"])
                });
            });
    }
}

const api = new LastfmApiService(API_URL, nodeEnv.API_KEY);
const db = new DatabaseService("scrobbles.db");

Promise.all([
    api.getInfo(nodeEnv.USERNAME),
    Promise.resolve(db.getMostRecent())
])
    .then(([result, mostRecent]) => {
        if (_totalPages < 0) {
            _totalPages = result.playcount / _pageSize;
        }
        // console.log(Math.ceil(_totalPages));
        // console.log(_totalPages);
        console.log(mostRecent);

        return Array.from({ length: _totalPages }).reduce((prev, cur, i) => {
            return prev
                .then(() =>
                    api.getPage(nodeEnv.USERNAME, i + 1, {
                        to: mostRecent.date ? (Number(mostRecent.date)).toFixed(0) : null
                    })
                )
                .then(rs => db.insertPage(rs.recenttracks.track));
        }, Promise.resolve());
    })
    .catch(console.error);

// console.log(db.getLastSync());
