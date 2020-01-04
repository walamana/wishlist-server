
const State = {
    INACTIVE: 0,
    PLAYING_QUEUE: 1,
    NEXT_QUEUE: 4,
    PLAYING_PLAYLIST: 2,
    NEXT_PLAYLIST: 5,
    PAUSED: 3,
}

const http = require("https")
const querystring = require("querystring")

const uuid = require("uuid/v4")

const axios = require("axios").default;

const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const app = express()

const clientID = ""         // ### Add Client ID
const clientSecret = ""     // ### Add Client Secret

const API_ACCOUNTS = "https://accounts.spotify.com/api"
const API_SPOTIFY = "https://api.spotify.com/v1"

const spotifyCallbackURL = "http://localhost:8080/login/spotify/callback"

var ticket = "5da747f3-c9e3-47f9-8a73-9cddb1d5463e"

var access_token = ""
var refresh_token = ""

var device = ""     // You may want to add a device id

var queue = [{"image":"https://i.scdn.co/image/ab67616d0000b273d844ec515a41dfdf87d3d924","title":"3 Tage Wach","artist":"Lützenkirchen","uri":"spotify:track:1CrpE3GUxPJykJDIXXl1SP"},{"image":"https://i.scdn.co/image/ae3619d928e73ac75fd38f6bef31741abf9da7af","title":"Everybody Talks","artist":"Neon Trees","uri":"spotify:track:2iUmqdfGZcHIhS3b9E9EWq"},{"image":"https://i.scdn.co/image/ab67616d0000b273b6065e5f75dbd99de19f48da","title":"Freak","artist":"Jeremy Loops","uri":"spotify:track:31FFeZ9ePDSzRnefPjiHK3"}];
var playlist = []

var state = State.PAUSED

var settings = {
    playlist: ""
}

app.use(bodyParser.json())
app.use(cors())

app.get('/login/spotify', function(req, res) {
    var scopes = 'user-read-private user-read-email user-read-playback-state user-read-currently-playing';
    res.redirect('https://accounts.spotify.com/authorize' +
        '?response_type=code' +
        '&client_id=' + clientID +
        (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
        '&redirect_uri=' + spotifyCallbackURL);
});
    

app.get("/login/spotify/callback", (req, res) => {
    console.log("AuthToken", req.query.state, req.query.code)


    axios.post(`${API_ACCOUNTS}/token`, querystring.stringify({
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: spotifyCallbackURL
    }), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + Buffer.from(clientID + ":" + clientSecret).toString("base64") + ""
        }
    }).then(d => {
        // console.log("data", d.data)
        var data = d.data;
        access_token = data.access_token;
        refresh_token = data.refresh_token;
        ticket = uuid();
        res.redirect("http://localhost:4200/room/" + ticket + "/player/search")
    })
    
})

app.get("/search", auth,  (req, res) => {
    var query = req.query.q;
    axios.get(`${API_SPOTIFY}/search?q=${query}&type=track`, { headers: headers() }).then(data => {
        res.send(data.data);
    })
})

app.get("/playlists", auth, (req, res) => {
    axios.get(`${API_SPOTIFY}/me/playlists`, { headers: headers() }).then(data => {
        
        res.send(data.data);
    })
})

app.get("/playlist/get", auth, (req, res) => {
    if(!settings.playlist || settings.playlist == ""){
        res.send({error: "no playlist set"});
        return;
    }
    getPlaylist(settings.playlist).then(data => {
        res.send(data.data)
    }).catch(err => {
        console.log(err)
    })
})

app.get("/settings", auth, (req, res) => {
    res.send(settings)
})

app.put("/settings/set", auth, (req, res) => {
    settings[req.body.property] = req.body.value;
    res.send({status: "ok"})
})

app.get("/player/currently-playing", auth, (req, res) => {
    axios.get(`${API_SPOTIFY}/me/player/currently-playing`, { headers: headers() }).then(data => {
        res.send({
            playing: data.data,
            queue: queue
        });
    })
})


app.get("/player", auth, (req, res) => {
    axios.get(`${API_SPOTIFY}/me/player`, { headers: headers() }).then(data => {
        res.send(data.data);
    })
})

app.get("/player/play", auth, (req, res) => {
    playTrack(req.query.track, req.query.device).then(data => {
        res.send(data.data);
    }).catch(err => {
        res.send(err.response.data);
        console.log(err.response.data)
    })
})

app.get("/player/queue", auth, (req, res) => {
    res.send(query)
})

app.put("/player/queue/add", auth, (req, res) => {
    queue.push(req.body);
    res.send({status: "ok"})
})

app.put("/player/queue/remove", auth, (req, res) => {
    queue.splice(req.body.index, 1)
    res.send({response: "ok"})
})


app.get("/player/notify", auth, (req, res) => {
    console.log(state)
    axios.get(`${API_SPOTIFY}/me/player/currently-playing`, { headers: headers() }).then(data => {
        if(data.data == ""){
            state = State.PAUSED
        }
        if(((data.data == null || data.data == "" || !data.data.is_playing) && state == State.PAUSED)){
            if(queue.length > 0 && !(state == State.NEXT_PLAYLIST || state == State.NEXT_QUEUE)){
                state = State.NEXT_QUEUE
                playTrack(queue[0].uri, device).then(worked => {
                    state = State.PLAYING_QUEUE
                    res.send({noticed: true})
                    queue = queue.slice(1, queue.length)
                }).catch(err => {
                    if(err.response.data){
                        state = State.PAUSED
                        res.send({
                            noticed: true, 
                            error: "Could not start track", 
                            reason: err.response.data.error.reason, 
                            message: err.response.data.error.message
                        })
                    }
                    console.log(err.response.data);
                })

            }else if(state != State.NEXT_QUEUE && state != State.NEXT_PLAYLIST){
                state = State.NEXT_PLAYLIST
                if(playlist.length == 0){
                    
                    if(!settings.playlist || settings.playlist == ""){
                        res.send({error: "no playlist set"})
                        return;
                    }
                    res.send({status: "resume_playlist", noticed: true})
                    console.log("Loading playlist " + settings.playlist)
                    getPlaylist(settings.playlist).then(data => {
                        playlist = data.data.tracks.items.map(i => i.track.uri);
                        nextPlaylist(device)
                    }).catch(err => {
                        res.send(err.response.data)
                    })
                }else{
                    nextPlaylist(device)
                    res.send({status: "resume_playlist", noticed: true})
                }
            }
        }else{
            res.send({noticed: true})
        }
    })
})


app.get("/ticket/validate", (req, res) => {
    res.send({valid: ticket == req.query.t})
})  

function nextPlaylist(device){
    var random = Math.floor(Math.random() * playlist.length);
    var track = playlist[random];

    playTrack(track, device).then(res => {
        console.log(res.data)
        state = State.PLAYING_PLAYLIST
    }).catch(err => {
        console.log(err.response)
    });

    playlist.splice(random, 1)

}

function playTrack(trackID, device){
    console.log("playing", trackID)
    var deviceURL = device ? "?device_id=" + device : ""
    return axios.put(`${API_SPOTIFY}/me/player/play` + deviceURL, JSON.stringify({
        uris: [trackID]
    }), { headers: headers()})
}

function getPlaylist(id){
    return axios.get(`${API_SPOTIFY}/playlists/${id}?fields=tracks.items(track.uri)`, { headers: headers()})
}

app.listen(8080)
console.log("listening on 8080")


function auth(req, res, next){
    if(req.headers.authorization == ticket){
        next();
    }else{
        res.status(401);
        res.end();
    }
}

function headers(){
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": "Bearer " + access_token
    }
}
