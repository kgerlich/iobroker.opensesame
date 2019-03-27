/**
 *
 * opensesame adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "opensesame",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js opensesame Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@opensesame.com>"
 *          ]
 *          "desc":         "opensesame adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "materialize":  true,                       // support of admin3
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          "mySelect": "auto"
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const prettyMs = require('pretty-ms');
const path = require('path');
const express = require('express')
const app = express()
const util = require('util'); 

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.opensesame.0
const adapter = new utils.Adapter('opensesame');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

adapter.on('stateChange', function (id, state) {
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if state is command(false) or status(true)
    if (!state.ack) {
        adapter.log.info('ack is not set!');
    }
});

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('ID to show: ' + adapter.config.id);
    adapter.log.info('port of web server: ' + adapter.config.port);

    // in this all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');
    
    app.set('view engine', 'hbs')
    app.set('views', path.join(__dirname, 'views'))
    app.use(express.static(path.join(__dirname, 'css')))

    var port = adapter.config.port;
    let rid = [];
    for (let i= 0; i < adapter.config.id.length;i++ ) {
        rid.push({ id: adapter.config.id[i].replace(/[\.\-]/g, '_'), name: '', val: false});
        // add initial state
        adapter.getForeignObject(adapter.config.id[i], function (err, obj) {
            let state = obj.common;
            adapter.log.info(util.inspect(state) + ' ' + adapter.config.id[i] + ' is ' + state.val);
            rid[i].val = state.val;
            rid[i].name = state.name;
        });        
        adapter.subscribeForeignStates(adapter.config.id[i]);
    }
    app.get('/', (req, res) => {
        res.render('index', { title: 'Open door', id: rid, link: '/open' });
    });
    app.get('/open', (req, res) => {
        if ('id' in req.query) {
            adapter.log.info('open clicked for id = ' + req.query.id);
            for (let i = 0; i <  adapter.config.id.length; i++) {
                if (req.query.id == adapter.config.id[i].replace(/[\.\-]/g, '_')) {
                    adapter.setForeignState( adapter.config.id[i], true);
                    adapter.log.info('setForeignState for id = ' + adapter.config.id[i]);
                }
            }
        }
        res.redirect('/');
    });
    app.listen(port, () => adapter.log.info(`listening on port ${port}!`));
} 
