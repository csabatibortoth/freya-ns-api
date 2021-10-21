/* Freya NS API v1.0.0 Server */

// Basic Module loading

const fs = require('fs');
const https = require('https');
const http = require('http');

var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var morgan = require('morgan');

var bodyParser = require('body-parser');
var morgan = require('morgan');


var jwt = require('jsonwebtoken');
var config = require('./config/config.js');
app.set('superSecret', config.secret);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(morgan('dev'));

// Service Module loading

if(config.logingEnabled) var logService = require("./services/logService/logService.js");
if(config.authEnabled) var authService = require("./services/authService/authService.js");

switch (config.modelServerType) {
    case 'MNG':
        var modelService = require('./model/mongoDB/manager')
        break;

    default:
        var modelService = require('./model/mongoDB/manager')
        break;
}

//API
var router = express.Router();
app.use('/api', router);

router.get('/', function(req, res) {
    res.json({ message: 'Welcome to '+ config["serverName:"] + ' server by '+ config.companyName +'!' });
});

// Server START

var server = require('./services/serverService/serverService');

if(config.httpsEnabled){
    server.startHTTPSServer(app,config.httpsServerPort);
} else {
    if(config.httpEnabled){
        server.startHTTPServer(app,config.httpServerPort);
    } else {
        if(!config.httpsEnabled) server.startHTTPDefaultServer(app);
    }
}
